import { STEAM_CHROME_UA, STEAM_MOBILE_UA, steamFetch } from '#src/steam/http'
import { parseSteamJson } from '#src/steam/json'
import {
	generateConfirmationKey,
	getDeviceId,
	querySteamTimeOffset,
	unixTime,
} from '#src/steam/totp'
import { asNumber, asText, errorMessage } from '#src/store/coerce'

export { parseSteamJson }

const CONF_BASE = 'https://steamcommunity.com/mobileconf'
const REQUEST_KEY_URL = 'https://steamcommunity.com/dev/requestkey'
const MOBILE_CLIENT_VERSION = '777777 3.10.9'
const REQUEST_KEY_POLL_MS = 6_000
const ERESULT_OK = 1
const ERESULT_PENDING = 22
const ERESULT_NAMES: Record<number, string> = {
	1: 'OK',
	2: 'Fail',
	8: 'InvalidParam',
	15: 'AccessDenied',
	21: 'NotLoggedOn',
	22: 'Pending',
}

export type SteamConfirmation = {
	id: string
	nonce: string
	type: number | null
	typeName: string | null
	headline: string | null
	creatorId: string | null
	creationTime: number | null
}

export type ConfirmationAuth = {
	steamId: string
	identitySecret: string
	/** Mobile session cookies for /mobileconf (steamLoginSecure = steamid||access). */
	cookies: string[]
	/** Browser cookies from jwt/finalizelogin for POST /dev/requestkey. */
	webCookies?: string[]
	timeOffsetSec?: number
}

export class SteamConfirmationError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'SteamConfirmationError'
	}
}

export function toCookieHeader(cookies: string[]): string {
	return [...communityCookiePairs(cookies).entries()]
		.map(([name, value]) => `${name}=${value}`)
		.join('; ')
}

export function cookieValue(cookies: string[], name: string): string | null {
	return communityCookiePairs(cookies).get(name) ?? null
}

/** Cookies the iOS Steam app sends on /mobileconf, plus steamLoginSecure. */
export function mobileAccessCookies(input: {
	steamId: string
	accessToken: string
	sessionId?: string
}): string[] {
	const sessionId =
		input.sessionId ??
		Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString('hex')
	const login = encodeURIComponent(`${input.steamId}||${input.accessToken}`)
	return [
		`steamLoginSecure=${login}`,
		`sessionid=${sessionId}`,
		'Steam_Language=english',
		'mobileClient=ios',
		`mobileClientVersion=${MOBILE_CLIENT_VERSION}`,
		'timezoneOffset=10800,0',
	]
}

export function describeEResult(eresult: number): string {
	const name = ERESULT_NAMES[eresult]
	return name === undefined
		? `EResult ${String(eresult)}`
		: `${name} (${String(eresult)})`
}

export function confirmationParams(input: {
	steamId: string
	identitySecret: string
	time: number
	tag: string
	extra?: Record<string, string>
}): URLSearchParams {
	const params = new URLSearchParams({
		p: getDeviceId(input.steamId),
		a: input.steamId,
		k: generateConfirmationKey(input.identitySecret, input.time, input.tag),
		t: String(input.time),
		m: 'react',
		tag: input.tag,
		...input.extra,
	})
	return params
}

export function describeConfirmation(confirmation: SteamConfirmation): string {
	const title = [confirmation.typeName, confirmation.headline]
		.filter((part) => part != null && part !== '')
		.join(' — ')
	return title === '' ? `#${confirmation.id}` : `#${confirmation.id} ${title}`
}

