import { getAppSettings } from '#src/components/settings'
import { asNumber } from '#src/store/coerce'
import { db, sql } from '#src/utils/db'
import { logger } from '#src/utils/logger'

export type ResourceKind = 'proxy' | 'gc_account' | 'api_key'

function windowOf(
	kind: ResourceKind,
	settings: Awaited<ReturnType<typeof getAppSettings>>,
): { threshold: number; window: number; retestMax: number } {
	if (kind === 'proxy') {
		return {
			threshold: settings.proxyErrorThreshold,
			window: settings.proxyErrorWindow,
			retestMax: settings.proxyRetestMax,
		}
	}
	if (kind === 'gc_account') {
		return {
			threshold: settings.gcAccountErrorThreshold,
			window: settings.gcAccountErrorWindow,
			retestMax: settings.gcAccountRetestMax,
		}
	}
	return {
		threshold: settings.apiKeyErrorThreshold,
		window: settings.apiKeyErrorWindow,
		retestMax: settings.apiKeyRetestMax,
	}
}

async function updateResource(input: {
	kind: ResourceKind
	resourceId: number
	status?: 'ready' | 'disabled'
	lastError?: string | null
	retestCount?: number
	bumpRetest?: boolean
}): Promise<void> {
	const status = input.status
	const lastError = input.lastError
	const retestCount = input.retestCount
	const bump = input.bumpRetest === true
	if (input.kind === 'proxy') {
		await db.execute(sql`
			UPDATE proxies
			SET
				status = CASE
					WHEN ${status ?? null}::text IS NULL THEN status
					ELSE ${status ?? 'ready'}::resource_status
				END,
				last_error = CASE
					WHEN ${lastError === undefined} THEN last_error
					ELSE ${lastError ?? null}
				END,
				retest_count = CASE
					WHEN ${bump} THEN retest_count + 1
					WHEN ${retestCount ?? null}::int IS NULL THEN retest_count
					ELSE ${retestCount ?? 0}
				END
			WHERE id = ${input.resourceId}
		`)
		return
	}
	if (input.kind === 'gc_account') {
		await db.execute(sql`
			UPDATE steam_accounts
			SET
				status = CASE
					WHEN ${status ?? null}::text IS NULL THEN status
					ELSE ${status ?? 'ready'}::resource_status
				END,
				last_error = CASE
					WHEN ${lastError === undefined} THEN last_error
					ELSE ${lastError ?? null}
				END,
				retest_count = CASE
					WHEN ${bump} THEN retest_count + 1
					WHEN ${retestCount ?? null}::int IS NULL THEN retest_count
					ELSE ${retestCount ?? 0}
				END
			WHERE id = ${input.resourceId}
		`)
		return
	}
	await db.execute(sql`
		UPDATE steam_api_keys
		SET
			status = CASE
				WHEN ${status ?? null}::text IS NULL THEN status
				ELSE ${status ?? 'ready'}::resource_status
			END,
			last_error = CASE
				WHEN ${lastError === undefined} THEN last_error
				ELSE ${lastError ?? null}
			END,
			retest_count = CASE
				WHEN ${bump} THEN retest_count + 1
				WHEN ${retestCount ?? null}::int IS NULL THEN retest_count
				ELSE ${retestCount ?? 0}
			END
		WHERE id = ${input.resourceId}
	`)
}

export async function disableResource(input: {
	kind: ResourceKind
	resourceId: number
	error: string
	giveUp?: boolean
}): Promise<void> {
	const settings = await getAppSettings()
	const { retestMax } = windowOf(input.kind, settings)
	logger.warn(
		{ kind: input.kind, resourceId: input.resourceId, err: input.error },
		input.giveUp === true
			? 'disabling resource without retest'
			: 'disabling resource after error window',
	)
	await updateResource({
		kind: input.kind,
		resourceId: input.resourceId,
		status: 'disabled',
		lastError: input.error,
		retestCount: input.giveUp === true ? retestMax : 0,
	})
}

