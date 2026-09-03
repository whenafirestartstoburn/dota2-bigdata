import { asNumber, asRecord, asString } from '#src/store/coerce'
import env from '#src/utils/env'
import { status } from '#src/utils/status'
import {
	darkShoppingBaseUrl,
	darkShoppingConfigured,
	darkShoppingSlot,
} from './rate-limit'

export class DarkShoppingError extends Error {
	readonly status: number

	constructor(status: number, message: string) {
		super(message)
		this.name = 'DarkShoppingError'
		this.status = status
	}
}

export type DarkOrderCreateOk = {
	status: 'ok' | 'completed'
	id: number
	link: string | null
	idempotence: boolean
}

export type DarkOrderCreatePending = {
	status: 'pending'
	id: number
	idempotence: boolean
}

export type DarkOrderCreateResult = DarkOrderCreateOk | DarkOrderCreatePending

export function parseDarkEnvelope(body: unknown): {
	ok: boolean
	data: Record<string, unknown>
} {
	const root = asRecord(body)
	if (root === null) {
		throw new DarkShoppingError(500, 'dark.shopping: response is not an object')
	}
	const data = asRecord(root.data) ?? {}
	return { ok: root.success === true, data }
}

export function parseOrderCreate(body: unknown): DarkOrderCreateResult {
	const { ok, data } = parseDarkEnvelope(body)
	if (!ok) {
		const status = asNumber(data.status) ?? 400
		throw new DarkShoppingError(
			status,
			asString(data.message) ?? 'dark.shopping order/create failed',
		)
	}
	const id = asNumber(data.id)
	if (id === null) {
		throw new DarkShoppingError(500, 'dark.shopping order/create missing id')
	}
	const status = asString(data.status) ?? 'ok'
	const idempotence = data.idempotence === true
	if (status === 'pending') {
		return { status: 'pending', id, idempotence }
	}
	return {
		status: status === 'completed' ? 'completed' : 'ok',
		id,
		link: asString(data.link),
		idempotence,
	}
}

export function parseOrderStatus(body: unknown): string {
	const { ok, data } = parseDarkEnvelope(body)
	if (!ok) {
		const status = asNumber(data.status) ?? 400
		throw new DarkShoppingError(
			status,
			asString(data.message) ?? 'dark.shopping order/status failed',
		)
	}
	const status = asString(data.status)
	if (status === null) {
		throw new DarkShoppingError(
			500,
			'dark.shopping order/status missing status',
		)
	}
	return status
}

export function parseOrderDownload(body: unknown): string {
	const { ok, data } = parseDarkEnvelope(body)
	if (!ok) {
		const status = asNumber(data.status) ?? 400
		throw new DarkShoppingError(
			status,
			asString(data.message) ?? 'dark.shopping order/download failed',
		)
	}
	const link = asString(data.link)
	if (link === null) {
		throw new DarkShoppingError(
			404,
			'dark.shopping order/download missing link',
		)
	}
	return link
}

export function truncateForLog(text: string, max = 480): string {
	const flat = text.replace(/\s+/g, ' ').trim()
	if (flat.length <= max) return flat
	return `${flat.slice(0, max)}…`
}

export function redactSecret(text: string, secret: string): string {
	if (secret === '') return text
	return text.split(secret).join('<key>')
}

function formatPublicParams(params: Record<string, string>): string {
	return Object.entries(params)
		.map(([name, value]) => `${name}=${value}`)
		.join(' ')
}

function logDarkResponse(
	httpStatus: number,
	text: string,
	apiKey: string,
): void {
	status(
		`dark.shopping: HTTP ${String(httpStatus)} ${truncateForLog(redactSecret(text, apiKey))}`,
	)
}

