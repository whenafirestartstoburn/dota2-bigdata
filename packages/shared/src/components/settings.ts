import { asNumber } from '#src/store/coerce'
import { db, sql } from '#src/utils/db'

const VALVE_HISTORY_MAX = 100

export type AppSettings = {
	desiredApiKeys: number
	desiredGcAccounts: number
	proxyErrorThreshold: number
	proxyErrorWindow: number
	proxyRetestMax: number
	gcAccountErrorThreshold: number
	gcAccountErrorWindow: number
	gcAccountRetestMax: number
	apiKeyErrorThreshold: number
	apiKeyErrorWindow: number
	apiKeyRetestMax: number
	livePollIntervalMs: number
	liveMissingThreshold: number
	replayLiveDelayMs: number
	historyPageSize: number
	historyDetailsEnqueueLimit: number
	historyReplayEnqueueLimit: number
	seqBatchSize: number
	steamApiMinIntervalMs: number
	historyNewestRefreshMs: number
	historyExhaustedRefreshMs: number
	historyFastPollMs: number
	historyFastPollLimit: number
	historySlowPollMs: number
	historySlowPollLimit: number
	replenishIntervalMs: number
	retestIntervalMs: number
	marketplaceBuyMax: number
	marketplaceWaitMs: number
	marketplaceMinIntervalMs: number
	gcLogonAttempts: number
	apiKeyRateLimitMs: number
	gcAccountRateLimitMs: number
	parserParallelism: number
}

const KEYS = {
	desiredApiKeys: 'desired_api_keys',
	desiredGcAccounts: 'desired_gc_accounts',
	proxyErrorThreshold: 'proxy_error_threshold',
	proxyErrorWindow: 'proxy_error_window',
	proxyRetestMax: 'proxy_retest_max',
	gcAccountErrorThreshold: 'gc_account_error_threshold',
	gcAccountErrorWindow: 'gc_account_error_window',
	gcAccountRetestMax: 'gc_account_retest_max',
	apiKeyErrorThreshold: 'api_key_error_threshold',
	apiKeyErrorWindow: 'api_key_error_window',
	apiKeyRetestMax: 'api_key_retest_max',
	livePollIntervalMs: 'live_poll_interval_ms',
	liveMissingThreshold: 'live_missing_threshold',
	replayLiveDelayMs: 'replay_live_delay_ms',
	historyPageSize: 'history_page_size',
	historyDetailsEnqueueLimit: 'history_details_enqueue_limit',
	historyReplayEnqueueLimit: 'history_replay_enqueue_limit',
	seqBatchSize: 'seq_batch_size',
	steamApiMinIntervalMs: 'steam_api_min_interval_ms',
	historyNewestRefreshMs: 'history_newest_refresh_ms',
	historyExhaustedRefreshMs: 'history_exhausted_refresh_ms',
	historyFastPollMs: 'history_fast_poll_ms',
	historyFastPollLimit: 'history_fast_poll_limit',
	historySlowPollMs: 'history_slow_poll_ms',
	historySlowPollLimit: 'history_slow_poll_limit',
	replenishIntervalMs: 'replenish_interval_ms',
	retestIntervalMs: 'retest_interval_ms',
	marketplaceBuyMax: 'marketplace_buy_max',
	marketplaceWaitMs: 'marketplace_wait_ms',
	marketplaceMinIntervalMs: 'marketplace_min_interval_ms',
	gcLogonAttempts: 'gc_logon_attempts',
	apiKeyRateLimitMs: 'api_key_rate_limit_ms',
	gcAccountRateLimitMs: 'gc_account_rate_limit_ms',
	parserParallelism: 'parser_parallelism',
} as const

function requiredNumber(rows: Map<string, string>, key: string): number {
	const n = asNumber(rows.get(key))
	if (n === null) {
		throw new Error(`settings.${key} is missing or not a number`)
	}
	return n
}

function requiredPercent(rows: Map<string, string>, key: string): number {
	const n = requiredNumber(rows, key)
	if (n < 0 || n > 100) {
		throw new Error(`settings.${key} must be 0-100, got ${String(n)}`)
	}
	return n / 100
}

function requiredPositiveInt(rows: Map<string, string>, key: string): number {
	const n = requiredNumber(rows, key)
	if (!Number.isInteger(n) || n < 1) {
		throw new Error(`settings.${key} must be a positive integer`)
	}
	return n
}

