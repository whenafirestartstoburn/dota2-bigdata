import { status } from '#src/utils/status'
import {
	classifyDarkOrderStatus,
	createDarkOrder,
	DarkShoppingError,
	fetchDarkDeliveryText,
	getDarkOrderDownloadLink,
	getDarkOrderStatus,
	truncateForLog,
	waitDarkOrderReady,
} from './dark-shopping'
import { redactBoughtDelivery } from './parse-account'
import { darkShoppingConfigured } from './rate-limit'

export type MarketplaceStoreId = 'dark_shopping'

export type MarketplacePurchase = {
	externalOrderId: string
	deliveryText: string
}

export type MarketplaceDeliveryPeek =
	| { phase: 'ready'; status: string; deliveryText: string }
	| { phase: 'failed'; status: string; errorMessage: string }
	| { phase: 'pending'; status: string }

export function marketplaceConfigured(store: MarketplaceStoreId): boolean {
	if (store === 'dark_shopping') return darkShoppingConfigured()
	return false
}

export async function startMarketplacePurchase(input: {
	store: MarketplaceStoreId
	productId: number
	idempotenceId: string
}): Promise<{ externalOrderId: string; initialLink: string | null }> {
	if (input.store !== 'dark_shopping') {
		throw new Error(`unsupported marketplace store ${input.store}`)
	}
	const created = await createDarkOrder({
		productId: input.productId,
		quantity: 1,
		idempotenceId: input.idempotenceId,
	})
	status(
		`dark.shopping: order id=${String(created.id)} status=${created.status} idempotence=${String(created.idempotence)}`,
	)
	return {
		externalOrderId: String(created.id),
		initialLink: created.status === 'pending' ? null : created.link,
	}
}

export async function waitMarketplaceDelivery(input: {
	store: MarketplaceStoreId
	externalOrderId: string
	timeoutMs: number
	initialLink?: string | null
}): Promise<{ deliveryText: string }> {
	if (input.store !== 'dark_shopping') {
		throw new Error(`unsupported marketplace store ${input.store}`)
	}
	const orderId = Number(input.externalOrderId)
	const ready = await waitDarkOrderReady({
		orderId,
		timeoutMs: input.timeoutMs,
		initialLink: input.initialLink,
	})
	const deliveryText = await fetchDarkDeliveryText(ready.link)
	status(
		`dark.shopping: delivery ${truncateForLog(redactBoughtDelivery(deliveryText))}`,
	)
	return { deliveryText }
}

export async function peekMarketplaceDelivery(input: {
	store: MarketplaceStoreId
	externalOrderId: string
}): Promise<MarketplaceDeliveryPeek> {
	if (input.store !== 'dark_shopping') {
		throw new Error(`unsupported marketplace store ${input.store}`)
	}
	const orderId = Number(input.externalOrderId)
	const lastStatus = await getDarkOrderStatus(orderId)
	const phase = classifyDarkOrderStatus(lastStatus)
	if (phase === 'pending') {
		return { phase, status: lastStatus }
	}
	if (phase === 'failed') {
		return {
			phase,
			status: lastStatus,
			errorMessage: `dark.shopping order ${String(orderId)} ended ${lastStatus}`,
		}
	}
	const link = await getDarkOrderDownloadLink(orderId)
	const deliveryText = await fetchDarkDeliveryText(link)
	status(
		`dark.shopping: delivery ${truncateForLog(redactBoughtDelivery(deliveryText))}`,
	)
	return { phase: 'ready', status: lastStatus, deliveryText }
}

export async function purchaseFromMarketplace(input: {
	store: MarketplaceStoreId
	productId: number
	idempotenceId: string
	timeoutMs: number
}): Promise<MarketplacePurchase> {
	const started = await startMarketplacePurchase(input)
	const { deliveryText } = await waitMarketplaceDelivery({
		store: input.store,
		externalOrderId: started.externalOrderId,
		timeoutMs: input.timeoutMs,
		initialLink: started.initialLink,
	})
	return {
		externalOrderId: started.externalOrderId,
		deliveryText,
	}
}

export { DarkShoppingError }
