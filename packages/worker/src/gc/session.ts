import {
	ensureAccountProxy,
	isNoUsableProxy,
	isProxyTransportError,
	isProxyUsable,
	NoUsableProxyError,
	pickReadyProxy,
	rotateAccountProxy,
} from '@app/shared/src/components/proxies'
import {
	disableResource,
	recordResourceAttempt,
} from '@app/shared/src/components/resource-health'
import {
	accountCanReadEmailGuard,
	accountHasUsableTotp,
	accountIsGcEligible,
	clearRefreshToken,
	type GcAccount,
	listGcAccounts,
	markAccountError,
	markAccountLogin,
	markSharedSecretBroken,
	saveSteamSession,
	selectGcPool,
} from '@app/shared/src/components/resources'
import { getAppSettings } from '@app/shared/src/components/settings'
import {
	DOTA_APP_ID,
	decodeFields,
	decodeMatchDetailsResponse,
	encodeClientHello,
	encodeMatchDetailsRequest,
	GC_MSG,
	type GcMatchReplayLocator,
} from '@app/shared/src/gc/protobuf'
import { fetchSteamGuardFromMailbox } from '@app/shared/src/steam/email-guard'
import { refreshTokenUsable } from '@app/shared/src/steam/jwt'
import {
	generateAuthCode,
	querySteamTimeOffset,
} from '@app/shared/src/steam/totp'
import { asError, errorMessage } from '@app/shared/src/store/coerce'
import { logger } from '@app/shared/src/utils/logger'
import SteamUser from 'steam-user'
import {
	isGcWelcomeTimeout,
	isImapBasicAuthDisabled,
	SharedSecretBrokenError,
} from '#src/gc/auth-error'

export {
	isNoUsableGcAccount,
	SharedSecretBrokenError,
} from '#src/gc/auth-error'

type BoundSession = {
	account: GcAccount
	client: SteamUser
}

let session: BoundSession | null = null
let connecting: Promise<BoundSession> | null = null

function createClient(account: GcAccount): SteamUser {
	if (account.proxyUrl == null || account.proxyUrl === '') {
		throw new NoUsableProxyError(
			'GC session requires a proxy — none bound to this account',
		)
	}
	const options: {
		autoRelogin: boolean
		renewRefreshTokens: boolean
		dataDirectory: null
		httpProxy?: string
		socksProxy?: string
	} = {
		autoRelogin: false,
		renewRefreshTokens: true,
		dataDirectory: null,
	}
	if (account.proxyKind === 'socks5' || account.proxyUrl.startsWith('socks')) {
		options.socksProxy = account.proxyUrl
	} else {
		options.httpProxy = account.proxyUrl
	}
	return new SteamUser(options)
}

function dropClient(client: SteamUser): void {
	try {
		client.logOff()
	} catch {
		// logOff can throw if the connection is already gone
	}
}

async function totpOffset(account: GcAccount): Promise<number> {
	let probe: { id: number; url: string } | null = null
	try {
		if (
			account.proxyKind === 'http' &&
			account.proxyUrl != null &&
			account.proxyId != null
		) {
			probe = { id: account.proxyId, url: account.proxyUrl }
		} else {
			const picked = await pickReadyProxy('api')
			probe = { id: picked.id, url: picked.url }
		}
		const timed = await querySteamTimeOffset(probe.url)
		return timed.offset
	} catch (error) {
		if (probe != null && isProxyTransportError(error)) {
			const message = errorMessage(error)
			await recordResourceAttempt({
				kind: 'proxy',
				resourceId: probe.id,
				ok: false,
				error: message,
			})
			if (account.proxyId === probe.id) throw error
		}
		return 0
	}
}

function persistSession(account: GcAccount, client: SteamUser): void {
	client.on('refreshToken', (token) => {
		void saveSteamSession({ accountId: account.id, refreshToken: token })
	})
	client.on('machineAuthToken', (token) => {
		void saveSteamSession({
			accountId: account.id,
			machineAuthToken: token,
		})
	})
}

