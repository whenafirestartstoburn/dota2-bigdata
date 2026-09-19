import { afterAll, describe, expect, test } from 'bun:test'
import { findSchemaDrift, STEAM_API_DRIFT } from '#src/steam/api/drift'
import {
	claimAlert,
	claimSchemaAlert,
	formatSchemaDriftMessage,
	notifySchemaDrift,
	postTelegramNotification,
	TELEGRAM_NOTIFY_TIMEOUT_MS,
} from '#src/steam/api/notify'
import { db, sql } from '#src/utils/db'

const METHOD = `test_drift_${crypto.randomUUID()}`
const NOTIFY_METHOD = `test_drift_notify_${crypto.randomUUID()}`
const COOLDOWN_KEY = `test_alert_cd_${crypto.randomUUID()}`

afterAll(async () => {
	try {
		await db.execute(sql`
			DELETE FROM steam_api_schema_alerts
			WHERE method_name IN (${METHOD}, ${NOTIFY_METHOD}, ${COOLDOWN_KEY})
		`)
	} catch {
		// table exists only after the response_body migration
	}
})

describe('formatSchemaDriftMessage', () => {
	test('lists unexpected and missing keys', () => {
		const text = formatSchemaDriftMessage('GetLiveLeagueGames', {
			extra: ['result.foo'],
			missing: ['result.games[0].match_id'],
		})
		expect(text).toContain('GetLiveLeagueGames')
		expect(text).toContain('result.foo')
		expect(text).toContain('result.games[0].match_id')
	})
})

describe('claimSchemaAlert', () => {
	test('allows the first notify and cools down the next', async () => {
		expect(await claimSchemaAlert(METHOD)).toBe(true)
		expect(await claimSchemaAlert(METHOD)).toBe(false)
		await db.execute(sql`
			UPDATE steam_api_schema_alerts
			SET last_notified_at = now() - interval '2 hours'
			WHERE method_name = ${METHOD}
		`)
		expect(await claimSchemaAlert(METHOD)).toBe(true)
	})

	test('claimAlert uses a custom cooldown window', async () => {
		expect(await claimAlert(COOLDOWN_KEY, 10 * 60 * 1000)).toBe(true)
		expect(await claimAlert(COOLDOWN_KEY, 10 * 60 * 1000)).toBe(false)
		await db.execute(sql`
			UPDATE steam_api_schema_alerts
			SET last_notified_at = now() - interval '11 minutes'
			WHERE method_name = ${COOLDOWN_KEY}
		`)
		expect(await claimAlert(COOLDOWN_KEY, 10 * 60 * 1000)).toBe(true)
	})
})

describe('postTelegramNotification', () => {
	test('posts /send with HTML and chatType', async () => {
		const calls: Array<{ url: string; init: RequestInit }> = []
		await postTelegramNotification('hello', {
			url: 'http://telegram-notifications:8090',
			chatType: 'dev_dataluna',
			fetchImpl: (async (input, init) => {
				calls.push({ url: String(input), init: init ?? {} })
				return new Response(JSON.stringify({ success: true }), { status: 200 })
			}) as typeof fetch,
		})
		expect(calls).toHaveLength(1)
		expect(calls[0]?.url).toBe('http://telegram-notifications:8090/send')
		expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
			chatType: 'dev_dataluna',
			text: 'hello',
			parseMode: 'HTML',
		})
	})

	test('skips the HTTP call when chat dest is empty', async () => {
		let called = 0
		await postTelegramNotification('hello', {
			url: 'http://telegram-notifications:8090',
			chatType: '',
			chatId: '',
			fetchImpl: (async () => {
				called += 1
				return new Response('no', { status: 500 })
			}) as typeof fetch,
		})
		expect(called).toBe(0)
	})

	test('skips the HTTP call when url is empty', async () => {
		let called = 0
		await postTelegramNotification('hello', {
			url: '',
			fetchImpl: (async () => {
				called += 1
				return new Response('no', { status: 500 })
			}) as typeof fetch,
		})
		expect(called).toBe(0)
	})

	test('aborts after the 2s timeout', async () => {
		const started = Date.now()
		await expect(
			postTelegramNotification('hello', {
				url: 'http://telegram-notifications:8090',
				timeoutMs: TELEGRAM_NOTIFY_TIMEOUT_MS,
				fetchImpl: (async (_input, init) => {
					const signal = init?.signal
					await new Promise<void>((_resolve, reject) => {
						if (signal?.aborted) {
							reject(signal.reason)
							return
						}
						signal?.addEventListener('abort', () => reject(signal.reason), {
							once: true,
						})
					})
					return new Response('late', { status: 200 })
				}) as typeof fetch,
			}),
		).rejects.toThrow()
		expect(Date.now() - started).toBeLessThan(4_000)
	})
})

describe('notifySchemaDrift', () => {
	test('logs and does not throw when telegram fails', async () => {
		const drift = findSchemaDrift(
			{ extra_flag: true, result: { games: [] } },
			STEAM_API_DRIFT.GetLiveLeagueGames ?? { required: [] },
		)
		expect(drift).not.toBeNull()
		await notifySchemaDrift(
			NOTIFY_METHOD,
			drift ?? { extra: [], missing: [] },
			{
				url: 'http://telegram-notifications:8090',
				chatType: 'dev_dataluna',
				fetchImpl: (async () => {
					throw new Error('boom')
				}) as typeof fetch,
			},
		)
	})
})
