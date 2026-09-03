import {
	countPendingOrders,
	countReadyApiKeys,
	countReadyGcAccounts,
} from '#src/components/resource-health'
import { getAppSettings, replenishGap } from '#src/components/settings'
import { buyAccounts } from '#src/marketplace/buy-account'
import { getWhitelistedProductByKind } from '#src/marketplace/products'
import { marketplaceConfigured } from '#src/marketplace/store'
import { logger } from '#src/utils/logger'

const STORE = 'dark_shopping' as const

export async function runReplenishAccounts(): Promise<void> {
	const settings = await getAppSettings()
	await replenishKind('api_key', settings.desiredApiKeys, settings)
	await replenishKind('gc', settings.desiredGcAccounts, settings)
}

async function replenishKind(
	kind: 'api_key' | 'gc',
	desired: number,
	settings: Awaited<ReturnType<typeof getAppSettings>>,
): Promise<void> {
	const ready =
		kind === 'api_key'
			? await countReadyApiKeys()
			: await countReadyGcAccounts()
	const pending = await countPendingOrders(kind)
	const gap = replenishGap(desired, ready, pending)
	if (gap <= 0) return
	if (!marketplaceConfigured(STORE)) {
		logger.warn(
			{ kind, ready, pending, desired },
			'marketplace is not configured; cannot replenish accounts',
		)
		return
	}
	const product = await getWhitelistedProductByKind(STORE, kind)
	if (product === null) {
		logger.warn(
			{ kind, store: STORE },
			'no whitelisted product; cannot replenish accounts',
		)
		return
	}
	const count = Math.min(gap, settings.marketplaceBuyMax)
	logger.info(
		{
			kind,
			ready,
			pending,
			desired,
			count,
			productId: product.productId,
		},
		'replenishing accounts from marketplace',
	)
	const result = await buyAccounts({
		productId: product.productId,
		store: STORE,
		type: kind,
		count,
	})
	const failed = result.orders.filter((order) => order.status !== 'success')
	if (failed.length > 0) {
		logger.warn(
			{ kind, failed: failed.length, total: result.orders.length },
			'replenish had orders that did not succeed',
		)
	}
}