export function parseConfirmationList(body: unknown): SteamConfirmation[] {
	if (typeof body !== 'object' || body === null) {
		throw new SteamConfirmationError(
			`confirmation list is not JSON: ${String(body).slice(0, 200)}`,
		)
	}
	const root = body as Record<string, unknown>
	if (root.needauth === true) {
		throw new SteamConfirmationError(
			'Not Logged In — community cookies were rejected',
		)
	}
	if (root.success === false) {
		const detail =
			typeof root.message === 'string'
				? root.message
				: typeof root.detail === 'string'
					? root.detail
					: 'Failed to get confirmation list'
		throw new SteamConfirmationError(detail)
	}
	const rows = root.conf
	if (!Array.isArray(rows)) return []
	return rows.map((row, index) => {
		if (typeof row !== 'object' || row === null) {
			throw new SteamConfirmationError(
				`confirmation[${String(index)}] is not an object`,
			)
		}
		const item = row as Record<string, unknown>
		const id = asRequiredId(item.id, index, 'id')
		const nonce = asRequiredId(item.nonce ?? item.key, index, 'nonce')
		return {
			id,
			nonce,
			type: asNumber(item.type),
			typeName: asText(item.type_name),
			headline: asText(item.headline),
			creatorId: asText(item.creator_id ?? item.creator),
			creationTime: asNumber(item.creation_time),
		}
	})
}

export async function listConfirmations(
	auth: ConfirmationAuth,
): Promise<SteamConfirmation[]> {
	const time = unixTime(auth.timeOffsetSec ?? 0)
	const params = confirmationParams({
		steamId: auth.steamId,
		identitySecret: auth.identitySecret,
		time,
		tag: 'list',
	})
	const body = await mobileconf('getlist', auth.cookies, params, 'GET')
	return parseConfirmationList(body)
}

export function isConfirmationSuccess(body: unknown): boolean {
	if (typeof body !== 'object' || body === null) return false
	const success = (body as Record<string, unknown>).success
	return (
		success === true || success === 1 || success === 'true' || success === '1'
	)
}

export function isApiKeyConfirmation(confirmation: SteamConfirmation): boolean {
	return confirmation.type === 9 || confirmation.typeName === 'Register API Key'
}

export function confirmationForRequestId(
	pending: SteamConfirmation[],
	requestId: string,
): SteamConfirmation | null {
	const apiKeys = pending.filter(isApiKeyConfirmation)
	const matched = apiKeys.find((item) => item.creatorId === requestId)
	if (matched !== undefined) return matched
	if (apiKeys.length === 1) return apiKeys[0] ?? null
	return null
}

export type RequestKeyResponse = {
	eresult: number
	apiKey: string | null
	requestId: string | null
	requiresConfirmation: boolean
}

export function parseRequestKeyResponse(body: unknown): RequestKeyResponse {
	if (typeof body !== 'object' || body === null) {
		throw new SteamConfirmationError('requestkey is not JSON')
	}
	const root = body as Record<string, unknown>
	const eresult = asNumber(root.success)
	if (eresult == null) {
		throw new SteamConfirmationError(
			`requestkey missing success: ${JSON.stringify(body).slice(0, 200)}`,
		)
	}
	return {
		eresult,
		apiKey: parseApiKeyValue(root.api_key),
		requestId: asUint64String(root.request_id),
		requiresConfirmation:
			root.requires_confirmation === 1 ||
			root.requires_confirmation === true ||
			root.requires_confirmation === '1',
	}
}

export function requestKeyForm(input: {
	domain: string
	requestId: string
	sessionId: string
}): URLSearchParams {
	if (input.domain === '') {
		throw new SteamConfirmationError(
			'domain is required to register an API key',
		)
	}
	return new URLSearchParams({
		domain: input.domain,
		request_id: input.requestId,
		sessionid: input.sessionId,
		agreeToTerms: 'true',
	})
}

