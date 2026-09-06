import { afterAll, describe, expect, test } from 'bun:test'
import { upsertProxy } from '#src/components/proxies'
import { recordResourceAttempt } from '#src/components/resource-health'
import { db, sql } from '#src/utils/db'

const PREFIX = `test-health-${Date.now()}`

afterAll(async () => {
	await db.execute(sql`
		DELETE FROM resource_attempts
		WHERE kind = 'proxy'
			AND resource_id IN (
				SELECT id FROM proxies WHERE name LIKE ${`${PREFIX}%`}
			)
	`)
	await db.execute(sql`DELETE FROM proxies WHERE name LIKE ${`${PREFIX}%`}`)
})

describe('recordResourceAttempt', () => {
	test('disables a proxy once the error window is full at threshold', async () => {
		const proxy = await upsertProxy({
			name: `${PREFIX}-window`,
			url: `http://test:${PREFIX}@127.0.0.1:19101`,
			kind: 'http',
			purpose: 'both',
		})
		for (let i = 0; i < 19; i++) {
			const disabled = await recordResourceAttempt({
				kind: 'proxy',
				resourceId: proxy.id,
				ok: false,
				error: `fail ${String(i)}`,
			})
			expect(disabled).toBe(false)
		}
		const [before] = await db.execute(sql`
			SELECT status FROM proxies WHERE id = ${proxy.id}
		`)
		expect(before?.status).toBe('ready')
		const disabled = await recordResourceAttempt({
			kind: 'proxy',
			resourceId: proxy.id,
			ok: false,
			error: 'fail 19',
		})
		expect(disabled).toBe(true)
		const [after] = await db.execute(sql`
			SELECT status, retest_count FROM proxies WHERE id = ${proxy.id}
		`)
		expect(after?.status).toBe('disabled')
		expect(Number(after?.retest_count)).toBe(0)
	})
})
