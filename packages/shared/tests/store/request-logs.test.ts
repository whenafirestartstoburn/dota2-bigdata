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
				response_size_kb, error_response,
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
		expect(asNumber(done?.steam_api_key_id)).toBe(29)
		expect(asNumber(done?.steam_account_id)).toBe(65)
	})

	test('maintain_request_logs keeps today UTC partition', async () => {
		await runMaintainRequestLogs()
		const today = new Date().toISOString().slice(0, 10).replaceAll('-', '_')
		const name = `steam_api_requests_${today}`
		const rows = await db.execute(sql`
			SELECT 1 AS ok
			FROM pg_class c
			JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname = 'public' AND c.relname = ${name}
		`)
		expect(rows.length).toBe(1)
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
