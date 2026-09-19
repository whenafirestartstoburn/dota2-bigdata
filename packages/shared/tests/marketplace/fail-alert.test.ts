import { afterAll, describe, expect, test } from 'bun:test'
import {
	formatMarketplaceFailMessage,
	isStableMarketplaceError,
	MARKETPLACE_FAIL_RETRIES,
	marketplaceErrorSignature,
	marketplaceFailAlertKey,
	notifyMarketplaceFail,
} from '#src/marketplace/fail-alert'
import {
	finishMarketplaceOrder,
	insertMarketplaceOrder,
	listRecentFailedErrorMessages,
} from '#src/marketplace/orders'
import { db, sql, sqlIn } from '#src/utils/db'

const createdIds: number[] = []

afterAll(async () => {
	if (createdIds.length === 0) return
	await db.execute(sql`
		DELETE FROM marketplace_orders
		WHERE id IN ${sqlIn(createdIds)}
	`)
})

describe('marketplaceErrorSignature', () => {
	test('strips uuids and long numbers', () => {
		expect(
			marketplaceErrorSignature(
				'dark.shopping order 8262790 still in_process after 120000ms id 2c1a3d0e-8b4f-4e11-9c2a-7f6e5d4c3b2a',
			),
		).toBe('dark.shopping order <n> still in_process after <n>ms id <id>')
	})
})

describe('isStableMarketplaceError', () => {
	const same = marketplaceErrorSignature(
		'Outlook/Hotmail purchase already spent',
	)

	test('needs the first fail plus three retries', () => {
		expect(isStableMarketplaceError([same, same, same])).toBe(false)
		expect(isStableMarketplaceError([same, same, same, same])).toBe(true)
		expect(isStableMarketplaceError([same, same, same, same], 3)).toBe(true)
	})

	test('rejects a mixed or empty streak', () => {
		const other = marketplaceErrorSignature('IMAP mailer is unknown')
		expect(isStableMarketplaceError([same, same, same, other])).toBe(false)
		expect(isStableMarketplaceError(['', '', '', ''])).toBe(false)
	})
})

describe('formatMarketplaceFailMessage', () => {
	test('lists store kind product and error', () => {
		const text = formatMarketplaceFailMessage({
			store: 'dark_shopping',
			kind: 'api_key',
			productId: 80841,
			orderId: 12,
			errorMessage: 'Outlook/Hotmail <oops>',
		})
		expect(text).toContain('Marketplace order failed')
		expect(text).toContain('dark_shopping')
		expect(text).toContain('api_key')
		expect(text).toContain('80841')
		expect(text).toContain('12')
		expect(text).toContain('Outlook/Hotmail &lt;oops&gt;')
		expect(text).toContain(
			`stable after ${String(MARKETPLACE_FAIL_RETRIES)} retries`,
		)
	})
})

describe('marketplaceFailAlertKey', () => {
	test('scopes cooldown by store kind and signature', () => {
		expect(
			marketplaceFailAlertKey(
				'dark_shopping',
				'gc',
				'Outlook/Hotmail purchase already spent',
			),
		).toBe(
			'marketplace:dark_shopping:gc:Outlook/Hotmail purchase already spent',
		)
	})
})

