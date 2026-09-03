import { createInterface } from 'node:readline'
import { parseArgs } from 'node:util'
import {
	ensureAccountProxy,
	pickReadyProxy,
	proxyHostPort,
} from '@app/shared/src/components/proxies'
import {
	accountCanReadEmailGuard,
	accountHasUsableTotp,
	type GcAccount,
	getGcAccountByLogin,
	getSteamMailbox,
	saveApiKey,
	saveSharedSecret,
	saveSteamSession,
	upsertSteamAccount,
} from '@app/shared/src/components/resources'
import {
	buyAccounts,
	parseBuyAccountCliInput,
} from '@app/shared/src/marketplace/buy-account'
import {
	addAuthenticator,
	confirmChannel,
	describeAddAuthenticatorFailure,
	finalizeAuthenticator,
	sendAuthenticatorEmail,
} from '@app/shared/src/steam/add-authenticator'
import {
	acceptConfirmations,
	type ConfirmationAuth,
	confirmationsToAccept,
	confirmationTimeOffset,
	describeConfirmation,
	listConfirmations,
	mobileAccessCookies,
} from '@app/shared/src/steam/confirmations'
import {
	fetchSteamGuardFromMailbox,
	latestSteamGuardMails,
	type SteamMailbox,
} from '@app/shared/src/steam/email-guard'
import { loginGcAndMaybeTest } from '@app/shared/src/steam/gc-probe'
import type { SteamGuardMailKind } from '@app/shared/src/steam/guard-code'
import {
	runWithProxy,
	STEAM_CHROME_UA,
	STEAM_MOBILE_UA,
} from '@app/shared/src/steam/http'
import { jwtHasAudience, refreshTokenUsable } from '@app/shared/src/steam/jwt'
import {
	accountPhoneStatus,
	inferPhoneCountry,
	isAccountWaitingForEmailConfirmation,
	maskPhone,
	normalizePhoneNumber,
	sendPhoneVerificationCode,
	setAccountPhoneNumber,
	verifyAccountPhoneWithCode,
} from '@app/shared/src/steam/phone'
import { issueApiKeyForLogin } from '@app/shared/src/steam/provision-api-key'
import {
	assertSharedSecretShape,
	generateAuthCode,
	querySteamTimeOffset,
} from '@app/shared/src/steam/totp'
import { asNumber, errorMessage } from '@app/shared/src/store/coerce'
import { withStatus } from '@app/shared/src/utils/status'
import {
	EAuthSessionGuardType,
	EAuthTokenPlatformType,
	LoginSession,
} from 'steam-session'
import { FetchWebApiTransport, fetchWebCookies } from './steam-fetch-transport'

const USAGE = `steam-guard <command>

  add            --login <login>            insert/update steam_accounts (password prompt)
  code           --login <login>            print TOTP from steam_accounts.shared_secret
  code           --secret <shared_secret>   print TOTP from an explicit shared_secret
  get-last-code  --login <login> [--kind login|authenticator]
                                            print newest IMAP Guard codes
                                            (login vs authenticator setup)
  setup          [--login <login>]          enroll a mobile authenticator (email/IMAP)
  add-phone      --login <login> --phone <+E164> [--country XX]
                                            link a phone number (email click + SMS)
  confirm        --login <login> [--list]   accept pending mobile confirmations
  issue-api-key  --login <login> [--domain <host>]
                                            register a Steam Web API key
  scrape-match   --login <login> --match-id <match>
                                            GC login this account and fetch match details
  gc-login       --login <login> [--test-on-match-id <match>]
                                            password-login this account into Dota GC
  save           --login <login> --secret <shared_secret> [--identity <identity_secret>]
                                            write secrets into steam_accounts
  buy-account    --product-id <id> --type api_key|gc [--store dark_shopping]
                 [--count 1] [--test-on-match-id <match>] [--imap-host <host>]
                                            buy from a marketplace, same as POST /api/buy-account

add writes login + password (+ optional API key / shared_secret) to Postgres.
setup logs in as the Steam mobile client and calls ITwoFactorService.
Activation is read from the account IMAP mailbox when stored; otherwise you
type the email/SMS code. Steam may still require a phone (EResult.Fail) —
then run add-phone first. DuplicateRequest means Guard is already enabled.

add-phone logs in as the Steam mobile client, calls IPhoneService, then
waits for you to open the confirmation email and type the SMS code.
--phone is E.164 (+7916…). --country is ISO-3166 (RU, US); if omitted it
is inferred from the number or from Steam's GetUserCountry.

issue-api-key logs in as the Steam mobile client (or reuses a saved refresh
token), POSTs /dev/requestkey with browser cookies, accepts the Guard
confirmation the same way the iOS app does (/mobileconf getlist + ajaxop),
then POSTs requestkey again with the pending request_id. It does not open
/dev/apikey. --domain defaults to localhost.

If the account has no shared_secret yet but has an IMAP mailbox, issue-api-key
enrolls the authenticator from email (no SMS) before registering the key.
shared_secret, identity_secret, and the mobile refresh token are written only
after FinalizeAddAuthenticator succeeds. GC password logins still persist a
refresh token on their own.

Password is never taken from argv. setup only reuses STEAM_SEED_PASSWORD
when --login matches STEAM_SEED_LOGIN; otherwise it prompts. confirm and
issue-api-key reuse the password stored in steam_accounts. IMAP mailboxes
are used for email Guard / authenticator activation when stored.

get-last-code only talks to the stored IMAP host (no Steam login).
Login Guard and authenticator-setup are different mails; --kind picks one,
otherwise both are printed. Already-seen UIDs are not reused in setup.

buy-account creates one Dark Shopping order per --count (capped by
settings.marketplace_buy_max), waits up to settings.marketplace_wait_ms
for delivery, then provisions. --store defaults to dark_shopping.
--imap-host skips auto-detect and LOGINs that host (still refuses
Outlook/Hotmail for type=api_key).

scrape-match password-logins a stored GC account (sticky proxy, Guard/IMAP
as needed) and sends CMsgGCMatchDetailsRequest for --match-id. Prints the
replay URL on stdout. gc-login is the same without a required match.
`