async function connect(
	account: GcAccount,
	mode: 'refresh' | 'password',
): Promise<BoundSession> {
	const client = createClient(account)
	const offset = await totpOffset(account)
	const guardAfter = new Date(Date.now() - 15_000)
	let usedEmailGuard = false
	let lastEmailCode: string | null = null
	let lastEmailUid: number | null = null
	const welcomeMs = 45_000

	const ready = new Promise<void>((resolve, reject) => {
		let settled = false
		let timer: ReturnType<typeof setTimeout> | undefined
		let helloTimer: ReturnType<typeof setInterval> | undefined
		const finish = (error?: Error) => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			if (helloTimer !== undefined) clearInterval(helloTimer)
			if (error === undefined) resolve()
			else reject(error)
		}
		const arm = (ms: number) => {
			clearTimeout(timer)
			timer = setTimeout(
				() => finish(new Error('timeout waiting for Dota GC welcome')),
				ms,
			)
		}
		const sendHello = () => {
			client.sendToGC(DOTA_APP_ID, GC_MSG.clientHello, {}, encodeClientHello())
		}
		arm(welcomeMs)
		client.on('error', (error: Error) => finish(error))
		client.on('steamGuard', (domain, callback, lastCodeWrong) => {
			void (async () => {
				try {
					const email = domain != null && domain !== ''
					if (lastCodeWrong && !email && accountHasUsableTotp(account)) {
						finish(
							new SharedSecretBrokenError(
								'shared_secret does not match Steam (TOTP mismatch)',
							),
						)
						return
					}
					if (email) {
						if (!accountCanReadEmailGuard(account)) {
							if (accountHasUsableTotp(account)) {
								finish(
									new SharedSecretBrokenError(
										`shared_secret is not an active authenticator (Steam asked for email Guard at ${domain})`,
									),
								)
								return
							}
							finish(
								new Error(
									`Steam asked for email Guard at ${domain} but no IMAP mailbox is stored`,
								),
							)
							return
						}
						arm(180_000)
						const after = lastCodeWrong
							? new Date(Date.now() - 5_000)
							: guardAfter
						const found = await fetchSteamGuardFromMailbox({
							mailbox: {
								email: account.email ?? '',
								password: account.emailPassword ?? '',
								host: account.emailImapHost,
							},
							after,
							kind: 'login',
							excludeUids: lastEmailUid === null ? [] : [lastEmailUid],
							excludeCodes: lastEmailCode === null ? [] : [lastEmailCode],
						})
						lastEmailCode = found.code
						lastEmailUid = found.uid
						usedEmailGuard = true
						callback(found.code)
						return
					}
					if (accountHasUsableTotp(account) && account.sharedSecret !== null) {
						if (lastCodeWrong) {
							await Bun.sleep(30_000)
						}
						callback(generateAuthCode(account.sharedSecret, offset))
						return
					}
					finish(
						new Error(
							'Steam asked for a mobile Guard code but this account has no shared_secret',
						),
					)
				} catch (error) {
					finish(asError(error))
				}
			})()
		})
		client.on('loggedOn', () => {
			const steamId = client.steamID?.getSteamID64()
			if (steamId !== undefined) {
				void saveSteamSession({ accountId: account.id, steamId })
			}
			logger.info(
				{ login: account.login, mode },
				'steam logged on, launching Dota',
			)
			client.setPersona(1)
			client.gamesPlayed(DOTA_APP_ID, true)
			sendHello()
			helloTimer = setInterval(sendHello, 2_000)
		})
		client.on('appLaunched', (appId: number) => {
			if (appId !== DOTA_APP_ID) return
			logger.info(
				{ login: account.login },
				'dota appLaunched, sending GC hello',
			)
			sendHello()
		})
		client.on('receivedFromGC', (appId: number, msgType: number, body) => {
			if (appId !== DOTA_APP_ID) return
			if (msgType === GC_MSG.clientWelcome) {
				finish()
				return
			}
			if (msgType === GC_MSG.connectionStatus) {
				const status = Number(
					decodeFields(body).find((f) => f.field === 1)?.varint ?? -1n,
				)
				if (status === 0) finish()
				if (status === 3) arm(120_000)
			}
		})
	})

	client.on('disconnected', () => {
		if (session?.client === client) session = null
	})
	client.on('error', (error: Error) => {
		if (isProxyTransportError(error) && account.proxyId != null) {
			void recordResourceAttempt({
				kind: 'proxy',
				resourceId: account.proxyId,
				ok: false,
				error: error.message,
			})
		}
		if (session?.client === client) session = null
	})
	persistSession(account, client)

	try {
		if (mode === 'refresh') {
			const token = account.refreshToken
			if (token === null) throw new Error('refresh token missing')
			logger.info({ login: account.login }, 'steam GC logOn refreshToken')
			client.logOn({ refreshToken: token })
		} else {
			const details: {
				accountName: string
				password: string
				machineAuthToken?: string
				twoFactorCode?: string
			} = {
				accountName: account.login,
				password: account.password,
			}
			if (account.machineAuthToken !== null) {
				details.machineAuthToken = account.machineAuthToken
			}
			if (accountHasUsableTotp(account) && account.sharedSecret !== null) {
				details.twoFactorCode = generateAuthCode(account.sharedSecret, offset)
			}
			logger.info({ login: account.login }, 'steam GC logOn password')
			client.logOn(details)
		}
		await ready
		await markAccountLogin(account.id, {
			totpOk: accountHasUsableTotp(account) && !usedEmailGuard,
		})
		if (account.proxyId != null) {
			await recordResourceAttempt({
				kind: 'proxy',
				resourceId: account.proxyId,
				ok: true,
			})
		}
		await recordResourceAttempt({
			kind: 'gc_account',
			resourceId: account.id,
			ok: true,
		})
		if (usedEmailGuard && account.sharedSecret !== null) {
			await markSharedSecretBroken(
				account.id,
				'Steam asked for email Guard; logged in via IMAP',
			)
		}
		return { account, client }
	} catch (error) {
		dropClient(client)
		throw error
	}
}

