import {
	isProxyTransportError,
	NoUsableProxyError,
	proxyHostPort,
	rotateDeadApiKeyProxy,
} from '#src/components/proxies'
import {
	type ApiCallPurpose,
	acquireSteamApiSlot,
	clearApiKeyRateLimit,
	markApiKeyRateLimited,
} from '#src/components/rate-limit'
import {
	disableResource,
	recordResourceAttempt,
} from '#src/components/resource-health'
import {
	classifyWebApiError,
	observeWebApi,
	type WebApiSource,
} from '#src/metrics/observe'
import { findSchemaDrift, STEAM_API_DRIFT } from '#src/steam/api/drift'
import { scheduleSchemaDriftNotify } from '#src/steam/api/notify'
import { MissingProxyError, steamFetch } from '#src/steam/http'
import { parseSteamJson } from '#src/steam/json'
import { errorMessage } from '#src/store/coerce'
import {
	beginRequest,
	bytesToKb,
	finishRequest,
	requestLogStatusFromError,
	truncateErrorResponse,
} from '#src/store/request-logs'

export class SteamApiError extends Error {
	readonly status?: number
	readonly url?: string

	constructor(opts: { message: string; status?: number; url?: string }) {
		super(opts.message)
		this.name = 'SteamApiError'
		this.status = opts.status
		this.url = opts.url
	}
}

export type SteamRequestContext = {
	apiKey: string
	keyId: number
	accountId: number
	proxyId: number
	proxyUrl: string
	purpose: ApiCallPurpose
	matchId?: number | null
	/** Seq walker windows are large; leave `response_body` null. */
	logResponseBody?: boolean
}

export const STEAM_API = 'https://api.steampowered.com'

export function withQuery(
	base: string,
	params: Record<string, string | number | undefined>,
): string {
	const url = new URL(base)
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined) url.searchParams.set(key, String(value))
	}
	return url.toString()
}

function toSteamApiError(error: unknown, url?: string): SteamApiError {
	if (error instanceof SteamApiError) return error
	return new SteamApiError({
		message: errorMessage(error),
		url,
	})
}

function reportSchemaDrift(method: string, body: unknown): void {
	const spec = STEAM_API_DRIFT[method]
	if (spec == null) return
	const drift = findSchemaDrift(body, spec)
	if (drift == null) return
	scheduleSchemaDriftNotify(method, drift)
}

async function getJsonOnce(
	url: string,
	ctx: SteamRequestContext,
	methodName: string,
): Promise<unknown> {
	await acquireSteamApiSlot(ctx.keyId, ctx.purpose)
	const started = performance.now()
	const logRow = await beginRequest('steam_api_requests', {
		matchId: ctx.matchId,
		methodName,
		steamApiKeyId: ctx.keyId,
		steamAccountId: ctx.accountId,
	})
	let response: Response
	try {
		response = await steamFetch(url, {
			proxy: ctx.proxyUrl,
			signal: AbortSignal.timeout(45_000),
		})
	} catch (error) {
		await finishRequest(logRow, {
			responseTimeMs: performance.now() - started,
			responseStatus: requestLogStatusFromError(error),
			errorResponse: truncateErrorResponse(errorMessage(error)),
		})
		throw error
	}
	let bodyText = ''
	try {
		bodyText = await response.text()
	} catch (error) {
		await finishRequest(logRow, {
			responseTimeMs: performance.now() - started,
			responseStatus: String(response.status),
			errorResponse: truncateErrorResponse(errorMessage(error)),
		})
		throw error
	}
	const sizeKb = bytesToKb(Buffer.byteLength(bodyText))
	const elapsed = performance.now() - started
	if (response.status === 407) {
		await finishRequest(logRow, {
			responseTimeMs: elapsed,
			responseStatus: '407',
			responseSizeKb: sizeKb,
			errorResponse: truncateErrorResponse(
				`proxy HTTP 407 for ${proxyHostPort(ctx.proxyUrl)}`,
			),
		})
		throw new Error(`proxy HTTP 407 for ${proxyHostPort(ctx.proxyUrl)}`)
	}
	if (response.status === 429) {
		await recordResourceAttempt({
			kind: 'proxy',
			resourceId: ctx.proxyId,
			ok: true,
		})
	}
	if (!response.ok) {
		await finishRequest(logRow, {
			responseTimeMs: elapsed,
			responseStatus: String(response.status),
			responseSizeKb: sizeKb,
			errorResponse: truncateErrorResponse(
				bodyText !== '' ? bodyText : `steam HTTP ${response.status}`,
			),
		})
		throw new SteamApiError({
			message: `steam HTTP ${response.status}`,
			status: response.status,
			url,
		})
	}
	try {
		const body = parseSteamJson(bodyText)
		await finishRequest(logRow, {
			responseTimeMs: elapsed,
			responseStatus: String(response.status),
			responseSizeKb: sizeKb,
			...(ctx.logResponseBody === false ? {} : { responseBody: body }),
		})
		await recordResourceAttempt({
			kind: 'proxy',
			resourceId: ctx.proxyId,
			ok: true,
		})
		await recordResourceAttempt({
			kind: 'api_key',
			resourceId: ctx.keyId,
			ok: true,
		})
		await clearApiKeyRateLimit(ctx.keyId)
		reportSchemaDrift(methodName, body)
		return body
	} catch (error) {
		await finishRequest(logRow, {
			responseTimeMs: elapsed,
			responseStatus: String(response.status),
			responseSizeKb: sizeKb,
			errorResponse: truncateErrorResponse(errorMessage(error)),
		})
		throw toSteamApiError(error, url)
	}
}

