import { asNumber, asText } from '#src/store/coerce'
import { db, sql } from '#src/utils/db'

export type MarketplaceStore = 'dark_shopping'
export type AccountPurchaseKind = 'api_key' | 'gc'
export type MarketplaceOrderStatus = 'pending' | 'success' | 'failed'

export type MarketplaceOrder = {
	id: string
	store: MarketplaceStore
	kind: AccountPurchaseKind
	productId: number
	status: MarketplaceOrderStatus
	idempotenceId: string
	externalOrderId: string | null
	steamAccountId: number | null
	testOnMatchId: number | null
	errorMessage: string | null
	testResult: unknown
}

function mapOrder(row: Record<string, unknown>): MarketplaceOrder {
	const store = row.store
	const kind = row.kind
	const status = row.status
	if (store !== 'dark_shopping') {
		throw new Error(`unexpected marketplace store ${String(store)}`)
	}
	if (kind !== 'api_key' && kind !== 'gc') {
		throw new Error(`unexpected purchase kind ${String(kind)}`)
	}
	if (status !== 'pending' && status !== 'success' && status !== 'failed') {
		throw new Error(`unexpected order status ${String(status)}`)
	}
	return {
		id: String(row.id),
		store,
		kind,
		productId: asNumber(row.product_id) ?? 0,
		status,
		idempotenceId: String(row.idempotence_id),
		externalOrderId: asText(row.external_order_id),
		steamAccountId: asNumber(row.steam_account_id),
		testOnMatchId: asNumber(row.test_on_match_id),
		errorMessage: asText(row.error_message),
		testResult: row.test_result ?? null,
	}
}

export async function insertMarketplaceOrder(input: {
	store: MarketplaceStore
	kind: AccountPurchaseKind
	productId: number
	testOnMatchId: number | null
}): Promise<MarketplaceOrder> {
	const [row] = await db.execute(sql`
		INSERT INTO marketplace_orders (
			store, kind, product_id, status, idempotence_id, test_on_match_id
		) VALUES (
			${input.store}::marketplace_store,
			${input.kind}::account_purchase_kind,
			${input.productId},
			'pending',
			gen_random_uuid()::text,
			${input.testOnMatchId}
		)
		RETURNING *
	`)
	if (row === undefined) throw new Error('failed to insert marketplace_orders')
	return mapOrder(row)
}

export async function setMarketplaceExternalId(
	id: string,
	externalOrderId: string,
): Promise<void> {
	await db.execute(sql`
		UPDATE marketplace_orders
		SET
			external_order_id = ${externalOrderId},
			updated_at = now()
		WHERE id = ${id}::uuid
	`)
}

export async function markMarketplaceOrderPending(input: {
	id: string
	errorMessage: string
}): Promise<void> {
	await db.execute(sql`
		UPDATE marketplace_orders
		SET
			error_message = ${input.errorMessage},
			updated_at = now()
		WHERE id = ${input.id}::uuid
	`)
}

export async function finishMarketplaceOrder(input: {
	id: string
	status: MarketplaceOrderStatus
	steamAccountId?: number | null
	errorMessage?: string | null
	testResult?: unknown
}): Promise<void> {
	const testJson =
		input.testResult === undefined ? null : JSON.stringify(input.testResult)
	await db.execute(sql`
		UPDATE marketplace_orders
		SET
			status = ${input.status}::marketplace_order_status,
			steam_account_id = ${input.steamAccountId ?? null},
			error_message = ${input.errorMessage ?? null},
			test_result = ${testJson}::jsonb,
			completed_at = now(),
			updated_at = now()
		WHERE id = ${input.id}::uuid
	`)
}