async function bindStickyProxy(account: GcAccount): Promise<GcAccount> {
	const proxy = await ensureAccountProxy({
		accountId: account.id,
		proxyId: account.proxyId,
	})
	return {
		...account,
		proxyId: proxy.id,
		proxyUrl: proxy.url,
		proxyKind: proxy.kind,
	}
}

async function connectAccount(account: GcAccount): Promise<BoundSession> {
	let current = await bindStickyProxy(account)
	while (true) {
		try {
			if (
				refreshTokenUsable(current.refreshToken, current.refreshTokenExpiresAt)
			) {
				try {
					return await connect(current, 'refresh')
				} catch (error) {
					if (isGcWelcomeTimeout(error)) throw error
					if (isProxyTransportError(error)) throw error
					const message = errorMessage(error)
					logger.warn(
						{ login: current.login, err: message },
						'refresh token logOn failed, using password',
					)
					await clearRefreshToken(current.id)
					current = {
						...current,
						refreshToken: null,
						refreshTokenExpiresAt: null,
					}
				}
			}
			return await connect(current, 'password')
		} catch (error) {
			if (isProxyTransportError(error) && current.proxyId != null) {
				const message = errorMessage(error)
				const next = await rotateAccountProxy({
					accountId: current.id,
					deadProxyId: current.proxyId,
					error: message,
					preferKind: current.proxyKind === 'socks5' ? 'http' : undefined,
				})
				current = {
					...current,
					proxyId: next.id,
					proxyUrl: next.url,
					proxyKind: next.kind,
				}
				continue
			}
			throw error
		}
	}
}

