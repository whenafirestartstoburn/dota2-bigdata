import { getAppSettings } from '#src/components/settings'
import {
	classifyPurchaseError,
	fulfillBoughtDelivery,
} from '#src/marketplace/buy-account'
import { parseDarkOrderIdFromMessage } from '#src/marketplace/dark-shopping'
import {
	finishMarketplaceOrder,
	listPendingMarketplaceOrders,
	type MarketplaceOrder,
	markMarketplaceOrderPending,
	setMarketplaceExternalId,
} from '#src/marketplace/orders'
import {
	marketplaceConfigured,
	peekMarketplaceDelivery,
} from '#src/marketplace/store'
import { observeMarketplaceOrder } from '#src/metrics/observe'
import { errorMessage } from '#src/store/coerce'
import { logger } from '#src/utils/logger'

export function resolvePendingExternalId(
	order: MarketplaceOrder,
): string | null {
	const stored = order.externalOrderId?.trim() ?? ''
	if (stored !== '') return stored
	const parsed = parseDarkOrderIdFromMessage(order.errorMessage)
	return parsed != null ? String(parsed) : null
}

export function pendingOrderExpired(
	createdAt: Date,
	now: Date,
	ttlMs: number,
): boolean {
	return now.getTime() - createdAt.getTime() >= ttlMs
}

async function failPendingOrder(
	order: MarketplaceOrder,
	errorMessage: string,
): Promise<void> {
	await finishMarketplaceOrder({
		id: order.id,
		status: 'failed',
		errorMessage,
	})
	observeMarketplaceOrder(order.store, order.kind, 'failed')
	logger.warn(
		{
			orderId: order.id,
			productId: order.productId,
			status: 'failed',
			err: errorMessage,
		},
		'settle-marketplace-orders marked pending order failed',
	)
}

async function settleOne(
	order: MarketplaceOrder,
	ttlMs: number,
	now: Date,
): Promise<void> {
	const expired = pendingOrderExpired(order.createdAt, now, ttlMs)
	const externalOrderId = resolvePendingExternalId(order)
	if (externalOrderId == null) {
		if (expired) {
			await failPendingOrder(
				order,
				'pending marketplace order has no Dark Shopping id after ttl',
			)
		} else {
			logger.warn(
				{ orderId: order.id, productId: order.productId },
				'settle-marketplace-orders skipped pending order without external id',
			)
		}
		return
	}
	if (order.externalOrderId !== externalOrderId) {
		await setMarketplaceExternalId(order.id, externalOrderId)
	}
	if (!marketplaceConfigured(order.store)) {
		if (expired) {
			await failPendingOrder(
				order,
				'dark.shopping marketplace is not configured after ttl',
			)
			return
		}
		logger.warn(
			{ orderId: order.id, store: order.store },
			'settle-marketplace-orders: marketplace is not configured',
		)
		return
	}
	const peeked = await peekMarketplaceDelivery({
		store: order.store,
		externalOrderId,
	})
	if (peeked.phase === 'ready') {
		try {
			await fulfillBoughtDelivery({
				order,
				store: order.store,
				productId: order.productId,
				kind: order.kind,
				testOnMatchId: order.testOnMatchId,
				deliveryText: peeked.deliveryText,
			})
		} catch (error) {
			const classified = classifyPurchaseError(error)
			await failPendingOrder(order, classified.errorMessage)
		}
		return
	}
	if (peeked.phase === 'failed') {
		await failPendingOrder(order, peeked.errorMessage)
		return
	}
	const still = `dark.shopping order ${externalOrderId} still ${peeked.status}`
	if (expired) {
		await failPendingOrder(order, `${still} after ${String(ttlMs)}ms`)
		return
	}
	await markMarketplaceOrderPending({
		id: order.id,
		errorMessage: still,
	})
	logger.info(
		{
			orderId: order.id,
			productId: order.productId,
			status: peeked.status,
			externalOrderId,
		},
		'settle-marketplace-orders still pending',
	)
}

export async function runSettleMarketplaceOrders(): Promise<void> {
	const settings = await getAppSettings()
	const now = new Date()
	const pending = await listPendingMarketplaceOrders()
	for (const order of pending) {
		try {
			await settleOne(order, settings.marketplacePendingTtlMs, now)
		} catch (error) {
			logger.warn(
				{
					orderId: order.id,
					productId: order.productId,
					err: errorMessage(error),
				},
				'settle-marketplace-orders tick failed for one order',
			)
		}
	}
}
