/// <reference path="../types/steam-user.d.ts" />
import SteamUser from 'steam-user'
import {
	ensureAccountProxy,
	isProxyTransportError,
	proxyHostPort,
	rotateAccountProxy,
} from '#src/components/proxies'
import {
	disableResource,
	recordResourceAttempt,
} from '#src/components/resource-health'
import {
	accountCanReadEmailGuard,
	accountHasUsableTotp,
	type GcAccount,
	getGcAccountByLogin,
	pickGcAccount,
	saveSteamSession,
} from '#src/components/resources'
import { getAppSettings } from '#src/components/settings'
import {
	DOTA_APP_ID,
	decodeFields,
	decodeMatchDetailsResponse,
	encodeClientHello,
	encodeMatchDetailsRequest,
	GC_MSG,
	type GcMatchReplayLocator,
} from '#src/gc/protobuf'
import { fetchSteamGuardFromMailbox } from '#src/steam/email-guard'
import { generateAuthCode, querySteamTimeOffset } from '#src/steam/totp'
import { replayUrl } from '#src/steam/web-api'
import { asError, errorMessage } from '#src/store/coerce'
import { logger } from '#src/utils/logger'
import { status } from '#src/utils/status'

type GuardBag = {
	authCode: string | null
	lastEmailUid: number | null
	lastEmailCode: string | null
}

/** CM websocket died; steam-user/Bun often surface this as "Socket closed". */
export function isTransientCmClose(error: unknown): boolean {
	const message = errorMessage(error)
	if (message === '') return false
	if (
		/InvalidPassword|AccountLogonDenied|TwoFactorCodeMismatch|RateLimit/i.test(
			message,
		)
	) {
		return false
	}
	return /socket closed|noconnection|econnreset|econnrefused|epipe|socket hang up|tryanothercm|serviceunavailable/i.test(
		message,
	)
}

function createClient(account: GcAccount): SteamUser {
	if (account.proxyUrl == null || account.proxyUrl === '') {
		throw new Error(`GC probe for ${account.login} needs a bound proxy`)
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
		// already gone
	}
}

async function waitGcWelcome(input: {
	account: GcAccount
	client: SteamUser
	bag: GuardBag
}): Promise<void> {
	const { account, client, bag } = input
	const offset = await totpOffset(account)
	const guardAfter = new Date(Date.now() - 15_000)
	const welcomeMs = 45_000
	let fetchingGuard = false

	await new Promise<void>((resolve, reject) => {
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
		client.on('error', (error: Error) => {
			if (fetchingGuard && isTransientCmClose(error)) {
				return
			}
			finish(error)
		})
		client.on('steamGuard', (domain, callback, lastCodeWrong) => {
			void (async () => {
				try {
					const email = domain != null && domain !== ''
					if (email) {
						if (!accountCanReadEmailGuard(account)) {
							finish(
								new Error(
									`Steam asked for email Guard at ${domain} but no IMAP mailbox is stored`,
								),
							)
							return
						}
						status(
							`gc: steamGuard email at ${domain} for ${account.email ?? account.login}`,
						)
						arm(180_000)
						fetchingGuard = true
						const found = await fetchSteamGuardFromMailbox({
							mailbox: {
								email: account.email ?? '',
								password: account.emailPassword ?? '',
								host: account.emailImapHost,
							},
							after: lastCodeWrong ? new Date(Date.now() - 5_000) : guardAfter,
							kind: 'login',
							excludeUids: bag.lastEmailUid === null ? [] : [bag.lastEmailUid],
							excludeCodes:
								bag.lastEmailCode === null ? [] : [bag.lastEmailCode],
						})
						bag.lastEmailCode = found.code
						bag.lastEmailUid = found.uid
						bag.authCode = found.code
						status(
							`gc: login Guard uid=${String(found.uid)} template=${found.template ?? '-'}`,
						)
						fetchingGuard = false
						callback(found.code)
						return
					}
					if (accountHasUsableTotp(account) && account.sharedSecret !== null) {
						status('gc: steamGuard TOTP')
						if (lastCodeWrong) await Bun.sleep(30_000)
						callback(generateAuthCode(account.sharedSecret, offset))
						return
					}
					finish(
						new Error(
							'Steam asked for a mobile Guard code but this account has no shared_secret',
						),
					)
				} catch (error) {
					fetchingGuard = false
					finish(asError(error))
				}
			})()
		})
		client.on('loggedOn', () => {
			const steamId = client.steamID?.getSteamID64()
			status(`gc: loggedOn steamId=${steamId ?? '-'} login=${account.login}`)
			if (steamId !== undefined) {
				void saveSteamSession({ accountId: account.id, steamId })
			}
			client.setPersona(1)
			client.gamesPlayed(DOTA_APP_ID, true)
			sendHello()
			helloTimer = setInterval(sendHello, 2_000)
		})
		client.on('appLaunched', (appId: number) => {
			if (appId !== DOTA_APP_ID) return
			sendHello()
		})
		client.on('receivedFromGC', (appId: number, msgType: number, body) => {
			if (appId !== DOTA_APP_ID) return
			if (msgType === GC_MSG.clientWelcome) {
				status(`gc: Dota welcome for ${account.login}`)
				finish()
				return
			}
			if (msgType === GC_MSG.connectionStatus) {
				const gcStatus = Number(
					decodeFields(body).find((f) => f.field === 1)?.varint ?? -1n,
				)
				if (gcStatus === 0) finish()
				if (gcStatus === 3) arm(120_000)
			}
		})
	})
}

async function totpOffset(account: GcAccount): Promise<number> {
	if (account.proxyUrl == null || account.proxyUrl === '') return 0
	try {
		return (await querySteamTimeOffset(account.proxyUrl)).offset
	} catch {
		return 0
	}
}

