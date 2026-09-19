import { asDate, asNumber, asText } from '#src/store/coerce'
import { db, sql } from '#src/utils/db'

export type MarketplaceStore = 'dark_shopping'
export type AccountPurchaseKind = 'api_key' | 'gc'
export type MarketplaceOrderStatus = 'pending' | 'success' | 'failed'

export type MarketplaceOrder = {
	id: number
	orderId: string
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
	createdAt: Date
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
	const id = asNumber(row.id)
	if (id === null) throw new Error('marketplace_orders.id is missing')
	return {
		id,
		orderId: String(row.order_id),
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
		createdAt: asDate(row.created_at) ?? new Date(0),
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
	id: number,
	externalOrderId: string,
): Promise<void> {
	await db.execute(sql`
		UPDATE marketplace_orders
		SET
			external_order_id = ${externalOrderId},
			updated_at = now()
		WHERE id = ${id}
	`)
}

export async function markMarketplaceOrderPending(input: {
	id: number
	errorMessage: string
}): Promise<void> {
	await db.execute(sql`
		UPDATE marketplace_orders
		SET
			error_message = ${input.errorMessage},
			updated_at = now()
		WHERE id = ${input.id}
	`)
}

export async function finishMarketplaceOrder(input: {
	id: number
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
		WHERE id = ${input.id}
	`)
}

export async function listRecentFailedErrorMessages(input: {
	store: MarketplaceStore
	kind: AccountPurchaseKind
	limit: number
	windowMs: number
}): Promise<string[]> {
	const rows = await db.execute(sql`
		SELECT error_message
		FROM marketplace_orders
		WHERE store = ${input.store}::marketplace_store
			AND kind = ${input.kind}::account_purchase_kind
			AND status = 'failed'::marketplace_order_status
			AND updated_at > now() - (${input.windowMs} * interval '1 millisecond')
			AND updated_at > COALESCE(
				(
					SELECT MAX(updated_at)
					FROM marketplace_orders AS ok
					WHERE ok.store = ${input.store}::marketplace_store
						AND ok.kind = ${input.kind}::account_purchase_kind
						AND ok.status = 'success'::marketplace_order_status
				),
				'-infinity'::timestamptz
			)
		ORDER BY updated_at DESC, id DESC
		LIMIT ${input.limit}
	`)
	return rows.map((row) => asText(row.error_message) ?? '')
}

export async function listPendingMarketplaceOrders(): Promise<
	MarketplaceOrder[]
> {
	const rows = await db.execute(sql`
		SELECT *
		FROM marketplace_orders
		WHERE status = 'pending'::marketplace_order_status
		ORDER BY created_at ASC, id ASC
	`)
	return rows.map((row) => mapOrder(row))
}
