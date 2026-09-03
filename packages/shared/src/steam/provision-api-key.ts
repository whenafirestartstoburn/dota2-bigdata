import {
	EAuthSessionGuardType,
	EAuthTokenPlatformType,
	LoginSession,
} from 'steam-session'
import {
	accountCanReadEmailGuard,
	accountHasUsableTotp,
	type GcAccount,
	getGcAccountByLogin,
	saveApiKey,
	saveSharedSecret,
	saveSteamSession,
} from '#src/components/resources'
import {
	addAuthenticator,
	confirmChannel,
	describeAddAuthenticatorFailure,
	finalizeAuthenticator,
	sendAuthenticatorEmail,
} from '#src/steam/add-authenticator'
import {
	type ConfirmationAuth,
	confirmationTimeOffset,
	issueWebApiKey,
	mobileAccessCookies,
} from '#src/steam/confirmations'
import {
	fetchSteamGuardFromMailbox,
	type SteamMailbox,
} from '#src/steam/email-guard'
import {
	FetchWebApiTransport,
	fetchWebCookies,
} from '#src/steam/fetch-transport'
import { STEAM_MOBILE_UA } from '#src/steam/http'
import { jwtHasAudience, refreshTokenUsable } from '#src/steam/jwt'
import { generateAuthCode, querySteamTimeOffset } from '#src/steam/totp'
import { errorMessage } from '#src/store/coerce'
import { logger } from '#src/utils/logger'
import { status } from '#src/utils/status'

function mailboxFor(account: GcAccount): SteamMailbox | null {
	if (!accountCanReadEmailGuard(account)) return null
	return {
		email: account.email ?? '',
		password: account.emailPassword ?? '',
		host: account.emailImapHost,
	}
}

async function persistMobileSession(
	accountId: number,
	session: LoginSession,
): Promise<{ steamId: string; accessToken: string; refreshToken: string }> {
	const steamId = session.steamID.getSteamID64()
	const accessToken = session.accessToken
	const refreshToken = session.refreshToken
	if (accessToken == null || accessToken === '') {
		throw new Error('mobile login produced no access token')
	}
	if (refreshToken == null || refreshToken === '') {
		throw new Error('login produced no refresh token')
	}
	await saveSteamSession({ accountId, steamId, refreshToken })
	return { steamId, accessToken, refreshToken }
}

async function sessionFromRefreshToken(
	refreshToken: string,
): Promise<LoginSession> {
	const session = new LoginSession(EAuthTokenPlatformType.MobileApp, {
		transport: new FetchWebApiTransport(undefined, STEAM_MOBILE_UA),
		userAgent: STEAM_MOBILE_UA,
	})
	session.refreshToken = refreshToken
	await session.refreshAccessToken()
	return session
}

async function loginMobileSession(input: {
	login: string
	password: string
	appCode: string
	mailbox: SteamMailbox | null
	usedMailUids?: number[]
}): Promise<LoginSession> {
	const session = new LoginSession(EAuthTokenPlatformType.MobileApp, {
		transport: new FetchWebApiTransport(undefined, STEAM_MOBILE_UA),
		userAgent: STEAM_MOBILE_UA,
	})
	session.loginTimeout = 25_000
	session.on('debug', (message: unknown) => {
		if (typeof message !== 'string') return
		if (message.includes('token') || message.includes('password')) return
		if (message === 'submitting steam guard code') {
			status('steam: submitting Guard code')
			return
		}
		status(`steam: ${message}`)
	})
	const authenticated = new Promise<void>((resolve, reject) => {
		session.once('authenticated', () => resolve())
		session.once('error', (error: Error) => reject(error))
		session.once('timeout', () =>
			reject(new Error('steam-session login timed out')),
		)
	})
	const guardAfter = new Date(Date.now() - 10_000)
	const usedMailUids = input.usedMailUids ?? []
	status('steam: startWithCredentials…')
	let start: Awaited<ReturnType<LoginSession['startWithCredentials']>>
	try {
		start = await Promise.race([
			session.startWithCredentials({
				accountName: input.login,
				password: input.password,
				steamGuardCode: input.appCode === '' ? undefined : input.appCode,
			}),
			Bun.sleep(20_000).then(() => {
				throw new Error('steam startWithCredentials timed out')
			}),
		])
	} catch (error) {
		session.cancelLoginAttempt()
		throw error
	}
	if (start.actionRequired) {
		const actions = start.validActions ?? []
		const names = actions
			.map(
				(action) => EAuthSessionGuardType[action.type] ?? String(action.type),
			)
			.join(', ')
		status(`steam: guard required (${names})`)
		const tapOnly = actions.every(
			(action) =>
				action.type === EAuthSessionGuardType.DeviceConfirmation ||
				action.type === EAuthSessionGuardType.EmailConfirmation,
		)
		if (
			tapOnly ||
			actions.some(
				(action) => action.type === EAuthSessionGuardType.DeviceConfirmation,
			)
		) {
			session.cancelLoginAttempt()
			throw new Error(
				'Steam asked for a device tap on this login; cannot confirm without an already-enrolled authenticator',
			)
		}
		for (const action of actions) {
			if (action.type === EAuthSessionGuardType.EmailCode) {
				if (input.mailbox == null) {
					session.cancelLoginAttempt()
					throw new Error(
						'Steam asked for an email Guard code but no IMAP mailbox is stored',
					)
				}
				status(`steam: waiting for login Guard email at ${input.mailbox.email}`)
				const found = await fetchSteamGuardFromMailbox({
					mailbox: input.mailbox,
					after: guardAfter,
					kind: 'login',
					excludeUids: usedMailUids,
				})
				usedMailUids.push(found.uid)
				status(
					`steam: login Guard uid=${String(found.uid)} template=${found.template ?? '-'}`,
				)
				await session.submitSteamGuardCode(found.code)
			} else if (action.type === EAuthSessionGuardType.DeviceCode) {
				if (input.appCode === '') {
					session.cancelLoginAttempt()
					throw new Error(
						'Steam asked for a mobile Guard code but this account has no shared_secret',
					)
				}
				session.cancelLoginAttempt()
				throw new Error('Steam rejected the TOTP code from shared_secret')
			}
		}
	} else {
		status('steam: credentials accepted, waiting for session…')
	}
	await Promise.race([
		authenticated,
		Bun.sleep(20_000).then(() => {
			throw new Error('steam authenticated timed out')
		}),
	])
	await session.refreshAccessToken()
	status(`steam: authenticated steamId=${session.steamID.getSteamID64()}`)
	return session
}