async function question(prompt: string, silent = false): Promise<string> {
	if (!silent) {
		const rl = createInterface({ input: process.stdin, output: process.stdout })
		const answer = await new Promise<string>((resolve) => {
			rl.question(prompt, resolve)
		})
		rl.close()
		return answer.trim()
	}

	process.stdout.write(prompt)
	const stdin = process.stdin
	stdin.setRawMode?.(true)
	stdin.resume()
	stdin.setEncoding('utf8')
	let value = ''
	await new Promise<void>((resolve) => {
		const onData = (chunk: string) => {
			if (chunk === '\n' || chunk === '\r') {
				stdin.setRawMode?.(false)
				stdin.pause()
				stdin.removeListener('data', onData)
				process.stdout.write('\n')
				resolve()
				return
			}
			if (chunk === '\u0003') process.exit(1)
			if (chunk === '\u007f') {
				value = value.slice(0, -1)
				return
			}
			value += chunk
		}
		stdin.on('data', onData)
	})
	return value
}

async function cmdCode(values: {
	login?: string
	secret?: string
}): Promise<void> {
	let value = values.secret
	if (value === undefined && values.login !== undefined) {
		const account = await getGcAccountByLogin(values.login)
		if (account === null) {
			throw new Error(`no steam_accounts row for login=${values.login}`)
		}
		if (!accountHasUsableTotp(account) || account.sharedSecret === null) {
			throw new Error(
				`${values.login} has no usable shared_secret — run setup or save first`,
			)
		}
		value = account.sharedSecret
	}
	if (value === undefined) value = await question('shared_secret: ')
	assertSharedSecretShape(value)
	try {
		const { offset, latencyMs } = await withApiProxy(() =>
			querySteamTimeOffset(),
		)
		console.error(`steam time offset ${offset}s (rtt ${latencyMs}ms)`)
		console.log(generateAuthCode(value, offset))
	} catch {
		console.log(generateAuthCode(value))
	}
}

function parseGuardKind(raw: string | undefined): SteamGuardMailKind | null {
	if (raw === undefined || raw === '') return null
	if (raw === 'login' || raw === 'authenticator') return raw
	throw new Error('--kind must be login or authenticator')
}

function printGuardMail(
	kind: SteamGuardMailKind,
	mail: {
		code: string
		uid: number
		date: string | null
		template: string | null
	} | null,
	stdoutKind: boolean,
): void {
	if (mail === null) {
		console.error(`${kind}: (none)`)
		return
	}
	console.error(
		`${kind} uid=${String(mail.uid)} date=${mail.date ?? '-'} template=${mail.template ?? '-'}`,
	)
	console.log(stdoutKind ? mail.code : `${kind} ${mail.code}`)
}