export async function restoreResource(input: {
	kind: ResourceKind
	resourceId: number
}): Promise<void> {
	await updateResource({
		kind: input.kind,
		resourceId: input.resourceId,
		status: 'ready',
		lastError: null,
		retestCount: 0,
	})
}

export async function bumpResourceRetest(input: {
	kind: ResourceKind
	resourceId: number
	error: string
}): Promise<void> {
	await updateResource({
		kind: input.kind,
		resourceId: input.resourceId,
		lastError: input.error,
		bumpRetest: true,
	})
}

export async function recordResourceAttempt(input: {
	kind: ResourceKind
	resourceId: number
	ok: boolean
	error?: string | null
}): Promise<boolean> {
	const settings = await getAppSettings()
	const { threshold, window } = windowOf(input.kind, settings)
	const error = input.ok ? null : (input.error ?? 'failed')
	const crossed = await db.transaction(async (tx) => {
		await tx.execute(sql`
			INSERT INTO resource_attempts (kind, resource_id, ok, error)
			VALUES (
				${input.kind}::resource_kind,
				${input.resourceId},
				${input.ok},
				${error}
			)
		`)
		await tx.execute(sql`
			DELETE FROM resource_attempts a
			WHERE a.kind = ${input.kind}::resource_kind
				AND a.resource_id = ${input.resourceId}
				AND a.id < (
					SELECT COALESCE(MIN(keep.id), 0)
					FROM (
						SELECT id
						FROM resource_attempts
						WHERE kind = ${input.kind}::resource_kind
							AND resource_id = ${input.resourceId}
						ORDER BY id DESC
						LIMIT ${window}
					) keep
				)
		`)
		if (input.ok) return false
		const rows = await tx.execute(sql`
			SELECT ok
			FROM resource_attempts
			WHERE kind = ${input.kind}::resource_kind
				AND resource_id = ${input.resourceId}
			ORDER BY id DESC
			LIMIT ${window}
		`)
		if (rows.length < window) return false
		const fails = rows.filter((row) => row.ok === false).length
		return fails / rows.length >= threshold
	})
	if (input.ok) return false
	if (crossed) {
		await disableResource({
			kind: input.kind,
			resourceId: input.resourceId,
			error: error ?? 'failed',
		})
		return true
	}
	await updateResource({
		kind: input.kind,
		resourceId: input.resourceId,
		lastError: error,
	})
	return false
}

export async function countReadyApiKeys(): Promise<number> {
	const [row] = await db.execute(sql`
		SELECT count(*)::int AS n
		FROM steam_api_keys k
		JOIN steam_accounts a ON a.id = k.account_id
		WHERE k.status IN ('ready', 'active')
			AND (k.rate_limited_until IS NULL OR k.rate_limited_until < now())
			AND a.status IN ('ready', 'active')
	`)
	return asNumber(row?.n) ?? 0
}

export async function countReadyGcAccounts(): Promise<number> {
	const [row] = await db.execute(sql`
		SELECT count(*)::int AS n
		FROM steam_accounts a
		WHERE a.status IN ('ready', 'active')
			AND (a.rate_limited_until IS NULL OR a.rate_limited_until < now())
			AND (a.shared_secret IS NULL OR a.shared_secret = '')
			AND NOT EXISTS (
				SELECT 1 FROM steam_api_keys k WHERE k.account_id = a.id
			)
	`)
	return asNumber(row?.n) ?? 0
}

export async function countPendingOrders(
	kind: 'api_key' | 'gc',
): Promise<number> {
	const [row] = await db.execute(sql`
		SELECT count(*)::int AS n
		FROM marketplace_orders
		WHERE kind = ${kind}::account_purchase_kind
			AND status = 'pending'::marketplace_order_status
	`)
	return asNumber(row?.n) ?? 0
}
