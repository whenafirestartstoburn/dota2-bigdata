import { STEAM_CHROME_UA, steamFetch } from '@app/shared/src/steam/http'
import { asError } from '@app/shared/src/store/coerce'
import type { ApiRequest, ApiResponse, ITransport } from 'steam-session'

const WEBAPI_BASE = 'https://api.steampowered.com'
const FINALIZE_URL = 'https://login.steampowered.com/jwt/finalizelogin'
const GET_REQUESTS = new Set([
	'IAuthenticationService/GetPasswordRSAPublicKey/v1',
])
const REQUEST_TIMEOUT_MS = 15_000

export class FetchWebApiTransport implements ITransport {
	constructor(
		private readonly proxyUrl?: string,
		private readonly userAgent = STEAM_CHROME_UA,
	) {}

	async sendRequest(request: ApiRequest): Promise<ApiResponse> {
		const urlPath = `I${request.apiInterface}Service/${request.apiMethod}/v${String(request.apiVersion)}`
		const url = new URL(`${WEBAPI_BASE}/${urlPath}/`)
		const method = GET_REQUESTS.has(urlPath) ? 'GET' : 'POST'
		const proto = protobufBase64(request.requestData)
		if (request.accessToken != null && request.accessToken !== '') {
			url.searchParams.set('access_token', request.accessToken)
		}
		if (method === 'GET' && proto != null) {
			url.searchParams.set('input_protobuf_encoded', proto)
		}
		const headers = new Headers({
			accept: 'application/json, text/plain, */*',
			...request.headers,
			'user-agent': this.userAgent,
		})
		let body: FormData | undefined
		if (method === 'POST' && proto != null) {
			body = new FormData()
			body.append('input_protobuf_encoded', proto)
		}
		const response = await steamFetch(url, {
			method,
			headers,
			body,
			proxy: this.proxyUrl,
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		})
		if (!response.ok) {
			throw new Error(`WebAPI HTTP ${String(response.status)}`)
		}
		const raw = Buffer.from(await response.arrayBuffer())
		const eresultHeader = response.headers.get('x-eresult')
		const errorMessage = response.headers.get('x-error_message')
		const apiResponse: ApiResponse = {}
		if (eresultHeader != null && eresultHeader !== '') {
			apiResponse.result = Number(eresultHeader) as ApiResponse['result']
		}
		if (errorMessage != null && errorMessage !== '') {
			apiResponse.errorMessage = errorMessage
		}
		if (raw.length > 0) apiResponse.responseData = raw
		return apiResponse
	}

	close(): void {}
}

export async function fetchWebCookies(input: {
	refreshToken: string
	steamId: string
	proxyUrl?: string
}): Promise<string[]> {
	if (input.refreshToken === '') {
		throw new Error('A refresh token is required to get web cookies')
	}
	const sessionId = Buffer.from(
		crypto.getRandomValues(new Uint8Array(12)),
	).toString('hex')
	const finalizeBody = new FormData()
	finalizeBody.append('nonce', input.refreshToken)
	finalizeBody.append('sessionid', sessionId)
	finalizeBody.append('redir', 'https://steamcommunity.com/login/home/?goto=')
	const finalize = await steamFetch(FINALIZE_URL, {
		method: 'POST',
		headers: {
			origin: 'https://steamcommunity.com',
			referer: 'https://steamcommunity.com/',
			accept: 'application/json, text/plain, */*',
			'user-agent': STEAM_CHROME_UA,
			'sec-fetch-site': 'cross-site',
			'sec-fetch-mode': 'cors',
			'sec-fetch-dest': 'empty',
		},
		body: finalizeBody,
		proxy: input.proxyUrl,
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	})
	const finalizeJson = (await finalize.json()) as {
		error?: number
		transfer_info?: { url: string; params: Record<string, string> }[]
	}
	if (finalizeJson.error != null) {
		throw new Error(`finalizelogin EResult ${String(finalizeJson.error)}`)
	}
	const transfers = finalizeJson.transfer_info
	if (transfers == null || transfers.length === 0) {
		throw new Error('Malformed login response')
	}
	const cookies: string[] = setCookieLines(finalize).map((cookie) =>
		ensureCookieDomain(cookie, new URL(finalize.url).host),
	)
	for (const transfer of transfers) {
		const transferCookies = await postTransfer(
			transfer,
			input.steamId,
			input.proxyUrl,
		)
		cookies.push(...transferCookies)
	}
	const withoutSession = cookies.filter(
		(cookie) => !cookie.startsWith('sessionid='),
	)
	const domains = [
		...new Set(
			withoutSession
				.map(cookieDomain)
				.filter((domain): domain is string => domain != null),
		),
	].filter((domain) => domain !== 'login.steampowered.com')
	for (const domain of domains) {
		withoutSession.push(
			`sessionid=${sessionId}; Path=/; Secure; SameSite=None; Domain=${domain}`,
		)
	}
	return withoutSession
}

export function webApiPath(
	apiInterface: string,
	apiMethod: string,
	apiVersion: number,
): string {
	return `I${apiInterface}Service/${apiMethod}/v${String(apiVersion)}`
}

function protobufBase64(requestData: unknown): string | null {
	if (requestData == null) return null
	if (!Buffer.isBuffer(requestData) && !(requestData instanceof Uint8Array)) {
		return null
	}
	if (requestData.length === 0) return null
	return Buffer.from(requestData).toString('base64')
}

async function postTransfer(
	transfer: { url: string; params: Record<string, string> },
	steamId: string,
	proxyUrl?: string,
): Promise<string[]> {
	let lastError: Error = new Error('transfer failed')
	for (let attempt = 0; attempt < 5; attempt++) {
		if (attempt > 0) await Bun.sleep(500)
		try {
			const body = new FormData()
			body.append('steamID', steamId)
			for (const [name, value] of Object.entries(transfer.params)) {
				body.append(name, value)
			}
			const response = await steamFetch(transfer.url, {
				method: 'POST',
				headers: {
					'user-agent': STEAM_CHROME_UA,
					origin: 'https://steamcommunity.com',
					referer: 'https://steamcommunity.com/',
				},
				body,
				proxy: proxyUrl,
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			})
			if (!response.ok) {
				throw new Error(`HTTP error ${String(response.status)}`)
			}
			const lines = setCookieLines(response).map((cookie) =>
				ensureCookieDomain(cookie, new URL(response.url).host),
			)
			if (lines.length === 0) throw new Error('No Set-Cookie header in result')
			if (!lines.some((cookie) => cookie.startsWith('steamLoginSecure='))) {
				throw new Error('No steamLoginSecure cookie in result')
			}
			return lines
		} catch (error) {
			lastError = asError(error)
		}
	}
	throw lastError
}

function setCookieLines(response: Response): string[] {
	const headers = response.headers as Headers & {
		getSetCookie?: () => string[]
	}
	if (typeof headers.getSetCookie === 'function') {
		return headers.getSetCookie()
	}
	const single = response.headers.get('set-cookie')
	return single == null || single === '' ? [] : [single]
}

function ensureCookieDomain(cookie: string, host: string): string {
	return cookieDomain(cookie) == null ? `${cookie}; Domain=${host}` : cookie
}

function cookieDomain(cookie: string): string | null {
	const match = /(?:^|;\s*)domain=([^;]+)/i.exec(cookie)
	const domain = match?.[1]?.trim()
	return domain === undefined || domain === '' ? null : domain
}