function optionalPositiveInt(
	rows: Map<string, string>,
	key: string,
	fallback: number,
): number {
	if (!rows.has(key)) return fallback
	return requiredPositiveInt(rows, key)
}

export async function getAppSettings(): Promise<AppSettings> {
	const rows = await db.execute(sql`SELECT key, value FROM settings`)
	const map = new Map<string, string>()
	for (const row of rows) {
		map.set(String(row.key), String(row.value))
	}
	const historyPage = requiredPositiveInt(map, KEYS.historyPageSize)
	const seqBatch = requiredPositiveInt(map, KEYS.seqBatchSize)
	return {
		desiredApiKeys: requiredPositiveInt(map, KEYS.desiredApiKeys),
		desiredGcAccounts: requiredPositiveInt(map, KEYS.desiredGcAccounts),
		proxyErrorThreshold: requiredPercent(map, KEYS.proxyErrorThreshold),
		proxyErrorWindow: requiredPositiveInt(map, KEYS.proxyErrorWindow),
		proxyRetestMax: requiredPositiveInt(map, KEYS.proxyRetestMax),
		gcAccountErrorThreshold: requiredPercent(map, KEYS.gcAccountErrorThreshold),
		gcAccountErrorWindow: requiredPositiveInt(map, KEYS.gcAccountErrorWindow),
		gcAccountRetestMax: requiredPositiveInt(map, KEYS.gcAccountRetestMax),
		apiKeyErrorThreshold: requiredPercent(map, KEYS.apiKeyErrorThreshold),
		apiKeyErrorWindow: requiredPositiveInt(map, KEYS.apiKeyErrorWindow),
		apiKeyRetestMax: requiredPositiveInt(map, KEYS.apiKeyRetestMax),
		livePollIntervalMs: requiredPositiveInt(map, KEYS.livePollIntervalMs),
		liveMissingThreshold: requiredPositiveInt(map, KEYS.liveMissingThreshold),
		replayLiveDelayMs: requiredPositiveInt(map, KEYS.replayLiveDelayMs),
		historyPageSize: Math.min(historyPage, VALVE_HISTORY_MAX),
		historyDetailsEnqueueLimit: requiredPositiveInt(
			map,
			KEYS.historyDetailsEnqueueLimit,
		),
		historyReplayEnqueueLimit: requiredPositiveInt(
			map,
			KEYS.historyReplayEnqueueLimit,
		),
		seqBatchSize: Math.min(seqBatch, VALVE_HISTORY_MAX),
		steamApiMinIntervalMs: requiredPositiveInt(map, KEYS.steamApiMinIntervalMs),
		historyNewestRefreshMs: requiredPositiveInt(
			map,
			KEYS.historyNewestRefreshMs,
		),
		historyExhaustedRefreshMs: requiredPositiveInt(
			map,
			KEYS.historyExhaustedRefreshMs,
		),
		historyFastPollMs: requiredPositiveInt(map, KEYS.historyFastPollMs),
		historyFastPollLimit: requiredPositiveInt(map, KEYS.historyFastPollLimit),
		historySlowPollMs: requiredPositiveInt(map, KEYS.historySlowPollMs),
		historySlowPollLimit: requiredPositiveInt(map, KEYS.historySlowPollLimit),
		replenishIntervalMs: requiredPositiveInt(map, KEYS.replenishIntervalMs),
		retestIntervalMs: requiredPositiveInt(map, KEYS.retestIntervalMs),
		marketplaceBuyMax: requiredPositiveInt(map, KEYS.marketplaceBuyMax),
		marketplaceWaitMs: requiredPositiveInt(map, KEYS.marketplaceWaitMs),
		marketplaceMinIntervalMs: requiredPositiveInt(
			map,
			KEYS.marketplaceMinIntervalMs,
		),
		gcLogonAttempts: requiredPositiveInt(map, KEYS.gcLogonAttempts),
		apiKeyRateLimitMs: requiredPositiveInt(map, KEYS.apiKeyRateLimitMs),
		gcAccountRateLimitMs: requiredPositiveInt(map, KEYS.gcAccountRateLimitMs),
		parserParallelism: optionalPositiveInt(map, KEYS.parserParallelism, 10),
	}
}

export function replenishGap(
	desired: number,
	ready: number,
	pending: number,
): number {
	return Math.max(0, desired - ready - pending)
}
