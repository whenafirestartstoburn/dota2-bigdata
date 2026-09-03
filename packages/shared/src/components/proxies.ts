import { MissingProxyError } from '#src/steam/http'
import { errorMessage } from '#src/store/coerce'
import { db, sql, sqlIn } from '#src/utils/db'
import { logger } from '#src/utils/logger'

export type ProxyKind = 'http' | 'socks5'
export type ProxyPurpose = 'api' | 'gc' | 'both'
export type ProxyNeed = 'api' | 'gc'

export type BoundProxy = {
	id: number
	url: string
	kind: ProxyKind
	purpose: ProxyPurpose
}

export class NoUsableProxyError extends Error {
	constructor(
		message = 'no usable proxy — Steam API/GC calls cannot run without one',
	) {
		super(message)
		this.name = 'NoUsableProxyError'
	}
}

export function isNoUsableProxy(error: unknown): boolean {
	return error instanceof NoUsableProxyError
}

export function proxyUrlWithScheme(raw: string, kind: ProxyKind): string {
	const trimmed = raw.trim()
	if (trimmed === '') throw new Error('proxy url is empty')
	const rest = trimmed.replace(/^(socks5h?|socks4a?|https?):\/\//i, '')
	return `${kind === 'socks5' ? 'socks5' : 'http'}://${rest}`
}

export function proxyHostPort(url: string): string {
	try {
		const parsed = new URL(url.includes('://') ? url : `http://${url}`)
		const port = parsed.port === '' ? '' : `:${parsed.port}`
		return `${parsed.hostname}${port}`
	} catch {
		return url.replace(/^[^@]+@/, '')
	}
}

export function isProxyTransportError(error: unknown): boolean {
	if (error instanceof NoUsableProxyError) return false
	if (error instanceof MissingProxyError) return false
	const message = errorMessage(error)
	if (message === '') return false
	if (/timeout waiting for Dota GC/i.test(message)) return false
	if (/no usable proxy|Steam HTTP calls require a proxy/i.test(message)) {
		return false
	}
	if (/HTTP 429|HTTP 403|HTTP 5\d\d/i.test(message)) return false
	return (
		/proxy/i.test(message) ||
		/socks/i.test(message) ||
		/\b407\b/.test(message) ||
		/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ECONNRESET|EPIPE/i.test(
			message,
		) ||
		/tunnel|CONNECT|socket hang up/i.test(message) ||
		/Unable to connect/i.test(message) ||
		/Could not resolve proxy/i.test(message)
	)
}

function asKind(value: unknown): ProxyKind | null {
	return value === 'socks5' || value === 'http' ? value : null
}

function asPurpose(value: unknown): ProxyPurpose | null {
	return value === 'api' || value === 'gc' || value === 'both' ? value : null
}

function mapProxy(row: Record<string, unknown>): BoundProxy {
	const kind = asKind(row.kind)
	const purpose = asPurpose(row.purpose)
	if (kind === null || purpose === null) {
		throw new Error(`proxy row ${String(row.id)} has invalid kind/purpose`)
	}
	return {
		id: Number(row.id),
		url: String(row.url),
		kind,
		purpose,
	}
}

function purposeList(need: ProxyNeed): ProxyPurpose[] {
	return need === 'api' ? ['api', 'both'] : ['gc', 'both']
}

function isLiveStatus(row: Record<string, unknown>): boolean {
	if (row.status !== 'ready' && row.status !== 'active') return false
	if (row.rate_limited_until == null) return true
	const until = row.rate_limited_until
	const date = until instanceof Date ? until : new Date(String(until))
	return !Number.isNaN(date.getTime()) && date.getTime() < Date.now()
}

export async function upsertProxy(input: {
	name: string
	url: string
	kind: ProxyKind
	purpose: ProxyPurpose
	status?: 'ready' | 'disabled'
	lastError?: string | null
}): Promise<BoundProxy> {
	const url = proxyUrlWithScheme(input.url, input.kind)
	const status = input.status ?? 'ready'
	const lastError = input.lastError ?? null
	const [row] = await db.execute(sql`
		INSERT INTO proxies (name, url, kind, purpose, status, last_error)
		VALUES (
			${input.name},
			${url},
			${input.kind}::proxy_kind,
			${input.purpose}::proxy_purpose,
			${status}::resource_status,
			${lastError}
		)
		ON CONFLICT (url) DO UPDATE SET
			name = excluded.name,
			kind = excluded.kind,
			purpose = excluded.purpose,
			status = excluded.status,
			last_error = excluded.last_error,
			rate_limited_until = CASE
				WHEN excluded.status = 'ready' THEN NULL
				ELSE proxies.rate_limited_until
			END,
			updated_at = now()
		RETURNING id, url, kind, purpose
	`)
	if (row === undefined) {
		throw new Error(`failed to upsert proxy ${input.name}`)
	}
	return mapProxy(row as Record<string, unknown>)
}

export async function markProxyUnavailable(
	proxyId: number,
	error: string,
): Promise<void> {
	logger.warn({ proxyId, err: error }, 'marking proxy unavailable')
	await db.execute(sql`
		UPDATE proxies
		SET
			status = 'disabled'::resource_status,
			last_error = ${error},
			updated_at = now()
		WHERE id = ${proxyId}
	`)
}

export async function markProxyActive(proxyId: number): Promise<void> {
	await db.execute(sql`
		UPDATE proxies
		SET status = 'active'::resource_status, last_error = NULL, updated_at = now()
		WHERE id = ${proxyId}
			AND status IN ('ready', 'active')
	`)
}

export async function isProxyUsable(
	proxyId: number | null,
	need: ProxyNeed,
): Promise<boolean> {
	if (proxyId == null) return false
	const purposes = purposeList(need)
	const [row] = await db.execute(sql`
		SELECT status, rate_limited_until, purpose
		FROM proxies
		WHERE id = ${proxyId}
			AND purpose IN ${sqlIn(purposes)}
	`)
	return row !== undefined && isLiveStatus(row as Record<string, unknown>)
}

export async function pickReadyProxy(
	need: ProxyNeed,
	opts?: { excludeIds?: number[]; preferKind?: ProxyKind },
): Promise<BoundProxy> {
	const purposes = purposeList(need)
	const excludeIds =
		opts?.excludeIds != null && opts.excludeIds.length > 0
			? opts.excludeIds
			: [0]
	const preferKind = opts?.preferKind
	const preferSocks =
		preferKind === 'socks5' || (preferKind == null && need === 'gc')
	const preferHttp =
		preferKind === 'http' || (preferKind == null && need === 'api')
	const rows = await db.execute(sql`
		SELECT p.id, p.url, p.kind, p.purpose
		FROM proxies p
		WHERE p.status IN ('ready', 'active')
			AND (p.rate_limited_until IS NULL OR p.rate_limited_until < now())
			AND p.purpose IN ${sqlIn(purposes)}
			AND p.id NOT IN ${sqlIn(excludeIds)}
		ORDER BY
			CASE
				WHEN ${preferSocks} AND p.kind = 'socks5' THEN 0
				WHEN ${preferHttp} AND p.kind = 'http' THEN 0
				ELSE 1
			END,
			(
				SELECT count(*)::int FROM steam_accounts a WHERE a.proxy_id = p.id
			) + (
				SELECT count(*)::int FROM steam_api_keys k WHERE k.proxy_id = p.id
			),
			p.id
		LIMIT 1
	`)
	const row = rows[0]
	if (row === undefined) {
		throw new NoUsableProxyError(
			`no usable ${need} proxy — Steam API/GC calls cannot run without one`,
		)
	}
	return mapProxy(row as Record<string, unknown>)
}

export async function bindAccountProxy(
	accountId: number,
	proxyId: number,
): Promise<void> {
	await db.execute(sql`
		UPDATE steam_accounts
		SET proxy_id = ${proxyId}, updated_at = now()
		WHERE id = ${accountId}
	`)
}

export async function bindApiKeyProxy(
	keyId: number,
	proxyId: number,
): Promise<void> {
	await db.execute(sql`
		UPDATE steam_api_keys
		SET proxy_id = ${proxyId}, updated_at = now()
		WHERE id = ${keyId}
	`)
}

export async function ensureAccountProxy(input: {
	accountId: number
	proxyId: number | null
}): Promise<BoundProxy> {
	if (await isProxyUsable(input.proxyId, 'gc')) {
		const [row] = await db.execute(sql`
			SELECT id, url, kind, purpose FROM proxies WHERE id = ${input.proxyId}
		`)
		if (row !== undefined) return mapProxy(row as Record<string, unknown>)
	}
	const next = await pickReadyProxy('gc', {
		excludeIds: input.proxyId == null ? [] : [input.proxyId],
	})
	await bindAccountProxy(input.accountId, next.id)
	await markProxyActive(next.id)
	logger.info(
		{ accountId: input.accountId, proxyId: next.id, kind: next.kind },
		'bound sticky GC proxy',
	)
	return next
}

export async function ensureApiKeyProxy(keyId: number): Promise<BoundProxy> {
	const [current] = await db.execute(sql`
		SELECT k.proxy_id, p.id, p.url, p.kind, p.purpose, p.status, p.rate_limited_until
		FROM steam_api_keys k
		LEFT JOIN proxies p ON p.id = k.proxy_id
		WHERE k.id = ${keyId}
	`)
	if (
		current !== undefined &&
		current.id != null &&
		(current.purpose === 'api' || current.purpose === 'both') &&
		isLiveStatus(current as Record<string, unknown>)
	) {
		return mapProxy(current as Record<string, unknown>)
	}
	const next = await pickReadyProxy('api', {
		excludeIds: current?.proxy_id == null ? [] : [Number(current.proxy_id)],
	})
	await bindApiKeyProxy(keyId, next.id)
	await markProxyActive(next.id)
	logger.info(
		{ keyId, proxyId: next.id, kind: next.kind },
		'bound sticky API proxy',
	)
	return next
}

export async function rotateDeadApiKeyProxy(
	keyId: number,
	deadProxyId: number,
	error: string,
): Promise<BoundProxy> {
	await markProxyUnavailable(deadProxyId, error)
	return await ensureApiKeyProxy(keyId)
}

export async function rotateAccountProxy(input: {
	accountId: number
	deadProxyId: number
	error: string
	preferKind?: ProxyKind
}): Promise<BoundProxy> {
	await markProxyUnavailable(input.deadProxyId, input.error)
	const next = await pickReadyProxy('gc', {
		excludeIds: [input.deadProxyId],
		preferKind: input.preferKind,
	})
	await bindAccountProxy(input.accountId, next.id)
	await markProxyActive(next.id)
	logger.info(
		{
			accountId: input.accountId,
			fromProxyId: input.deadProxyId,
			proxyId: next.id,
			kind: next.kind,
		},
		'rotated sticky GC proxy',
	)
	return next
}

export async function listProxies(): Promise<
	Array<BoundProxy & { name: string; status: string; lastError: string | null }>
> {
	const rows = await db.execute(sql`
		SELECT id, name, url, kind, purpose, status, last_error
		FROM proxies
		ORDER BY id
	`)
	return rows.map((row) => ({
		...mapProxy(row as Record<string, unknown>),
		name: String(row.name),
		status: String(row.status),
		lastError: row.last_error == null ? null : String(row.last_error),
	}))
}