async function darkFetch(
	method: 'GET' | 'POST',
	path: string,
	params: Record<string, string>,
): Promise<unknown> {
	if (!darkShoppingConfigured()) {
		throw new DarkShoppingError(503, 'DARK_SHOPPING_API_KEY is not set')
	}
	await darkShoppingSlot()
	const key = env.DARK_SHOPPING_API_KEY
	const url = new URL(`${darkShoppingBaseUrl()}/api/v1/${path}`)
	url.searchParams.set('_format', 'json')
	const headers: Record<string, string> = {
		accept: 'application/json',
	}
	let body: URLSearchParams | undefined
	if (method === 'GET') {
		url.searchParams.set('key', key)
		for (const [name, value] of Object.entries(params)) {
			url.searchParams.set(name, value)
		}
	} else {
		body = new URLSearchParams({ key, ...params })
		headers['content-type'] = 'application/x-www-form-urlencoded'
	}
	const publicParams = formatPublicParams(params)
	status(
		publicParams === ''
			? `dark.shopping: ${method} /api/v1/${path}`
			: `dark.shopping: ${method} /api/v1/${path} ${publicParams}`,
	)
	let lastError: DarkShoppingError | null = null
	for (let attempt = 0; attempt < 4; attempt++) {
		if (attempt > 0) {
			status(`dark.shopping: retry ${String(attempt)} after HTTP 429`)
			await darkShoppingSlot()
		}
		const response = await fetch(url, {
			method,
			headers,
			body,
			signal: AbortSignal.timeout(30_000),
		})
		const text = await response.text()
		logDarkResponse(response.status, text, key)
		if (response.status === 429) {
			lastError = new DarkShoppingError(429, text.slice(0, 240))
			await Bun.sleep(2_000 * (attempt + 1))
			continue
		}
		let json: unknown
		try {
			json = JSON.parse(text) as unknown
		} catch {
			throw new DarkShoppingError(
				response.status,
				`dark.shopping non-JSON: ${text.slice(0, 200)}`,
			)
		}
		if (!response.ok) {
			const parsed = parseDarkEnvelope(json)
			throw new DarkShoppingError(
				response.status,
				asString(parsed.data.message) ?? text.slice(0, 200),
			)
		}
		return json
	}
	throw lastError ?? new DarkShoppingError(429, 'dark.shopping rate limited')
}

export async function createDarkOrder(input: {
	productId: number
	quantity: number
	idempotenceId: string
}): Promise<DarkOrderCreateResult> {
	const json = await darkFetch('POST', 'order/create', {
		product: String(input.productId),
		quantity: String(input.quantity),
		idempotence_id: input.idempotenceId,
	})
	return parseOrderCreate(json)
}

export async function getDarkOrderStatus(orderId: number): Promise<string> {
	const json = await darkFetch('GET', 'order/status', { id: String(orderId) })
	return parseOrderStatus(json)
}

export async function getDarkOrderDownloadLink(
	orderId: number,
): Promise<string> {
	const json = await darkFetch('GET', 'order/download', { id: String(orderId) })
	return parseOrderDownload(json)
}

export async function fetchDarkDeliveryText(link: string): Promise<string> {
	await darkShoppingSlot()
	status(`dark.shopping: GET delivery ${truncateForLog(link, 160)}`)
	const response = await fetch(link, { signal: AbortSignal.timeout(30_000) })
	const text = await response.text()
	status(
		`dark.shopping: delivery HTTP ${String(response.status)} ${String(text.length)} chars`,
	)
	if (!response.ok) {
		throw new DarkShoppingError(
			response.status,
			`download ${link}: ${text.slice(0, 160)}`,
		)
	}
	return text
}

export async function waitDarkOrderReady(input: {
	orderId: number
	timeoutMs?: number
	initialLink?: string | null
}): Promise<{ link: string; status: string }> {
	const timeoutMs = input.timeoutMs ?? 120_000
	const deadline = Date.now() + timeoutMs
	if (input.initialLink != null && input.initialLink !== '') {
		status(
			`dark.shopping: order ${String(input.orderId)} already has a download link`,
		)
		return { link: input.initialLink, status: 'completed' }
	}
	status(`dark.shopping: polling order ${String(input.orderId)} status`)
	let lastStatus = 'pending'
	while (Date.now() < deadline) {
		lastStatus = await getDarkOrderStatus(input.orderId)
		status(`dark.shopping: order ${String(input.orderId)} status=${lastStatus}`)
		if (
			lastStatus === 'completed' ||
			lastStatus === 'ok' ||
			lastStatus === 'error' ||
			lastStatus === 'canceled' ||
			lastStatus === 'refund'
		) {
			break
		}
		await Bun.sleep(2_000)
	}
	if (
		lastStatus === 'error' ||
		lastStatus === 'canceled' ||
		lastStatus === 'refund'
	) {
		throw new DarkShoppingError(
			400,
			`dark.shopping order ${String(input.orderId)} ended ${lastStatus}`,
		)
	}
	if (lastStatus !== 'completed' && lastStatus !== 'ok') {
		throw new DarkShoppingError(
			408,
			`dark.shopping order ${String(input.orderId)} still ${lastStatus} after ${String(timeoutMs)}ms`,
		)
	}
	const link = await getDarkOrderDownloadLink(input.orderId)
	return { link, status: lastStatus }
}
