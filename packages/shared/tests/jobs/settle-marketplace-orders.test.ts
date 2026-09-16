import { describe, expect, test } from 'bun:test'
import {
	pendingOrderExpired,
	resolvePendingExternalId,
} from '#src/jobs/settle-marketplace-orders'
import type { MarketplaceOrder } from '#src/marketplace/orders'

function order(
	partial: Partial<MarketplaceOrder> & Pick<MarketplaceOrder, 'id'>,
): MarketplaceOrder {
	return {
		orderId: '00000000-0000-0000-0000-000000000000',
		store: 'dark_shopping',
		kind: 'api_key',
		productId: 158404,
		status: 'pending',
		idempotenceId: 'idem',
		externalOrderId: null,
		steamAccountId: null,
		testOnMatchId: null,
		errorMessage: null,
		testResult: null,
		createdAt: new Date('2026-09-16T21:10:00.000Z'),
		...partial,
	}
}

describe('resolvePendingExternalId', () => {
	test('prefers the stored Dark Shopping id', () => {
		expect(
			resolvePendingExternalId(
				order({
					id: 1,
					externalOrderId: '44',
					errorMessage:
						'dark.shopping order 8262790 still in_process after 120000ms',
				}),
			),
		).toBe('44')
	})

	test('parses the id from a wait-timeout error when the column is empty', () => {
		expect(
			resolvePendingExternalId(
				order({
					id: 1,
					errorMessage:
						'dark.shopping order 8262790 still in_process after 120000ms',
				}),
			),
		).toBe('8262790')
	})
})

describe('pendingOrderExpired', () => {
	test('expires one hour after created_at', () => {
		const created = new Date('2026-09-16T21:10:00.000Z')
		expect(
			pendingOrderExpired(
				created,
				new Date('2026-09-16T21:10:59.999Z'),
				3_600_000,
			),
		).toBe(false)
		expect(
			pendingOrderExpired(
				created,
				new Date('2026-09-16T22:10:00.000Z'),
				3_600_000,
			),
		).toBe(true)
	})
})