describe('notifyMarketplaceFail', () => {
	test('does not notify before the streak is stable', async () => {
		let called = 0
		await notifyMarketplaceFail(
			{
				store: 'dark_shopping',
				kind: 'api_key',
				productId: 80841,
				orderId: 1,
				errorMessage: 'Outlook/Hotmail',
			},
			{
				url: 'http://telegram-notifications:8090',
				chatType: 'dev_dataluna',
				listRecentErrors: async () => ['Outlook/Hotmail', 'Outlook/Hotmail'],
				claim: async () => {
					called += 1
					return true
				},
				fetchImpl: (async () => {
					called += 1
					return new Response('ok', { status: 200 })
				}) as unknown as typeof fetch,
			},
		)
		expect(called).toBe(0)
	})

	test('posts once when the streak is stable', async () => {
		const calls: string[] = []
		await notifyMarketplaceFail(
			{
				store: 'dark_shopping',
				kind: 'api_key',
				productId: 80841,
				orderId: 9,
				errorMessage: 'Outlook/Hotmail',
			},
			{
				url: 'http://telegram-notifications:8090',
				chatType: 'dev_dataluna',
				listRecentErrors: async () => [
					'Outlook/Hotmail',
					'Outlook/Hotmail',
					'Outlook/Hotmail',
					'Outlook/Hotmail',
				],
				claim: async (key) => {
					calls.push(key)
					return true
				},
				fetchImpl: (async (_input, init) => {
					calls.push(String(init?.body))
					return new Response(JSON.stringify({ success: true }), {
						status: 200,
					})
				}) as unknown as typeof fetch,
			},
		)
		expect(calls[0]).toBe(
			marketplaceFailAlertKey(
				'dark_shopping',
				'api_key',
				marketplaceErrorSignature('Outlook/Hotmail'),
			),
		)
		expect(calls[1]).toContain('Outlook/Hotmail')
		expect(calls[1]).toContain('order: <code>9</code>')
	})

	test('skips HTTP when cooldown is held', async () => {
		let posted = 0
		await notifyMarketplaceFail(
			{
				store: 'dark_shopping',
				kind: 'gc',
				productId: 160811,
				orderId: 2,
				errorMessage: 'IMAP mailer is unknown',
			},
			{
				url: 'http://telegram-notifications:8090',
				chatType: 'dev_dataluna',
				listRecentErrors: async () => Array(4).fill('IMAP mailer is unknown'),
				claim: async () => false,
				fetchImpl: (async () => {
					posted += 1
					return new Response('ok', { status: 200 })
				}) as unknown as typeof fetch,
			},
		)
		expect(posted).toBe(0)
	})

	test('logs and does not throw when telegram fails', async () => {
		await notifyMarketplaceFail(
			{
				store: 'dark_shopping',
				kind: 'api_key',
				productId: 80841,
				orderId: 3,
				errorMessage: 'Outlook/Hotmail',
			},
			{
				url: 'http://telegram-notifications:8090',
				chatType: 'dev_dataluna',
				listRecentErrors: async () => Array(4).fill('Outlook/Hotmail'),
				claim: async () => true,
				fetchImpl: (async () => {
					throw new Error('boom')
				}) as unknown as typeof fetch,
			},
		)
	})
})

describe('listRecentFailedErrorMessages', () => {
	test('returns failed rows after the latest success in the window', async () => {
		const token = `test-mkt-fail-${crypto.randomUUID()}`
		const before = await insertMarketplaceOrder({
			store: 'dark_shopping',
			kind: 'gc',
			productId: 160811,
			testOnMatchId: null,
		})
		createdIds.push(before.id)
		await finishMarketplaceOrder({
			id: before.id,
			status: 'failed',
			errorMessage: `${token} before-success`,
		})
		const success = await insertMarketplaceOrder({
			store: 'dark_shopping',
			kind: 'gc',
			productId: 160811,
			testOnMatchId: null,
		})
		createdIds.push(success.id)
		await finishMarketplaceOrder({
			id: success.id,
			status: 'success',
		})
		for (let i = 0; i < 2; i++) {
			const order = await insertMarketplaceOrder({
				store: 'dark_shopping',
				kind: 'gc',
				productId: 160811,
				testOnMatchId: null,
			})
			createdIds.push(order.id)
			await finishMarketplaceOrder({
				id: order.id,
				status: 'failed',
				errorMessage: `${token} recent ${String(i)}`,
			})
		}
		const messages = await listRecentFailedErrorMessages({
			store: 'dark_shopping',
			kind: 'gc',
			limit: 4,
			windowMs: 60 * 60 * 1000,
		})
		const ours = messages.filter((message) => message.startsWith(token))
		expect(ours).toEqual([`${token} recent 1`, `${token} recent 0`])
		expect(ours).not.toContain(`${token} before-success`)
	})
})