async function totpCodeForAccount(account: GcAccount): Promise<string> {
	if (!accountHasUsableTotp(account) || account.sharedSecret === null) {
		return ''
	}
	try {
		const { offset } = await querySteamTimeOffset()
		return generateAuthCode(account.sharedSecret, offset)
	} catch {
		return generateAuthCode(account.sharedSecret)
	}
}

async function loginMobileForAccount(
	account: GcAccount,
): Promise<LoginSession> {
	const token = account.refreshToken
	if (
		token != null &&
		refreshTokenUsable(token, account.refreshTokenExpiresAt) &&
		jwtHasAudience(token, 'mobile')
	) {
		try {
			status(`steam: refreshing mobile session for ${account.login}`)
			return await sessionFromRefreshToken(token)
		} catch (error) {
			status(
				`steam: refresh token failed for ${account.login}, logging in with password`,
			)
			logger.warn(
				{ login: account.login, err: errorMessage(error) },
				'mobile refresh token failed, logging in with password',
			)
		}
	}
	if (account.password === '') {
		throw new Error(`password is required for ${account.login}`)
	}
	return loginMobileSession({
		login: account.login,
		password: account.password,
		appCode: await totpCodeForAccount(account),
		mailbox: mailboxFor(account),
	})
}

async function enrollViaEmail(login: string): Promise<GcAccount> {
	let account = await getGcAccountByLogin(login)
	if (account == null) {
		throw new Error(`no steam_accounts row for login=${login}`)
	}
	const mailbox = mailboxFor(account)
	if (mailbox == null) {
		throw new Error(
			`${login} has no shared_secret and no IMAP mailbox — cannot enroll Guard`,
		)
	}
	if (account.password === '') {
		throw new Error(`password is required for ${login}`)
	}
	const usedMailUids: number[] = []
	status(`steam: enrolling mobile authenticator via email for ${login}`)
	const session = await loginMobileSession({
		login,
		password: account.password,
		appCode: '',
		mailbox,
		usedMailUids,
	})
	const steamId = session.steamID.getSteamID64()
	const activationAfter = new Date()
	status(`steam: AddAuthenticator steamId=${steamId}`)
	const enabled = await addAuthenticator({
		steamId,
		accessToken: session.accessToken,
	})
	if (enabled.status !== 1) {
		throw new Error(describeAddAuthenticatorFailure(enabled))
	}
	if (
		enabled.shared_secret === undefined ||
		enabled.identity_secret === undefined ||
		enabled.revocation_code === undefined
	) {
		throw new Error('AddAuthenticator OK but secrets missing')
	}
	const channel = confirmChannel(enabled)
	if (channel === 'sms') {
		throw new Error(
			`${login}: Steam asked for SMS to finish Guard enrollment; cannot issue an API key from email-only mail`,
		)
	}
	status(`steam: confirm channel=${channel}, sending activation email`)
	try {
		await sendAuthenticatorEmail({
			steamId,
			accessToken: session.accessToken,
		})
		status('steam: asked Steam to send the activation email')
	} catch (error) {
		status(`steam: SendEmail for authenticator failed: ${errorMessage(error)}`)
		logger.warn(
			{ login, err: errorMessage(error) },
			'SendEmail for authenticator failed',
		)
	}
	status(`steam: waiting for AuthenticatorAdd email at ${mailbox.email}`)
	const found = await fetchSteamGuardFromMailbox({
		mailbox,
		after: activationAfter,
		kind: 'authenticator',
		excludeUids: usedMailUids,
		timeoutMs: 120_000,
	})
	status(
		`steam: activation uid=${String(found.uid)} template=${found.template ?? '-'}`,
	)
	status('steam: FinalizeAddAuthenticator')
	let last = await finalizeAuthenticator({
		steamId,
		accessToken: session.accessToken,
		sharedSecret: enabled.shared_secret,
		activationCode: found.code,
		viaSms: false,
	})
	for (let attempt = 0; attempt < 5 && last.want_more === true; attempt++) {
		last = await finalizeAuthenticator({
			steamId,
			accessToken: session.accessToken,
			sharedSecret: enabled.shared_secret,
			activationCode: found.code,
			viaSms: false,
		})
	}
	if (last.success !== true && last.status !== 1) {
		throw new Error(
			`FinalizeAddAuthenticator failed: status=${String(last.status)}`,
		)
	}
	await saveSharedSecret({
		login,
		password: account.password,
		sharedSecret: enabled.shared_secret,
		identitySecret: enabled.identity_secret,
	})
	account = await getGcAccountByLogin(login)
	if (account == null) {
		throw new Error(`failed to reload steam_accounts row for ${login}`)
	}
	await persistMobileSession(account.id, session)
	status(`steam: authenticator enrolled for ${login}`)
	const saved = await getGcAccountByLogin(login)
	if (saved == null) {
		throw new Error(`failed to reload steam_accounts row for ${login}`)
	}
	return saved
}