async function recordConnectFailure(
	account: GcAccount,
	error: unknown,
): Promise<void> {
	const message = errorMessage(error)
	if (error instanceof SharedSecretBrokenError) {
		await markSharedSecretBroken(account.id, message)
		return
	}
	if (/InvalidPassword/i.test(message)) {
		await disableResource({
			kind: 'gc_account',
			resourceId: account.id,
			error: message,
			giveUp: true,
		})
		return
	}
	if (/rate.?limit/i.test(message)) {
		const settings = await getAppSettings()
		await markAccountError(account.id, message, {
			rateLimitMs: settings.gcAccountRateLimitMs,
		})
		return
	}
	await recordResourceAttempt({
		kind: 'gc_account',
		resourceId: account.id,
		ok: false,
		error: message,
	})
}

export async function getGcSession(): Promise<BoundSession> {
	if (session !== null) {
		if (await isProxyUsable(session.account.proxyId, 'gc')) return session
		logger.warn(
			{
				login: session.account.login,
				proxyId: session.account.proxyId,
			},
			'GC session proxy is dead, reconnecting',
		)
		dropClient(session.client)
		session = null
	}
	if (connecting !== null) return connecting
	connecting = openGcSession()
	try {
		return await connecting
	} finally {
		connecting = null
	}
}

async function openGcSession(): Promise<BoundSession> {
	const listed = await listGcAccounts()
	const dedicated = listed.filter((account) => accountIsGcEligible(account))
	const accounts = selectGcPool(listed)
	if (accounts.length === 0) {
		throw new Error(
			'no usable Steam account for GC — need a ready account with a password and no shared_secret',
		)
	}
	if (dedicated.length === 0) {
		logger.warn(
			{ logins: accounts.map((account) => account.login) },
			'GC pool empty — using a Web API account for CMsgGCMatchDetailsRequest',
		)
	}
	let lastError: unknown = new Error(
		'no usable Steam account for GC — need a ready account with a password and no shared_secret',
	)
	let imapPasswordAuthDead = false
	let gcWelcomeFailed = false
	for (const account of accounts) {
		const canRefresh = refreshTokenUsable(
			account.refreshToken,
			account.refreshTokenExpiresAt,
		)
		if (
			imapPasswordAuthDead &&
			accountCanReadEmailGuard(account) &&
			!canRefresh
		) {
			logger.warn(
				{ login: account.login },
				'skipping IMAP account after sibling basic-auth failure',
			)
			continue
		}
		if (gcWelcomeFailed) {
			logger.warn(
				{ login: account.login },
				'skipping account after GC welcome timeout on a sibling',
			)
			continue
		}
		try {
			session = await connectAccount(account)
			return session
		} catch (error) {
			lastError = error
			if (isNoUsableProxy(error)) throw error
			await recordConnectFailure(account, error)
			if (isImapBasicAuthDisabled(error)) imapPasswordAuthDead = true
			if (isGcWelcomeTimeout(error)) {
				gcWelcomeFailed = true
			}
		}
	}
	throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export async function requestMatchReplayLocator(
	matchId: number,
): Promise<
	GcMatchReplayLocator & { accountId: number; proxyId: number | null }
> {
	const bound = await getGcSession()
	const payload = encodeMatchDetailsRequest(matchId)

	const buffer = await new Promise<Buffer>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`GC match details timeout for ${matchId}`)),
			15_000,
		)
		bound.client.sendToGC(
			DOTA_APP_ID,
			GC_MSG.matchDetailsRequest,
			{},
			payload,
			(_appId, _msgType, body) => {
				clearTimeout(timer)
				resolve(Buffer.from(body))
			},
		)
	})

	return {
		...decodeMatchDetailsResponse(buffer),
		accountId: bound.account.id,
		proxyId: bound.account.proxyId,
	}
}

export async function closeGcSession(): Promise<void> {
	if (session === null) return
	const current = session
	session = null
	current.client.logOff()
}