export async function postRequestKey(input: {
	cookies: string[]
	domain: string
	requestId: string
}): Promise<RequestKeyResponse> {
	const sessionId = cookieValue(input.cookies, 'sessionid')
	if (sessionId == null || sessionId === '') {
		throw new SteamConfirmationError(
			'no sessionid cookie — cannot POST /dev/requestkey',
		)
	}
	const header = toCookieHeader(input.cookies)
	if (!header.includes('steamLoginSecure=')) {
		throw new SteamConfirmationError(
			'no steamcommunity steamLoginSecure cookie — login did not yield a community session',
		)
	}
	const response = await steamFetch(REQUEST_KEY_URL, {
		method: 'POST',
		headers: {
			cookie: header,
			...requestKeyHeaders(),
			'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
		},
		body: requestKeyForm({
			domain: input.domain,
			requestId: input.requestId,
			sessionId,
		}),
		signal: AbortSignal.timeout(30_000),
	})
	const text = await response.text()
	if (response.status === 429) {
		throw new SteamConfirmationError(
			'requestkey HTTP 429 — Steam rate-limited this account. Wait a few minutes and retry.',
		)
	}
	if (!response.ok) {
		throw new SteamConfirmationError(
			`requestkey HTTP ${String(response.status)}: ${text.slice(0, 200)}`,
		)
	}
	let body: unknown
	try {
		body = parseSteamJson(text)
	} catch {
		if (text.includes('g_steamID = false') || text.includes('login')) {
			throw new SteamConfirmationError(
				'Not Logged In — community cookies were rejected',
			)
		}
		throw new SteamConfirmationError(
			`requestkey returned non-JSON: ${text.slice(0, 200)}`,
		)
	}
	return parseRequestKeyResponse(body)
}

export type IssueWebApiKeyResult = {
	apiKey: string
	requestId: string | null
}

export async function issueWebApiKey(input: {
	auth: ConfirmationAuth
	domain: string
	onStatus?: (line: string) => void
}): Promise<IssueWebApiKeyResult> {
	const { auth, domain, onStatus } = input
	const webCookies = auth.webCookies ?? auth.cookies
	onStatus?.('POST /dev/requestkey (request_id=0)')
	const started = await postRequestKey({
		cookies: webCookies,
		domain,
		requestId: '0',
	})
	if (started.eresult === ERESULT_OK && started.apiKey != null) {
		onStatus?.('Steam returned a Web API key without confirmation')
		return { apiKey: started.apiKey, requestId: started.requestId }
	}
	if (started.eresult !== ERESULT_PENDING) {
		throw new SteamConfirmationError(
			`requestkey start ${describeEResult(started.eresult)}`,
		)
	}
	const requestId = started.requestId
	if (requestId == null || requestId === '' || requestId === '0') {
		throw new SteamConfirmationError('requestkey pending without a request_id')
	}
	onStatus?.(
		`pending ${describeEResult(started.eresult)} request_id=${requestId}`,
	)
	const confirmation = await waitForApiKeyConfirmation(auth, requestId)
	onStatus?.(`accepting ${describeConfirmation(confirmation)}`)
	const time = unixTime(auth.timeOffsetSec ?? 0)
	await acceptConfirmation(auth, confirmation, time)
	onStatus?.(`accepted ${describeConfirmation(confirmation)}`)
	await Bun.sleep(3_000)
	const finalized = await pollRequestKey({
		cookies: webCookies,
		domain,
		requestId,
	})
	if (finalized.eresult === ERESULT_OK && finalized.apiKey != null) {
		return { apiKey: finalized.apiKey, requestId }
	}
	throw new SteamConfirmationError(
		`requestkey finalize ${describeEResult(finalized.eresult)} (no api_key)`,
	)
}

export function confirmationsToAccept(pending: SteamConfirmation[]): {
	accept: SteamConfirmation[]
	skipped: SteamConfirmation[]
} {
	const apiKeys = pending.filter(isApiKeyConfirmation)
	if (apiKeys.length <= 1) return { accept: pending, skipped: [] }
	const newest = apiKeys.reduce((best, current) =>
		newerConfirmation(current, best) ? current : best,
	)
	const skipped = apiKeys.filter((item) => item.id !== newest.id)
	const skipIds = new Set(skipped.map((item) => item.id))
	return {
		accept: pending.filter((item) => !skipIds.has(item.id)),
		skipped,
	}
}

export function parseApiKeyFromHtml(html: string): string | null {
	const match = html.match(/Key:\s*([0-9A-F]{32})/i)
	return match?.[1] ?? null
}