async function cmdGetLastCode(input: {
	login: string | undefined
	kind: string | undefined
}): Promise<void> {
	const login = input.login ?? (await question('Steam login: '))
	const kind = parseGuardKind(input.kind)
	const mailbox = await getSteamMailbox(login)
	if (mailbox === null) {
		throw new Error(
			`no IMAP mailbox stored for login=${login} — set email + email_password`,
		)
	}
	if (mailbox.emailImapHost == null || mailbox.emailImapHost === '') {
		throw new Error(
			`no email_imap_host for login=${login} — will not guess a mail host`,
		)
	}
	console.error(`get-last-code ${login}: IMAP ${mailbox.emailImapHost}`)
	const found = await latestSteamGuardMails({
		email: mailbox.email,
		password: mailbox.emailPassword,
		host: mailbox.emailImapHost,
	})
	if (kind !== null) {
		printGuardMail(kind, found[kind], true)
		if (found[kind] === null) {
			throw new Error(`no ${kind} Steam Guard code in recent mail`)
		}
		return
	}
	printGuardMail('login', found.login, false)
	printGuardMail('authenticator', found.authenticator, false)
	if (found.login === null && found.authenticator === null) {
		throw new Error(`no Steam Guard code in recent mail for ${mailbox.email}`)
	}
}

function passwordForLogin(login: string): Promise<string> | string {
	const seedLogin = process.env.STEAM_SEED_LOGIN?.trim() ?? ''
	const seedPassword = process.env.STEAM_SEED_PASSWORD ?? ''
	if (seedPassword !== '' && login === seedLogin) return seedPassword
	return question('Steam password: ', true)
}

async function cmdAdd(loginFlag: string | undefined): Promise<void> {
	const login = loginFlag ?? (await question('Steam login: '))
	const password = await question('Steam password: ', true)
	if (password === '') throw new Error('password is required')
	const apiKey = await question('Steam Web API key (empty to skip): ')
	const secret = await question('shared_secret (empty to skip): ')
	const identity =
		secret === '' ? '' : await question('identity_secret (empty to skip): ')

	const accountId = await upsertSteamAccount({
		login,
		password,
		sharedSecret: secret === '' ? null : secret,
		identitySecret: identity === '' ? null : identity,
	})
	if (apiKey !== '') await saveApiKey({ accountId, apiKey })
	console.error(
		secret === ''
			? `saved ${login} (id=${accountId}). GC login needs a refresh token, TOTP, or IMAP mailbox.`
			: `saved ${login} (id=${accountId})`,
	)
}

async function withApiProxy<T>(fn: () => Promise<T>): Promise<T> {
	const proxy = await pickReadyProxy('api')
	console.error(`steam: using proxy ${proxyHostPort(proxy.url)}`)
	return runWithProxy(proxy.url, fn)
}

