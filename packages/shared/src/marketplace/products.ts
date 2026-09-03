import type {
	AccountPurchaseKind,
	MarketplaceStore,
} from '#src/marketplace/orders'
import { asNumber } from '#src/store/coerce'
import { db, sql } from '#src/utils/db'

export type MarketplaceProduct = {
	id: number
	store: MarketplaceStore
	kind: AccountPurchaseKind
	productId: number
}

export class UnknownProductError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'UnknownProductError'
	}
}

function mapProduct(row: Record<string, unknown>): MarketplaceProduct {
	const store = row.store
	const kind = row.kind
	if (store !== 'dark_shopping') {
		throw new Error(`unexpected marketplace store ${String(store)}`)
	}
	if (kind !== 'api_key' && kind !== 'gc') {
		throw new Error(`unexpected purchase kind ${String(kind)}`)
	}
	return {
		id: asNumber(row.id) ?? 0,
		store,
		kind,
		productId: asNumber(row.product_id) ?? 0,
	}
}

export async function getWhitelistedProduct(
	store: MarketplaceStore,
	productId: number,
): Promise<MarketplaceProduct | null> {
	const [row] = await db.execute(sql`
		SELECT id, store, kind, product_id
		FROM marketplace_products
		WHERE store = ${store}::marketplace_store
			AND product_id = ${productId}
	`)
	return row === undefined ? null : mapProduct(row as Record<string, unknown>)
}

export async function getWhitelistedProductByKind(
	store: MarketplaceStore,
	kind: AccountPurchaseKind,
): Promise<MarketplaceProduct | null> {
	const [row] = await db.execute(sql`
		SELECT id, store, kind, product_id
		FROM marketplace_products
		WHERE store = ${store}::marketplace_store
			AND kind = ${kind}::account_purchase_kind
	`)
	return row === undefined ? null : mapProduct(row as Record<string, unknown>)
}

export async function assertBuyableProduct(input: {
	store: MarketplaceStore
	productId: number
	type: AccountPurchaseKind
}): Promise<MarketplaceProduct> {
	const product = await getWhitelistedProduct(input.store, input.productId)
	if (product === null) {
		throw new UnknownProductError(
			`product ${String(input.productId)} is not whitelisted for ${input.store}`,
		)
	}
	if (product.kind !== input.type) {
		throw new UnknownProductError(
			`product ${String(input.productId)} is ${product.kind}, not ${input.type}`,
		)
	}
	return product
}
