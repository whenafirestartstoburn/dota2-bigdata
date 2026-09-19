import { afterAll, describe, expect, test } from 'bun:test'
import { asNumber, asText } from '#src/store/coerce'
import {
	beginRequest,
	bytesToKb,
	finishRequest,
	requestLogStatusFromError,
	resetRequestLogSettingsCache,
	runMaintainRequestLogs,
	truncateErrorResponse,
} from '#src/store/request-logs'
import { db, sql } from '#src/utils/db'

const METHOD = `test_log_${crypto.randomUUID()}`

function utcDayName(offsetDays: number): {
	name: string
	from: string
	to: string
} {
	const now = new Date()
	const start = Date.UTC(
		now.getUTCFullYear(),
		now.getUTCMonth(),
		now.getUTCDate() + offsetDays,
	)
	const from = new Date(start).toISOString().slice(0, 10)
	const to = new Date(start + 86_400_000).toISOString().slice(0, 10)
	return {
		name: `steam_api_requests_${from.replaceAll('-', '_')}`,
		from: `${from} 00:00:00+00`,
		to: `${to} 00:00:00+00`,
	}
}

function assertPartitionName(name: string): string {
	if (!/^steam_api_requests_\d{4}_\d{2}_\d{2}$/.test(name)) {
		throw new Error(`unexpected partition name ${name}`)
	}
	return name
}

function assertDayBound(value: string): string {
	if (!/^\d{4}-\d{2}-\d{2} 00:00:00\+00$/.test(value)) {
		throw new Error(`unexpected day bound ${value}`)
	}
	return value
}

async function partitionExists(name: string): Promise<boolean> {
	const rows = await db.execute(sql`
		SELECT 1 AS ok
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'public' AND c.relname = ${name}
	`)
	return rows.length === 1
}

async function cleanup(): Promise<void> {
	await db.execute(
		sql`DELETE FROM steam_api_requests WHERE method_name = ${METHOD}`,
	)
	await db.execute(
		sql`DELETE FROM steam_gc_requests WHERE method_name = ${METHOD}`,
	)
	resetRequestLogSettingsCache()
}

afterAll(cleanup)

describe('truncateErrorResponse', () => {
	test('keeps short text and cuts at 1000', () => {
		expect(truncateErrorResponse(null)).toBeNull()
		expect(truncateErrorResponse('')).toBeNull()
		expect(truncateErrorResponse('boom')).toBe('boom')
		const long = 'x'.repeat(1001)
		expect(truncateErrorResponse(long)?.length).toBe(1000)
	})
})

describe('requestLogStatusFromError', () => {
	test('uses HTTP status, timeout, or error', () => {
		expect(requestLogStatusFromError({ status: 429 })).toBe('429')
		expect(
			requestLogStatusFromError(new Error('The operation timed out')),
		).toBe('timeout')
		expect(requestLogStatusFromError(new Error('ECONNRESET'))).toBe('error')
	})
})

describe('bytesToKb', () => {
	test('divides by 1024', () => {
		expect(bytesToKb(2048)).toBe(2)
	})
})

describe('steam_api_requests', () => {
	test('inserts before the call and fills response fields after', async () => {
		resetRequestLogSettingsCache()
		const row = await beginRequest('steam_api_requests', {
			matchId: 8_800_000_001,
			methodName: METHOD,
			steamApiKeyId: 29,
			steamAccountId: 65,
		})
		expect(row).not.toBeNull()
		const pending = await db.execute(sql`
			SELECT response_status, response_time, error_response
			FROM steam_api_requests
			WHERE id = ${row?.id}
		`)
		expect(pending[0]?.response_status ?? null).toBeNull()
		await finishRequest(row, {
			responseTimeMs: 12.5,
			responseStatus: '429',
			responseSizeKb: 0.25,
			errorResponse: 'rate limited',
		})
		const [done] = await db.execute(sql`
			SELECT match_id, method_name, response_status, response_time,
				response_size_kb, error_response, response_body,
				steam_api_key_id, steam_account_id
			FROM steam_api_requests
			WHERE id = ${row?.id}
		`)
		expect(asNumber(done?.match_id)).toBe(8_800_000_001)
		expect(asText(done?.method_name)).toBe(METHOD)
		expect(asText(done?.response_status)).toBe('429')
		expect(asNumber(done?.response_time)).toBe(12.5)
		expect(asNumber(done?.response_size_kb)).toBe(0.25)
		expect(asText(done?.error_response)).toBe('rate limited')
		expect(done?.response_body ?? null).toBeNull()
		expect(asNumber(done?.steam_api_key_id)).toBe(29)
		expect(asNumber(done?.steam_account_id)).toBe(65)
	})

	test('stores a jsonb response body on success', async () => {
		resetRequestLogSettingsCache()
		const row = await beginRequest('steam_api_requests', {
			methodName: METHOD,
			steamApiKeyId: 29,
			steamAccountId: 65,
		})
		await finishRequest(row, {
			responseTimeMs: 8,
			responseStatus: '200',
			responseSizeKb: 1,
			responseBody: { result: { games: [] } },
		})
		const [done] = await db.execute(sql`
			SELECT response_body
			FROM steam_api_requests
			WHERE id = ${row?.id}
		`)
		const body =
			typeof done?.response_body === 'string'
				? JSON.parse(done.response_body)
				: done?.response_body
		expect(body).toEqual({ result: { games: [] } })
	})

	test('maintain_request_logs keeps today and drops a 4-day-old partition', async () => {
		const today = utcDayName(0)
		const stale = utcDayName(-4)
		const next = utcDayName(-3)
		await db.execute(
			sql.raw(
				`CREATE TABLE IF NOT EXISTS ${assertPartitionName(stale.name)}
				PARTITION OF steam_api_requests
				FOR VALUES FROM ('${assertDayBound(stale.from)}') TO ('${assertDayBound(stale.to)}')`,
			),
		)
		await runMaintainRequestLogs()
		const kept = await partitionExists(today.name)
		const dropped = await partitionExists(stale.name)
		expect(kept).toBe(true)
		expect(dropped).toBe(false)
		expect(stale.name).not.toBe(next.name)
	})
})

describe('steam_gc_requests', () => {
	test('stores the GC account and leaves the API key null', async () => {
		resetRequestLogSettingsCache()
		const row = await beginRequest('steam_gc_requests', {
			matchId: 8_800_000_002,
			methodName: METHOD,
			steamAccountId: 65,
		})
		expect(row).not.toBeNull()
		const [done] = await db.execute(sql`
			SELECT steam_api_key_id, steam_account_id
			FROM steam_gc_requests
			WHERE id = ${row?.id}
		`)
		expect(done?.steam_api_key_id ?? null).toBeNull()
		expect(asNumber(done?.steam_account_id)).toBe(65)
	})
})
