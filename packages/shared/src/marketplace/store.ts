import { status } from '#src/utils/status'
import {
	createDarkOrder,
	DarkShoppingError,
	fetchDarkDeliveryText,
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

export function marketplaceConfigured(store: MarketplaceStoreId): boolean {
	if (store === 'dark_shopping') return darkShoppingConfigured()
	return false
}

export async function purchaseFromMarketplace(input: {
	store: MarketplaceStoreId
	productId: number
	idempotenceId: string
	timeoutMs: number
}): Promise<MarketplacePurchase> {
	if (input.store === 'dark_shopping') {
		return purchaseDarkShopping(input)
	}
	throw new Error(`unsupported marketplace store ${input.store}`)
}

async function purchaseDarkShopping(input: {
	productId: number
	idempotenceId: string
	timeoutMs: number
}): Promise<MarketplacePurchase> {
	const created = await createDarkOrder({
		productId: input.productId,
		quantity: 1,
		idempotenceId: input.idempotenceId,
	})
	status(
		`dark.shopping: order id=${String(created.id)} status=${created.status} idempotence=${String(created.idempotence)}`,
	)
	const ready = await waitDarkOrderReady({
		orderId: created.id,
		timeoutMs: input.timeoutMs,
		initialLink: created.status === 'pending' ? null : created.link,
	})
	const deliveryText = await fetchDarkDeliveryText(ready.link)
	status(
		`dark.shopping: delivery ${truncateForLog(redactBoughtDelivery(deliveryText))}`,
	)
	return {
		externalOrderId: String(created.id),
		deliveryText,
	}
}

export { DarkShoppingError }
