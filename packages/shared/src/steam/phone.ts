import { steamFetch, unwrapSteamResponse } from '#src/steam/http'

const PHONE = 'https://api.steampowered.com/IPhoneService'
const USER = 'https://api.steampowered.com/IUserAccountService'

const ERESULT: Record<number, string> = {
	1: 'OK',
	2: 'Fail',
	8: 'AccessDenied',
	15: 'AccessDenied',
	21: 'NotLoggedOn',
	22: 'Pending',
	84: 'RateLimitExceeded',
}

const ERESULT_OK = 1
const ERESULT_PENDING = 22

/** Longest-prefix ISO country guesses from E.164. Steam still prefers --country. */
const COUNTRY_PREFIXES: [string, string][] = [
	['+380', 'UA'],
	['+375', 'BY'],
	['+373', 'MD'],
	['+995', 'GE'],
	['+994', 'AZ'],
	['+993', 'TM'],
	['+992', 'TJ'],
	['+998', 'UZ'],
	['+996', 'KG'],
	['+972', 'IL'],
	['+971', 'AE'],
	['+44', 'GB'],
	['+49', 'DE'],
	['+33', 'FR'],
	['+48', 'PL'],
	['+90', 'TR'],
	['+86', 'CN'],
	['+81', 'JP'],
	['+82', 'KR'],
	['+61', 'AU'],
	['+55', 'BR'],
	['+7', 'RU'],
	['+1', 'US'],
]

export class SteamPhoneError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'SteamPhoneError'
	}
}

export type AccountPhoneStatus = {
	verified: boolean
}

export type SetPhoneResult = {
	confirmationEmail: string | null
	phoneFormatted: string | null
}

export type EmailConfirmationWait = {
	awaiting: boolean
	secondsToWait: number
}

export function normalizePhoneNumber(raw: string): string {
	const trimmed = raw.trim()
	const compact = trimmed.replace(/[\s().-]/g, '')
	if (!/^\+[1-9]\d{7,14}$/.test(compact)) {
		throw new SteamPhoneError(
			'phone must be E.164 with a leading +, e.g. +14155550123',
		)
	}
	return compact
}

export function inferPhoneCountry(e164: string): string | null {
	const matches = COUNTRY_PREFIXES.filter(([prefix]) => e164.startsWith(prefix))
	const best = matches.sort((a, b) => b[0].length - a[0].length)[0]
	return best?.[1] ?? null
}

export function maskPhone(e164: string): string {
	if (e164.length < 8) return '+***'
	return `${e164.slice(0, 3)}***${e164.slice(-4)}`
}

export function parseAccountPhoneStatus(body: unknown): AccountPhoneStatus {
	const inner = unwrapSteamResponse(body)
	return { verified: inner.verified_phone === true }
}

export function parseSetPhoneResponse(body: unknown): SetPhoneResult {
	const inner = unwrapSteamResponse(body)
	return {
		confirmationEmail: asOptionalString(inner.confirmation_email_address),
		phoneFormatted: asOptionalString(inner.phone_number_formatted),
	}
}

export function parseEmailConfirmationWait(
	body: unknown,
): EmailConfirmationWait {
	const inner = unwrapSteamResponse(body)
	const seconds = Number(inner.seconds_to_wait)
	return {
		awaiting: inner.awaiting_email_confirmation === true,
		secondsToWait: Number.isFinite(seconds) && seconds > 0 ? seconds : 5,
	}
}

export async function accountPhoneStatus(
	accessToken: string,
): Promise<AccountPhoneStatus> {
	const body = await postPhone('AccountPhoneStatus', accessToken, {})
	return parseAccountPhoneStatus(body)
}

export async function getUserCountry(
	accessToken: string,
	steamId: string,
): Promise<string | null> {
	const wrapped = await postNamed(USER, 'GetUserCountry', accessToken, {
		steamid: steamId,
	})
	const inner = unwrapSteamResponse(wrapped)
	const country = asOptionalString(inner.country)
	return country === null ? null : country.toUpperCase()
}

export async function setAccountPhoneNumber(input: {
	accessToken: string
	phone: string
	country: string
}): Promise<SetPhoneResult> {
	const body = await postPhone(
		'SetAccountPhoneNumber',
		input.accessToken,
		{
			phone_number: input.phone,
			phone_country_code: input.country,
		},
		{ allowPending: true },
	)
	return parseSetPhoneResponse(body)
}

export async function isAccountWaitingForEmailConfirmation(
	accessToken: string,
): Promise<EmailConfirmationWait> {
	const body = await postPhone(
		'IsAccountWaitingForEmailConfirmation',
		accessToken,
		{},
	)
	return parseEmailConfirmationWait(body)
}

export async function sendPhoneVerificationCode(
	accessToken: string,
): Promise<void> {
	await postPhone('SendPhoneVerificationCode', accessToken, { language: '0' })
}

export async function verifyAccountPhoneWithCode(input: {
	accessToken: string
	code: string
}): Promise<void> {
	await postPhone('VerifyAccountPhoneWithCode', input.accessToken, {
		code: input.code,
	})
}

async function postPhone(
	method: string,
	accessToken: string,
	fields: Record<string, string>,
	opts?: { allowPending?: boolean },
): Promise<unknown> {
	return postNamed(PHONE, method, accessToken, fields, opts)
}

async function postNamed(
	base: string,
	method: string,
	accessToken: string,
	fields: Record<string, string>,
	opts?: { allowPending?: boolean },
): Promise<unknown> {
	const url = `${base}/${method}/v1/?access_token=${encodeURIComponent(accessToken)}`
	const response = await steamFetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(fields),
		signal: AbortSignal.timeout(30_000),
	})
	const text = await response.text()
	const eresultHeader = response.headers.get('x-eresult')
	const eresult =
		eresultHeader != null && eresultHeader !== '' ? Number(eresultHeader) : null
	if (!response.ok) {
		throw new SteamPhoneError(
			`${method} HTTP ${String(response.status)}: ${text.slice(0, 200)}`,
		)
	}
	const pendingOk = opts?.allowPending === true && eresult === ERESULT_PENDING
	if (eresult != null && eresult !== ERESULT_OK && !pendingOk) {
		const name = ERESULT[eresult] ?? `EResult ${String(eresult)}`
		throw new SteamPhoneError(`${method} ${name} (${String(eresult)})`)
	}
	if (text === '') return {}
	try {
		return JSON.parse(text) as unknown
	} catch {
		throw new SteamPhoneError(
			`${method} returned non-JSON: ${text.slice(0, 200)}`,
		)
	}
}

function asOptionalString(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const text = value.trim()
	return text === '' ? null : text
}
