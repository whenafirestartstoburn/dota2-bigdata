import { steamFetch, unwrapSteamResponse } from '#src/steam/http'
import {
	generateAuthCode,
	getDeviceId,
	querySteamTimeOffset,
	unixTime,
} from '#src/steam/totp'

const TWO_FACTOR = 'https://api.steampowered.com/ITwoFactorService'

/** Steam EResult names we actually see from AddAuthenticator. */
export const ERESULT: Record<number, string> = {
	1: 'OK',
	2: 'Fail',
	5: 'InvalidPassword',
	8: 'AccessDenied',
	29: 'DuplicateRequest',
	84: 'RateLimitExceeded',
	89: 'TwoFactorActivationCodeMismatch',
	92: 'NoMobileDevice',
}

export function eresultLabel(status: number): string {
	return ERESULT[status] ?? `unknown(${String(status)})`
}

export type AddAuthenticatorResponse = {
	status: number
	shared_secret?: string
	identity_secret?: string
	revocation_code?: string
	phone_number_hint?: string
	account_name?: string
	server_time?: string | number
	/** 1 = SMS, 3 = email (steamguard-cli AccountLinkConfirmType). */
	confirm_type?: number
}

function asSecret(value: unknown): string | undefined {
	if (typeof value === 'string' && value !== '') return value
	if (Buffer.isBuffer(value)) return value.toString('base64')
	return undefined
}

async function postTwoFactor(
	method: string,
	accessToken: string,
	fields: Record<string, string>,
): Promise<Record<string, unknown>> {
	const url = `${TWO_FACTOR}/${method}/v1/?access_token=${encodeURIComponent(accessToken)}`
	const response = await steamFetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(fields),
		signal: AbortSignal.timeout(30_000),
	})
	const json: unknown = await response.json()
	if (!response.ok) {
		throw new Error(
			`${method} HTTP ${String(response.status)}: ${JSON.stringify(json)}`,
		)
	}
	return unwrapSteamResponse(json)
}

export async function addAuthenticator(input: {
	steamId: string
	accessToken: string
}): Promise<AddAuthenticatorResponse> {
	const raw = await postTwoFactor('AddAuthenticator', input.accessToken, {
		steamid: input.steamId,
		authenticator_time: String(unixTime()),
		authenticator_type: '1',
		device_identifier: getDeviceId(input.steamId),
		sms_phone_id: '1',
		version: '2',
	})
	return {
		status: Number(raw.status ?? 0),
		shared_secret: asSecret(raw.shared_secret),
		identity_secret: asSecret(raw.identity_secret),
		revocation_code:
			typeof raw.revocation_code === 'string' ? raw.revocation_code : undefined,
		phone_number_hint:
			typeof raw.phone_number_hint === 'string'
				? raw.phone_number_hint
				: undefined,
		account_name:
			typeof raw.account_name === 'string' ? raw.account_name : undefined,
		server_time:
			typeof raw.server_time === 'string' || typeof raw.server_time === 'number'
				? raw.server_time
				: undefined,
		confirm_type:
			typeof raw.confirm_type === 'number'
				? raw.confirm_type
				: typeof raw.confirm_type === 'string'
					? Number(raw.confirm_type)
					: undefined,
	}
}

export function confirmChannel(
	response: AddAuthenticatorResponse,
): 'sms' | 'email' | 'unknown' {
	if (response.confirm_type === 1) return 'sms'
	if (response.confirm_type === 3) return 'email'
	return 'unknown'
}

export async function sendAuthenticatorEmail(input: {
	steamId: string
	accessToken: string
}): Promise<void> {
	await postTwoFactor('SendEmail', input.accessToken, {
		steamid: input.steamId,
		email_type: '2',
		include_activation_code: '1',
	})
}

export function describeAddAuthenticatorFailure(
	response: AddAuthenticatorResponse,
): string {
	const name = eresultLabel(response.status)
	const lines = [
		`AddAuthenticator failed: EResult.${name} (${String(response.status)}).`,
	]
	if (response.status === 2) {
		lines.push(
			'Fail is a generic Valve reject — not “already has Guard”.',
			'Usual cause: no phone number on the account. Run',
			'`bun run steam:guard add-phone --login … --phone +…` then setup again.',
			'The official Steam Mobile app can still enroll when this API cannot.',
		)
	}
	if (response.status === 29) {
		lines.push(
			'DuplicateRequest: an authenticator is already on this account.',
			'Export shared_secret from SDA / .maFile and run save.',
		)
	}
	if (response.status === 92) {
		lines.push('NoMobileDevice: Steam wants a phone / device on the account.')
	}
	if (response.phone_number_hint !== undefined) {
		lines.push(`phone_number_hint=${response.phone_number_hint}`)
	}
	return lines.join('\n')
}

export async function finalizeAuthenticator(input: {
	steamId: string
	accessToken: string
	sharedSecret: string
	activationCode: string
	viaSms: boolean
}): Promise<{ status: number; success?: boolean; want_more?: boolean }> {
	let offset = 0
	try {
		offset = (await querySteamTimeOffset()).offset
	} catch {
		offset = 0
	}
	const raw = await postTwoFactor(
		'FinalizeAddAuthenticator',
		input.accessToken,
		{
			steamid: input.steamId,
			authenticator_code: generateAuthCode(input.sharedSecret, offset),
			authenticator_time: String(unixTime(offset)),
			activation_code: input.activationCode,
			validate_sms_code: input.viaSms ? '1' : '0',
		},
	)
	return {
		status: Number(raw.status ?? 0),
		success: raw.success === true,
		want_more: raw.want_more === true,
	}
}