export async function acceptConfirmation(
	auth: ConfirmationAuth,
	confirmation: SteamConfirmation,
	time: number,
): Promise<void> {
	const params = confirmationParams({
		steamId: auth.steamId,
		identitySecret: auth.identitySecret,
		time,
		tag: 'accept',
		extra: {
			op: 'allow',
			cid: confirmation.id,
			ck: confirmation.nonce,
		},
	})
	const body = await postAjaxOp(auth.cookies, params)
	if (isConfirmationSuccess(body)) return
	const root =
		typeof body === 'object' && body !== null
			? (body as Record<string, unknown>)
			: null
	const message =
		typeof root?.message === 'string'
			? root.message
			: typeof root?.detail === 'string'
				? root.detail
				: JSON.stringify(body)
	throw new SteamConfirmationError(
		`Could not allow ${describeConfirmation(confirmation)}: ${message}`,
	)
}

export type AcceptConfirmationResult = {
	confirmation: SteamConfirmation
	ok: boolean
	error?: string
}

export async function acceptConfirmations(
	auth: ConfirmationAuth,
	confirmations: SteamConfirmation[],
): Promise<AcceptConfirmationResult[]> {
	const results: AcceptConfirmationResult[] = []
	let lastTime = 0
	for (const [index, confirmation] of confirmations.entries()) {
		if (index > 0) await Bun.sleep(1_100)
		let time = unixTime(auth.timeOffsetSec ?? 0)
		if (time <= lastTime) time = lastTime + 1
		lastTime = time
		try {
			await acceptConfirmation(auth, confirmation, time)
			results.push({ confirmation, ok: true })
		} catch (error) {
			results.push({
				confirmation,
				ok: false,
				error: errorMessage(error),
			})
		}
	}
	return results
}

export async function confirmationTimeOffset(): Promise<number> {
	try {
		return (await querySteamTimeOffset()).offset
	} catch {
		return 0
	}
}

async function waitForApiKeyConfirmation(
	auth: ConfirmationAuth,
	requestId: string,
): Promise<SteamConfirmation> {
	let last: SteamConfirmation[] = []
	for (let attempt = 0; attempt < 12; attempt++) {
		if (attempt > 0) await Bun.sleep(1_500)
		last = await listConfirmations(auth)
		const found = confirmationForRequestId(last, requestId)
		if (found != null) return found
	}
	const listed = last.map(describeConfirmation).join(', ')
	throw new SteamConfirmationError(
		`no Register API Key confirmation for request_id=${requestId}` +
			(listed === '' ? '' : ` (pending: ${listed})`),
	)
}

async function pollRequestKey(input: {
	cookies: string[]
	domain: string
	requestId: string
}): Promise<RequestKeyResponse> {
	let last = await postRequestKey(input)
	for (let attempt = 1; attempt < 8; attempt++) {
		if (last.eresult !== ERESULT_PENDING) break
		await Bun.sleep(REQUEST_KEY_POLL_MS)
		last = await postRequestKey(input)
	}
	return last
}

function communityCookiePairs(cookies: string[]): Map<string, string> {
	const pairs = new Map<string, string>()
	for (const cookie of cookies) {
		const pair = setCookiePair(cookie)
		if (pair === null) continue
		const domain = setCookieDomain(cookie)
		if (domain !== null && !isSteamCommunityDomain(domain)) continue
		pairs.set(pair.name, pair.value)
	}
	return pairs
}

function setCookiePair(cookie: string): { name: string; value: string } | null {
	const first = cookie.split(';')[0]?.trim()
	if (first === undefined) return null
	const eq = first.indexOf('=')
	if (eq <= 0) return null
	const name = first.slice(0, eq)
	if (name.toLowerCase() === 'path' || name.toLowerCase() === 'domain') {
		return null
	}
	return { name, value: first.slice(eq + 1) }
}

function setCookieDomain(cookie: string): string | null {
	const match = /(?:^|;\s*)domain=([^;]+)/i.exec(cookie)
	if (match === null) return null
	const domain = match[1]?.trim().toLowerCase()
	return domain === undefined || domain === '' ? null : domain
}

function isSteamCommunityDomain(domain: string): boolean {
	return (
		domain === 'steamcommunity.com' || domain.endsWith('.steamcommunity.com')
	)
}