async function getJson(
	url: string,
	ctx: SteamRequestContext,
	methodName: string,
	attempts = 4,
): Promise<unknown> {
	let lastError: SteamApiError | undefined
	for (let attempt = 0; attempt < attempts; attempt++) {
		try {
			return await getJsonOnce(url, ctx, methodName)
		} catch (error) {
			if (error instanceof SteamApiError && error.status === 403) {
				await disableResource({
					kind: 'api_key',
					resourceId: ctx.keyId,
					error: error.message,
					giveUp: true,
				})
				throw error
			}
			if (
				error instanceof MissingProxyError ||
				error instanceof NoUsableProxyError
			) {
				throw toSteamApiError(error, url)
			}
			if (isProxyTransportError(error)) {
				const message = errorMessage(error)
				const next = await rotateDeadApiKeyProxy(
					ctx.keyId,
					ctx.proxyId,
					message,
				)
				ctx.proxyId = next.id
				ctx.proxyUrl = next.url
			} else if (!(error instanceof SteamApiError && error.status === 429)) {
				await recordResourceAttempt({
					kind: 'api_key',
					resourceId: ctx.keyId,
					ok: false,
					error: errorMessage(error),
				})
			}
			lastError = toSteamApiError(error, url)
			const retryableHttp =
				error instanceof SteamApiError &&
				(error.status === 429 || (error.status != null && error.status >= 500))
			await Bun.sleep((retryableHttp ? 1000 : 500) * 2 ** attempt)
		}
	}
	if (lastError?.status === 429) {
		await markApiKeyRateLimited(ctx.keyId, lastError.message)
	}
	throw lastError ?? new SteamApiError({ message: 'steam request failed', url })
}

export type SteamApiCall<T> = {
	source: WebApiSource
	method: string
	url: string
	parse: (body: unknown) => T
}

export async function callSteamApi<T>(
	ctx: SteamRequestContext,
	spec: SteamApiCall<T>,
): Promise<T> {
	const started = performance.now()
	try {
		const value = spec.parse(await getJson(spec.url, ctx, spec.method))
		observeWebApi(spec.source, spec.method, 'success', started)
		return value
	} catch (error) {
		if (error instanceof PublicMatchError) {
			observeWebApi(spec.source, spec.method, 'public_match', started)
			throw error
		}
		observeWebApi(spec.source, spec.method, classifyWebApiError(error), started)
		throw error
	}
}

export class PublicMatchError extends Error {
	readonly matchId: number | null

	constructor(matchId: number | null) {
		super(`server hosts public match ${matchId ?? 'unknown'}`)
		this.name = 'PublicMatchError'
		this.matchId = matchId
	}
}