async function requestLocator(
	client: SteamUser,
	matchId: number,
): Promise<GcMatchReplayLocator> {
	const payload = encodeMatchDetailsRequest(matchId)
	const buffer = await new Promise<Buffer>((resolve, reject) => {
		const timer = setTimeout(
			() =>
				reject(new Error(`GC match details timeout for ${String(matchId)}`)),
			15_000,
		)
		client.sendToGC(
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
	return decodeMatchDetailsResponse(buffer)
}

export type GcSessionApi = {
	login: string
	locate: (matchId: number) => Promise<GcMatchReplayLocator>
}

/** Password-login a Postgres GC account and keep the session for `run`. */
export async function withGcSession<T>(input: {
	login?: string
	run: (api: GcSessionApi) => Promise<T>
}): Promise<T> {
	const bag: GuardBag = {
		authCode: null,
		lastEmailUid: null,
		lastEmailCode: null,
	}
	let lastError: unknown
	const settings = await getAppSettings()
	const attempts = settings.gcLogonAttempts
	for (let attempt = 0; attempt < attempts; attempt++) {
		const picked =
			input.login != null
				? await getGcAccountByLogin(input.login)
				: await pickGcAccount()
		if (picked == null) {
			throw new Error(
				input.login != null
					? `no steam_accounts row for login=${input.login}`
					: 'no usable Steam account for GC',
			)
		}
		await ensureAccountProxy({
			accountId: picked.id,
			proxyId: picked.proxyId,
		})
		const account = (await getGcAccountByLogin(picked.login)) ?? picked
		if (account.password === '') {
			throw new Error(`password is required for ${account.login}`)
		}
		const client = createClient(account)
		client.on('refreshToken', (token) => {
			void saveSteamSession({ accountId: account.id, refreshToken: token })
		})
		client.on('machineAuthToken', (token) => {
			void saveSteamSession({
				accountId: account.id,
				machineAuthToken: token,
			})
		})
		try {
			const details: {
				accountName: string
				password: string
				machineAuthToken?: string
				twoFactorCode?: string
				authCode?: string
			} = {
				accountName: account.login,
				password: account.password,
			}
			if (account.machineAuthToken !== null) {
				details.machineAuthToken = account.machineAuthToken
			}
			if (accountHasUsableTotp(account) && account.sharedSecret !== null) {
				details.twoFactorCode = generateAuthCode(
					account.sharedSecret,
					await totpOffset(account),
				)
			}
			if (bag.authCode != null) details.authCode = bag.authCode
			status(
				attempt === 0
					? `gc: logOn password for ${account.login} via proxy id=${String(account.proxyId ?? '-')} ${account.proxyKind ?? '-'} ${proxyHostPort(account.proxyUrl ?? '')}`
					: `gc: logOn retry ${String(attempt + 1)}/${String(attempts)} for ${account.login} via proxy id=${String(account.proxyId ?? '-')} ${account.proxyKind ?? '-'}${bag.authCode != null ? ' with email Guard code' : ''}`,
			)
			client.logOn(details)
			await waitGcWelcome({ account, client, bag })
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
			return await input.run({
				login: account.login,
				locate: (matchId) => requestLocator(client, matchId),
			})
		} catch (error) {
			lastError = error
			if (isTransientCmClose(error) && attempt < attempts - 1) {
				if (bag.authCode == null && account.proxyId != null) {
					const dead = proxyHostPort(account.proxyUrl ?? '')
					const next = await rotateAccountProxy({
						accountId: account.id,
						deadProxyId: account.proxyId,
						error: errorMessage(error),
						preferKind: account.proxyKind === 'socks5' ? 'http' : undefined,
					})
					status(
						`gc: CM connect failed through proxy id=${String(account.proxyId)} ${account.proxyKind ?? '-'} ${dead}; switched to id=${String(next.id)} ${next.kind} ${proxyHostPort(next.url)}`,
					)
				} else {
					status(`gc: ${errorMessage(error)} for ${account.login}; retrying`)
				}
				await Bun.sleep(2_000 * (attempt + 1))
				continue
			}
			status(`gc: probe failed for ${account.login}: ${errorMessage(error)}`)
			logger.warn(
				{ login: account.login, err: errorMessage(error) },
				'GC probe failed',
			)
			const message = errorMessage(error)
			if (/InvalidPassword/i.test(message)) {
				await disableResource({
					kind: 'gc_account',
					resourceId: account.id,
					error: message,
					giveUp: true,
				})
			} else if (!isProxyTransportError(error)) {
				await recordResourceAttempt({
					kind: 'gc_account',
					resourceId: account.id,
					ok: false,
					error: message,
				})
			}
			throw error
		} finally {
			dropClient(client)
		}
	}
	throw lastError instanceof Error
		? lastError
		: new Error(errorMessage(lastError))
}

/** Password-login this account into Dota GC, persist refresh token, optional match test. */
export async function loginGcAndMaybeTest(input: {
	login: string
	testOnMatchId: number | null
}): Promise<{ replayUrl: string | null }> {
	return withGcSession({
		login: input.login,
		run: async ({ locate }) => {
			if (input.testOnMatchId == null) {
				return { replayUrl: null }
			}
			status(
				`gc: CMsgGCMatchDetailsRequest matchId=${String(input.testOnMatchId)}`,
			)
			const locator = await locate(input.testOnMatchId)
			if (locator.cluster == null || locator.replaySalt == null) {
				throw new Error(
					`GC match ${String(input.testOnMatchId)} has no cluster/salt (result=${String(locator.result)})`,
				)
			}
			const url = replayUrl(
				locator.cluster,
				input.testOnMatchId,
				locator.replaySalt,
			)
			status(`gc: replayUrl=${url}`)
			return { replayUrl: url }
		},
	})
}