function newerConfirmation(
	candidate: SteamConfirmation,
	current: SteamConfirmation,
): boolean {
	const candidateTime = candidate.creationTime
	const currentTime = current.creationTime
	if (candidateTime != null && currentTime != null) {
		return candidateTime > currentTime
	}
	try {
		return BigInt(candidate.id) > BigInt(current.id)
	} catch {
		return candidate.id > current.id
	}
}

function asRequiredId(value: unknown, index: number, field: string): string {
	if (typeof value === 'number' && Number.isFinite(value)) return String(value)
	if (typeof value === 'string' && value !== '') return value
	throw new SteamConfirmationError(
		`confirmation[${String(index)}] missing ${field}`,
	)
}

function asUint64String(value: unknown): string | null {
	if (typeof value === 'string' && value !== '') return value
	if (typeof value === 'number' && Number.isFinite(value)) return String(value)
	return null
}

function parseApiKeyValue(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const key = value.trim()
	return /^[0-9A-F]{32}$/i.test(key) ? key : null
}

function requestKeyHeaders(): Record<string, string> {
	return {
		accept: '*/*',
		'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
		origin: 'https://steamcommunity.com',
		referer: 'https://steamcommunity.com/dev/apikey',
		'user-agent': STEAM_CHROME_UA,
		'x-requested-with': 'XMLHttpRequest',
		'sec-fetch-dest': 'empty',
		'sec-fetch-mode': 'cors',
		'sec-fetch-site': 'same-origin',
		'sec-ch-ua':
			'"Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"',
		'sec-ch-ua-mobile': '?0',
		'sec-ch-ua-platform': '"macOS"',
	}
}

async function postAjaxOp(
	cookies: string[],
	params: URLSearchParams,
): Promise<unknown> {
	const header = requireLoginCookie(cookies)
	const url = new URL(`${CONF_BASE}/ajaxop`)
	url.search = params.toString()
	const response = await steamFetch(url, {
		method: 'POST',
		headers: {
			cookie: header,
			'user-agent': STEAM_MOBILE_UA,
			accept: 'application/json, text/plain, */*',
			'content-type': 'application/json',
		},
		body: '{"withCredentials":true}',
		signal: AbortSignal.timeout(30_000),
	})
	return readSteamJson(response, 'ajaxop')
}

async function mobileconf(
	path: string,
	cookies: string[],
	params: URLSearchParams,
	method: 'GET' | 'POST',
): Promise<unknown> {
	const header = requireLoginCookie(cookies)
	const url = new URL(`${CONF_BASE}/${path}`)
	const headers: Record<string, string> = {
		cookie: header,
		'user-agent': STEAM_MOBILE_UA,
		accept: 'application/json, text/plain, */*',
	}
	const init: RequestInit = {
		method,
		headers,
		signal: AbortSignal.timeout(30_000),
	}
	if (method === 'GET') {
		url.search = params.toString()
	} else {
		headers['content-type'] = 'application/x-www-form-urlencoded'
		init.body = params
	}
	const response = await steamFetch(url, init)
	return readSteamJson(response, path)
}

function requireLoginCookie(cookies: string[]): string {
	const header = toCookieHeader(cookies)
	if (header === '' || !header.includes('steamLoginSecure=')) {
		throw new SteamConfirmationError(
			'no steamcommunity steamLoginSecure cookie — login did not yield a community session',
		)
	}
	return header
}

async function readSteamJson(
	response: Response,
	path: string,
): Promise<unknown> {
	const text = await response.text()
	if (!response.ok) {
		throw new SteamConfirmationError(
			`${path} HTTP ${String(response.status)}: ${text.slice(0, 200)}`,
		)
	}
	try {
		return parseSteamJson(text)
	} catch {
		if (text.includes('g_steamID = false') || text.includes('login')) {
			throw new SteamConfirmationError(
				'Not Logged In — community cookies were rejected',
			)
		}
		throw new SteamConfirmationError(
			`${path} returned non-JSON: ${text.slice(0, 200)}`,
		)
	}
}