async function loginSteamSession(
	platform: EAuthTokenPlatformType,
	login: string,
	password: string,
	appCode: string,
	options?: {
		mailbox?: SteamMailbox | null
		usedMailUids?: number[]
	},
): Promise<LoginSession> {
	const userAgent =
		platform === EAuthTokenPlatformType.MobileApp
			? STEAM_MOBILE_UA
			: STEAM_CHROME_UA
	const session = new LoginSession(platform, {
		transport: new FetchWebApiTransport(undefined, userAgent),
		userAgent,
	})
	session.loginTimeout = 25_000
	attachSteamDebug(session)
	const authenticated = new Promise<void>((resolve, reject) => {
		session.once('authenticated', () => resolve())
		session.once('error', (error: Error) => reject(error))
		session.once('timeout', () =>
			reject(new Error('steam-session login timed out')),
		)
	})
	const guardAfter = new Date(Date.now() - 10_000)
	console.error('steam: startWithCredentials…')
	let start: Awaited<ReturnType<LoginSession['startWithCredentials']>>
	try {
		start = await Promise.race([
			session.startWithCredentials({
				accountName: login,
				password,
				steamGuardCode: appCode === '' ? undefined : appCode,
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
		const names = actions.map((action) => guardName(action.type)).join(', ')
		console.error(`steam: guard required (${names})`)
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
				'Steam asked for a device tap on this login. This CLI is the authenticator and cannot tap itself. Retry in a few seconds.',
			)
		}
		for (const action of actions) {
			if (action.type === EAuthSessionGuardType.EmailCode) {
				const domain =
					typeof action.detail === 'string' ? action.detail : 'email'
				const code = await steamGuardEmailCode({
					domain,
					mailbox: options?.mailbox,
					after: guardAfter,
					usedMailUids: options?.usedMailUids,
				})
				await session.submitSteamGuardCode(code)
			} else if (action.type === EAuthSessionGuardType.DeviceCode) {
				if (appCode !== '') {
					session.cancelLoginAttempt()
					throw new Error('Steam rejected the TOTP code from shared_secret')
				}
				const code = await question('Steam Guard authenticator app code: ')
				await session.submitSteamGuardCode(code)
			}
		}
	} else {
		console.error('steam: credentials accepted, waiting for session…')
	}
	await Promise.race([
		authenticated,
		Bun.sleep(20_000).then(() => {
			throw new Error('steam authenticated timed out')
		}),
	])
	if (platform === EAuthTokenPlatformType.MobileApp) {
		await session.refreshAccessToken()
	}
	return session
}

async function steamGuardEmailCode(input: {
	domain: string
	mailbox?: SteamMailbox | null
	after: Date
	usedMailUids?: number[]
}): Promise<string> {
	const mailbox = input.mailbox
	if (mailbox == null) {
		return question(`Steam Guard email (${input.domain}) code: `)
	}
	console.error(`steam: waiting for login Guard email at ${mailbox.email}`)
	const found = await fetchSteamGuardFromMailbox({
		mailbox,
		after: input.after,
		kind: 'login',
		excludeUids: input.usedMailUids,
	})
	input.usedMailUids?.push(found.uid)
	console.error(
		`steam: login Guard uid=${String(found.uid)} template=${found.template ?? '-'}`,
	)
	return found.code
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

function attachSteamDebug(session: LoginSession): void {
	session.on('debug', (message: unknown) => {
		if (typeof message !== 'string') return
		if (message === 'submitting steam guard code') {
			console.error('steam: submitting TOTP')
			return
		}
		if (message.includes('token') || message.includes('password')) return
		console.error(`steam: ${message}`)
	})
}

function guardName(type: EAuthSessionGuardType): string {
	return EAuthSessionGuardType[type] ?? String(type)
}

async function loginMobileSession(
	login: string,
	password: string,
	appCode: string,
	mailbox?: SteamMailbox | null,
	usedMailUids?: number[],
): Promise<LoginSession> {
	return loginSteamSession(
		EAuthTokenPlatformType.MobileApp,
		login,
		password,
		appCode,
		{ mailbox, usedMailUids },
	)
}

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

async function cmdSetup(loginFlag: string | undefined): Promise<void> {
	const login =
		loginFlag ??
		process.env.STEAM_SEED_LOGIN ??
		(await question('Steam login: '))
	await enrollMobileAuthenticator(login, { interactive: true })
}

async function enrollMobileAuthenticator(
	login: string,
	options: { interactive: boolean },
): Promise<GcAccount> {
	let account = await getGcAccountByLogin(login)
	const mailbox = account != null ? mailboxFor(account) : null
	if (!options.interactive && mailbox == null) {
		throw new Error(
			`${login} has no shared_secret and no IMAP mailbox — import email credentials or run setup interactively`,
		)
	}
	const password =
		account != null && account.password !== ''
			? account.password
			: await passwordForLogin(login)
	if (password === '') throw new Error('password is required')
	const appCode = options.interactive
		? await question('Steam Guard app code (empty if email-only / none): ')
		: ''

	const usedMailUids: number[] = []
	console.error('logging in as Steam Mobile client…')
	const session = await loginMobileSession(
		login,
		password,
		appCode,
		mailbox,
		usedMailUids,
	)
	const steamId = session.steamID.getSteamID64()
	console.error(`logged in ${steamId}, requesting authenticator enrollment…`)

	const activationAfter = new Date()
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
		throw new Error(
			`AddAuthenticator OK but secrets missing: ${JSON.stringify(enabled)}`,
		)
	}

	console.log('shared_secret=', enabled.shared_secret)
	console.log('identity_secret=', enabled.identity_secret)
	console.log('revocation_code=', enabled.revocation_code)
	console.error(
		'Copy those three now. revocation_code is the only recovery key.',
		'They are not written to Postgres until FinalizeAddAuthenticator succeeds.',
	)

	const channel = confirmChannel(enabled)
	if (enabled.phone_number_hint !== undefined) {
		console.error(`phone_number_hint=${enabled.phone_number_hint}`)
	}
	if (channel === 'sms' && !options.interactive) {
		throw new Error(
			`${login}: Steam asked for SMS to finish Guard enrollment. Link email Guard or run setup interactively.`,
		)
	}
	if (channel !== 'sms') {
		console.error(
			channel === 'email'
				? 'Steam will email the activation code (not SMS).'
				: 'No SMS expected unless a phone is on the account. Check the Steam email.',
		)
		try {
			await sendAuthenticatorEmail({
				steamId,
				accessToken: session.accessToken,
			})
			console.error('asked Steam to send the activation email')
		} catch (error) {
			console.error(`SendEmail failed: ${errorMessage(error)}`)
		}
	} else {
		console.error('Steam should SMS the activation code to the linked phone.')
	}

	const sms = await readActivationCode({
		interactive: options.interactive,
		mailbox,
		after: activationAfter,
		usedMailUids,
		steamId,
		accessToken: session.accessToken,
	})
	let last = await finalizeAuthenticator({
		steamId,
		accessToken: session.accessToken,
		sharedSecret: enabled.shared_secret,
		activationCode: sms,
		viaSms: channel === 'sms',
	})
	for (let attempt = 0; attempt < 5 && last.want_more === true; attempt++) {
		last = await finalizeAuthenticator({
			steamId,
			accessToken: session.accessToken,
			sharedSecret: enabled.shared_secret,
			activationCode: sms,
			viaSms: channel === 'sms',
		})
	}
	if (last.success !== true && last.status !== 1) {
		throw new Error(
			`FinalizeAddAuthenticator failed: status=${String(last.status)}`,
		)
	}

	await saveSharedSecret({
		login,
		password,
		sharedSecret: enabled.shared_secret,
		identitySecret: enabled.identity_secret,
	})
	account = await getGcAccountByLogin(login)
	if (account == null) {
		throw new Error(`failed to reload steam_accounts row for ${login}`)
	}
	await persistMobileSession(account.id, session)
	console.error('authenticator finalized; wrote secrets and refresh token')
	console.log(generateAuthCode(enabled.shared_secret))
	const saved = await getGcAccountByLogin(login)
	if (saved == null) {
		throw new Error(`failed to reload steam_accounts row for ${login}`)
	}
	return saved
}

async function readActivationCode(input: {
	interactive: boolean
	mailbox: SteamMailbox | null
	after: Date
	usedMailUids: number[]
	steamId: string
	accessToken: string
}): Promise<string> {
	if (input.mailbox != null) {
		console.error(`waiting for activation email at ${input.mailbox.email}`)
		const found = await fetchSteamGuardFromMailbox({
			mailbox: input.mailbox,
			after: input.after,
			kind: 'authenticator',
			excludeUids: input.usedMailUids,
			timeoutMs: 120_000,
		})
		input.usedMailUids.push(found.uid)
		console.error(
			`activation uid=${String(found.uid)} template=${found.template ?? '-'}`,
		)
		return found.code
	}
	if (!input.interactive) {
		throw new Error('no IMAP mailbox to read the authenticator activation code')
	}
	let sms = ''
	while (sms === '') {
		sms = await question(
			'Activation code (email or SMS; empty resends email): ',
		)
		if (sms !== '') break
		try {
			await sendAuthenticatorEmail({
				steamId: input.steamId,
				accessToken: input.accessToken,
			})
			console.error('resent activation email')
		} catch (error) {
			console.error(`SendEmail failed: ${errorMessage(error)}`)
		}
	}
	return sms
}

async function totpCodeForAccount(account: GcAccount): Promise<string> {
	if (!accountHasUsableTotp(account) || account.sharedSecret === null) {
		return question('Steam Guard app code (empty if email-only / none): ')
	}
	try {
		const { offset } = await querySteamTimeOffset()
		return generateAuthCode(account.sharedSecret, offset)
	} catch {
		return generateAuthCode(account.sharedSecret)
	}
}

async function cmdAddPhone(values: {
	login?: string
	phone?: string
	country?: string
}): Promise<void> {
	const login = values.login ?? (await question('Steam login: '))
	const account = await getGcAccountByLogin(login)
	if (account === null) {
		throw new Error(`no steam_accounts row for login=${login}`)
	}
	const password =
		account.password !== '' ? account.password : await passwordForLogin(login)
	if (password === '') throw new Error('password is required')
	const phone = normalizePhoneNumber(
		values.phone ?? (await question('Phone (E.164, +…): ')),
	)
	let country = values.country?.trim().toUpperCase() ?? ''
	if (country === '') country = inferPhoneCountry(phone) ?? ''
	if (country !== '' && !/^[A-Z]{2}$/.test(country)) {
		throw new Error('--country must be a 2-letter ISO code, e.g. RU')
	}

	const appCode = await totpCodeForAccount(account)
	console.error(`add-phone ${login}: logging in as Steam mobile client…`)
	const session = await loginMobileSession(
		login,
		password,
		appCode,
		mailboxFor(account),
	)
	const { accessToken } = await persistMobileSession(account.id, session)

	const status = await accountPhoneStatus(accessToken)
	if (status.verified) {
		console.error(`add-phone: ${login} already has a verified phone`)
		return
	}

	let waiting = await isAccountWaitingForEmailConfirmation(accessToken)
	if (!waiting.awaiting) {
		if (country === '') {
			throw new Error(
				`could not infer country from ${maskPhone(phone)}; pass --country GE (ISO-3166 for the phone, not the Steam account region)`,
			)
		}
		console.error(
			`add-phone: SetAccountPhoneNumber ${maskPhone(phone)} country=${country}`,
		)
		const set = await setAccountPhoneNumber({ accessToken, phone, country })
		if (set.confirmationEmail != null) {
			console.error(
				`Steam emailed a confirmation link to ${set.confirmationEmail}`,
			)
		} else {
			console.error(
				'Steam emailed a confirmation link (EResult Pending). Check inbox + spam.',
			)
		}
		if (set.phoneFormatted != null) {
			console.error(`phone listed as ${set.phoneFormatted}`)
		}
		waiting = await isAccountWaitingForEmailConfirmation(accessToken)
	} else {
		console.error(
			'add-phone: Steam is already waiting for the phone confirmation email',
		)
	}
	for (let n = 0; n < 20 && waiting.awaiting; n++) {
		await question('Press Enter after you opened the confirmation link: ')
		waiting = await isAccountWaitingForEmailConfirmation(accessToken)
		if (waiting.awaiting) {
			console.error(
				`Steam still waiting for that click (~${String(waiting.secondsToWait)}s).`,
			)
		}
	}
	if (waiting.awaiting) {
		throw new Error(
			'Steam still waiting for the email confirmation. Open the link and rerun add-phone.',
		)
	}

	console.error('add-phone: sending SMS…')
	await sendPhoneVerificationCode(accessToken)
	await Bun.sleep(2_000)

	let verified = false
	for (let attempt = 0; attempt < 3 && !verified; attempt++) {
		const code = await question('SMS code: ')
		if (code === '') continue
		try {
			await verifyAccountPhoneWithCode({ accessToken, code })
			verified = true
		} catch (error) {
			console.error(`verify failed: ${errorMessage(error)}`)
		}
	}
	if (!verified) throw new Error('SMS verification failed')

	const done = await accountPhoneStatus(accessToken)
	if (!done.verified) {
		throw new Error('Steam did not mark the phone as verified')
	}
	console.error(`add-phone: verified ${maskPhone(phone)} on ${login}`)
}

async function cmdSave(values: {
	login?: string
	secret?: string
	identity?: string
}): Promise<void> {
	const login = values.login ?? (await question('Steam login: '))
	const secret = values.secret ?? (await question('shared_secret: '))
	assertSharedSecretShape(secret)
	await saveSharedSecret({
		login,
		sharedSecret: secret,
		identitySecret: values.identity,
	})
	console.log('saved', login)
}

async function cmdConfirm(values: {
	login?: string
	listOnly: boolean
}): Promise<void> {
	const login = values.login ?? (await question('Steam login: '))
	const { auth } = await communityGuardContext('confirm', login)
	console.error(`logged in ${auth.steamId}, fetching confirmations…`)
	const pending = await listConfirmations(auth)
	if (pending.length === 0) {
		console.error('no pending confirmations')
		return
	}
	for (const confirmation of pending) {
		console.error(`  ${describeConfirmation(confirmation)}`)
	}
	if (values.listOnly) {
		console.error(
			`${String(pending.length)} pending (not accepted; omit --list to allow)`,
		)
		return
	}
	const { accept, skipped } = confirmationsToAccept(pending)
	for (const confirmation of skipped) {
		console.error(
			`  skip older ${describeConfirmation(confirmation)} (keeping newest API key request)`,
		)
	}
	const results = await acceptConfirmations(auth, accept)
	let accepted = 0
	for (const result of results) {
		if (result.ok) {
			accepted += 1
			console.error(`  accepted ${describeConfirmation(result.confirmation)}`)
			continue
		}
		console.error(
			`  failed ${describeConfirmation(result.confirmation)}: ${result.error ?? 'unknown'}`,
		)
	}
	if (accepted === 0) {
		throw new Error('Steam rejected every confirmation')
	}
}

async function cmdIssueApiKey(values: {
	login?: string
	domain: string
}): Promise<void> {
	const login = values.login ?? (await question('Steam login: '))
	const issued = await withApiProxy(() =>
		withStatus(
			(line) => {
				console.error(line)
			},
			() => issueApiKeyForLogin({ login, domain: values.domain }),
		),
	)
	console.error(`saved Web API key for ${login}`)
	console.log(issued.apiKey)
}

async function runGcAccount(input: {
	login: string
	matchId: number | null
	label: string
}): Promise<{ replayUrl: string | null }> {
	const account = await getGcAccountByLogin(input.login)
	if (account === null) {
		throw new Error(`no steam_accounts row for login=${input.login}`)
	}
	const bound = await ensureAccountProxy({
		accountId: account.id,
		proxyId: account.proxyId,
	})
	console.error(
		`${input.label} ${input.login} via proxy id=${String(bound.id)} ${proxyHostPort(bound.url)}`,
	)
	return await withStatus(
		(line) => {
			console.error(line)
		},
		() =>
			loginGcAndMaybeTest({
				login: input.login,
				testOnMatchId: input.matchId,
			}),
	)
}

async function cmdGcLogin(flags: {
	login?: string
	testOnMatchId?: string
}): Promise<void> {
	const login = flags.login ?? (await question('Steam login: '))
	const testOnMatchId = asNumber(flags.testOnMatchId)
	const probed = await runGcAccount({
		login,
		matchId: testOnMatchId != null && testOnMatchId > 0 ? testOnMatchId : null,
		label: 'gc-login',
	})
	if (probed.replayUrl != null) {
		console.log(probed.replayUrl)
		return
	}
	console.error(`gc-login ${login}: Dota welcome ok`)
}

async function cmdScrapeMatch(flags: {
	login?: string
	matchId?: string
}): Promise<void> {
	const login = flags.login ?? (await question('Steam login: '))
	const matchId = asNumber(flags.matchId)
	if (matchId === null || matchId <= 0) {
		throw new Error('--match-id is required (positive integer)')
	}
	const probed = await runGcAccount({
		login,
		matchId,
		label: 'scrape-match',
	})
	if (probed.replayUrl == null) {
		throw new Error(
			`GC match ${String(matchId)} returned no replay URL for ${login}`,
		)
	}
	console.log(probed.replayUrl)
}

async function cmdBuyAccount(flags: {
	productId?: string
	type?: string
	store?: string
	count?: string
	testOnMatchId?: string
	imapHost?: string
}): Promise<number> {
	const input = parseBuyAccountCliInput(flags)
	console.error(
		`buy-account product=${String(input.productId)} type=${input.type} count=${String(input.count)} store=${input.store}`,
	)
	const result = await buyAccounts({
		...input,
		onStatus: (line) => {
			console.error(line)
		},
	})
	const orders = result.orders.map((order) => ({
		status: order.status,
		productId: order.productId,
		store: order.store,
		errorMessage: order.errorMessage,
		testResult: order.testResult,
	}))
	console.log(JSON.stringify({ orders }, null, 2))
	return orders.every((order) => order.status === 'success') ? 0 : 1
}

async function communityGuardContext(
	label: string,
	login: string,
	options?: { webCookies?: boolean },
): Promise<{
	account: GcAccount
	auth: ConfirmationAuth
}> {
	console.error(`${label} ${login}: loading steam_accounts…`)
	const account = await getGcAccountByLogin(login)
	if (account === null) {
		throw new Error(`no steam_accounts row for login=${login}`)
	}
	if (!accountHasUsableTotp(account) || account.sharedSecret === null) {
		throw new Error(
			`${login} has no usable shared_secret — run setup or save first`,
		)
	}
	if (account.identitySecret == null || account.identitySecret === '') {
		throw new Error(
			`${login} has no identity_secret — confirmations need the secret from setup`,
		)
	}

	console.error(`${label}: querying Steam clock…`)
	const offset = await confirmationTimeOffset()
	const session = await loginMobileForAccount(label, account)
	const { steamId, accessToken, refreshToken } = await persistMobileSession(
		account.id,
		session,
	)
	const cookies = mobileAccessCookies({ steamId, accessToken })
	let webCookies: string[] | undefined
	if (options?.webCookies === true) {
		console.error('steam: fetching community cookies via jwt/finalizelogin…')
		try {
			webCookies = await fetchWebCookies({ refreshToken, steamId })
			if (webCookies.length === 0) {
				throw new Error('getWebCookies returned no cookies')
			}
		} catch (error) {
			console.error(
				`steam: jwt/finalizelogin failed (${errorMessage(error)}); using mobile cookies for /dev/requestkey`,
			)
			webCookies = cookies
		}
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

async function loginMobileForAccount(
	label: string,
	account: GcAccount,
): Promise<LoginSession> {
	const token = account.refreshToken
	if (
		token != null &&
		refreshTokenUsable(token, account.refreshTokenExpiresAt) &&
		jwtHasAudience(token, 'mobile')
	) {
		try {
			console.error(`${label}: reusing saved mobile refresh token`)
			return await sessionFromRefreshToken(token)
		} catch (error) {
			console.error(
				`${label}: refresh token failed (${errorMessage(error)}), logging in`,
			)
		}
	}
	const password =
		account.password !== ''
			? account.password
			: await passwordForLogin(account.login)
	if (password === '') throw new Error('password is required')
	const appCode = await totpCodeForAccount(account)
	console.error(`${label}: logging in as Steam mobile client…`)
	return loginMobileSession(
		account.login,
		password,
		appCode,
		mailboxFor(account),
	)
}

async function main(argv: string[]): Promise<number> {
	const { values, positionals } = parseArgs({
		args: argv,
		options: {
			secret: { type: 'string' },
			login: { type: 'string' },
			identity: { type: 'string' },
			kind: { type: 'string' },
			list: { type: 'boolean', default: false },
			domain: { type: 'string' },
			phone: { type: 'string' },
			country: { type: 'string' },
			'product-id': { type: 'string' },
			type: { type: 'string' },
			store: { type: 'string' },
			count: { type: 'string' },
			'test-on-match-id': { type: 'string' },
			'match-id': { type: 'string' },
			'imap-host': { type: 'string' },
		},
		allowPositionals: true,
	})
	const command = positionals[0]
	if (command === undefined || command === 'help' || command === '--help') {
		console.log(USAGE)
		return command === undefined ? 1 : 0
	}
	if (command === 'code') {
		await cmdCode({ login: values.login, secret: values.secret })
		return 0
	}
	if (command === 'get-last-code') {
		await cmdGetLastCode({ login: values.login, kind: values.kind })
		return 0
	}
	if (command === 'add') {
		await cmdAdd(values.login)
		return 0
	}
	if (command === 'setup') {
		await withApiProxy(() => cmdSetup(values.login))
		return 0
	}
	if (command === 'add-phone') {
		await withApiProxy(() =>
			cmdAddPhone({
				login: values.login,
				phone: values.phone,
				country: values.country,
			}),
		)
		return 0
	}
	if (command === 'confirm') {
		await withApiProxy(() =>
			cmdConfirm({
				login: values.login,
				listOnly: values.list === true,
			}),
		)
		return 0
	}
	if (command === 'issue-api-key') {
		await withApiProxy(() =>
			cmdIssueApiKey({
				login: values.login,
				domain: values.domain ?? 'localhost',
			}),
		)
		return 0
	}
	if (command === 'gc-login') {
		await cmdGcLogin({
			login: values.login,
			testOnMatchId: values['test-on-match-id'],
		})
		return 0
	}
	if (command === 'scrape-match') {
		await cmdScrapeMatch({
			login: values.login,
			matchId: values['match-id'] ?? values['test-on-match-id'],
		})
		return 0
	}
	if (command === 'save') {
		await cmdSave({
			login: values.login,
			secret: values.secret,
			identity: values.identity,
		})
		return 0
	}
	if (command === 'buy-account') {
		return await cmdBuyAccount({
			productId: values['product-id'],
			type: values.type,
			store: values.store,
			count: values.count,
			testOnMatchId: values['test-on-match-id'],
			imapHost: values['imap-host'],
		})
	}
	console.error(`unknown command ${command}\n\n${USAGE}`)
	return 1
}

if (import.meta.main) {
	try {
		process.exit(await main(Bun.argv.slice(2)))
	} catch (error) {
		console.error(errorMessage(error))
		process.exit(1)
	}
}