async function communityGuardContext(account: GcAccount): Promise<{
	account: GcAccount
	auth: ConfirmationAuth
}> {
	if (!accountHasUsableTotp(account) || account.sharedSecret === null) {
		throw new Error(`${account.login} has no usable shared_secret`)
	}
	if (account.identitySecret == null || account.identitySecret === '') {
		throw new Error(`${account.login} has no identity_secret`)
	}
	const offset = await confirmationTimeOffset()
	status(`steam: querying confirmation clock, logging in for ${account.login}`)
	const session = await loginMobileForAccount(account)
	const { steamId, accessToken, refreshToken } = await persistMobileSession(
		account.id,
		session,
	)
	const cookies = mobileAccessCookies({ steamId, accessToken })
	let webCookies: string[] | undefined
	try {
		status('steam: fetching community cookies for /dev/requestkey')
		webCookies = await fetchWebCookies({ refreshToken, steamId })
		if (webCookies.length === 0) {
			throw new Error('getWebCookies returned no cookies')
		}
	} catch (error) {
		status(
			`steam: jwt/finalizelogin failed; using mobile cookies for /dev/requestkey`,
		)
		logger.warn(
			{ login: account.login, err: errorMessage(error) },
			'jwt/finalizelogin failed; using mobile cookies for /dev/requestkey',
		)
		webCookies = cookies
	}
	return {
		account,
		auth: {
			steamId,
			identitySecret: account.identitySecret,
			cookies,
			webCookies,
			timeOffsetSec: offset,
		},
	}
}

export async function issueApiKeyForLogin(input: {
	login: string
	domain?: string
}): Promise<{ apiKey: string; accountId: number }> {
	let account = await getGcAccountByLogin(input.login)
	if (account === null) {
		throw new Error(`no steam_accounts row for login=${input.login}`)
	}
	if (!accountHasUsableTotp(account) || account.sharedSecret === null) {
		status(`steam: ${input.login} has no TOTP, enrolling Guard from email`)
		account = await enrollViaEmail(input.login)
	} else {
		status(`steam: ${input.login} already has TOTP, issuing API key`)
	}
	const { auth } = await communityGuardContext(account)
	const issued = await issueWebApiKey({
		auth,
		domain: input.domain ?? 'localhost',
		onStatus: (line) => status(`issue-api-key: ${line}`),
	})
	await saveApiKey({ accountId: account.id, apiKey: issued.apiKey })
	status(`steam: Web API key saved for ${input.login}`)
	return { apiKey: issued.apiKey, accountId: account.id }
}
