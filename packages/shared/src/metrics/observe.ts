import { errorMessage } from '#src/store/coerce'
import { Counter, Gauge, Histogram, onMetricsReset } from './registry'

export const webapiRequests = new Counter(
	'dota_webapi_requests_total',
	'Dota2.com and Steam Web API logical calls',
	['source', 'method', 'result'],
)
export const webapiDuration = new Histogram(
	'dota_webapi_request_duration_seconds',
	'Wall time of a logical Web API call, including in-process retries',
	['source', 'method'],
)
export const gcRequests = new Counter(
	'dota_gc_requests_total',
	'Steam Dota 2 Game Coordinator RPCs',
	['method', 'result'],
)
export const gcDuration = new Histogram(
	'dota_gc_request_duration_seconds',
	'Wall time of a GC RPC',
	['method'],
)
export const gcLogons = new Counter(
	'dota_gc_logons_total',
	'Steam client logOn / Dota GC welcome attempts',
	['result'],
)
export const gcSessionUp = new Gauge(
	'dota_gc_session_up',
	'1 while this worker holds a Dota GC session',
)
export const jobsTotal = new Counter(
	'dota_jobs_total',
	'graphile-worker task outcomes',
	['job', 'result'],
)
export const jobDuration = new Histogram(
	'dota_job_duration_seconds',
	'graphile-worker task wall time',
	['job'],
)
export const jobsInProgress = new Gauge(
	'dota_jobs_in_progress',
	'graphile-worker tasks currently running',
	['job'],
)
export const replayDownloads = new Counter(
	'dota_replay_downloads_total',
	'Valve CDN replay downloads',
	['result'],
)
export const replayDownloadDuration = new Histogram(
	'dota_replay_download_duration_seconds',
	'Valve CDN replay download wall time',
)
export const replayDownloadBytes = new Counter(
	'dota_replay_download_bytes_total',
	'Bytes written to S3 for downloaded replays',
)
export const marketplaceHttp = new Counter(
	'dota_marketplace_http_requests_total',
	'Marketplace HTTP attempts',
	['store', 'method', 'result'],
)
export const marketplaceHttpDuration = new Histogram(
	'dota_marketplace_http_request_duration_seconds',
	'Marketplace HTTP attempt wall time',
	['store', 'method'],
)
export const marketplaceOrders = new Counter(
	'dota_marketplace_orders_total',
	'Local marketplace order outcomes',
	['store', 'kind', 'status'],
)

export const resources = new Gauge(
	'dota_resources',
	'Steam resource rows by kind and status',
	['kind', 'status'],
)
export const accountsReady = new Gauge(
	'dota_accounts_ready',
	'Ready pool size using the replenish predicate',
	['pool'],
)
export const accountsDesired = new Gauge(
	'dota_accounts_desired',
	'settings.desired_api_keys / desired_gc_accounts',
	['pool'],
)
export const marketplaceOrderRows = new Gauge(
	'dota_marketplace_orders',
	'marketplace_orders rows',
	['store', 'kind', 'status'],
)
export const matchesByPhase = new Gauge(
	'dota_matches',
	'matches rows by phase',
	['phase'],
)
export const liveMatches = new Gauge(
	'dota_live_matches',
	'matches currently in phase=live',
)
export const replaysByStatus = new Gauge(
	'dota_replays',
	'match_replays rows by status',
	['status'],
)
export const graphileJobs = new Gauge(
	'dota_graphile_jobs',
	'graphile_worker.jobs by identifier and state',
	['identifier', 'state'],
)
export const historyWalkMatches = new Counter(
	'dota_history_walk_matches_total',
	'Matches returned on GetMatchHistory walk pages',
)
export const historyWalkPages = new Counter(
	'dota_history_walk_pages_total',
	'walk_league_history ticks',
	['result'],
)
export const leagues = new Gauge('dota_leagues', 'leagues rows by walk state', [
	'state',
])

export type WebApiSource = 'dota2' | 'steam'

export function elapsedSeconds(started: number): number {
	return (performance.now() - started) / 1000
}

export function observeWebApi(
	source: WebApiSource,
	method: string,
	result: string,
	started: number,
): void {
	webapiRequests.inc({ source, method, result })
	webapiDuration.observe({ source, method }, elapsedSeconds(started))
}

export function observeGcRequest(
	method: string,
	result: string,
	started: number,
): void {
	gcRequests.inc({ method, result })
	gcDuration.observe({ method }, elapsedSeconds(started))
}

export function observeGcLogon(result: string): void {
	gcLogons.inc({ result })
}

export function setGcSessionUp(up: boolean): void {
	gcSessionUp.setValue(up ? 1 : 0)
}

export function observeJob(job: string, result: string, started: number): void {
	jobsTotal.inc({ job, result })
	jobDuration.observe({ job }, elapsedSeconds(started))
}

export function observeReplayDownload(
	result: string,
	started: number,
	bytes?: number,
): void {
	replayDownloads.inc({ result })
	replayDownloadDuration.observe({}, elapsedSeconds(started))
	if (bytes != null && bytes > 0) replayDownloadBytes.inc({}, bytes)
}

export function observeMarketplaceHttp(
	store: string,
	method: string,
	result: string,
	started: number,
): void {
	marketplaceHttp.inc({ store, method, result })
	marketplaceHttpDuration.observe({ store, method }, elapsedSeconds(started))
}

export function observeMarketplaceOrder(
	store: string,
	kind: string,
	status: string,
): void {
	marketplaceOrders.inc({ store, kind, status })
}

export function observeHistoryWalk(input: {
	listed: number
	result: 'hits' | 'empty' | 'skipped'
}): void {
	historyWalkPages.inc({ result: input.result })
	if (input.listed > 0) historyWalkMatches.inc({}, input.listed)
}

export function classifyHttpStatus(status: number): string {
	if (status === 403) return 'http_403'
	if (status === 429) return 'http_429'
	if (status >= 500) return 'http_5xx'
	if (status >= 400) return 'http_4xx'
	return 'success'
}

export function classifyWebApiError(error: unknown): string {
	const status = steamStatus(error)
	if (status != null) return classifyHttpStatus(status)
	const name = error instanceof Error ? error.name : ''
	const message = errorMessage(error)
	if (name === 'PublicMatchError') return 'public_match'
	if (name === 'MissingProxyError' || name === 'NoUsableProxyError') {
		return 'proxy'
	}
	if (/unexpected shape|status=/i.test(message)) return 'parse'
	if (/timeout|aborted|AbortError|The operation timed out/i.test(message)) {
		return 'timeout'
	}
	if (
		/proxy/i.test(message) ||
		/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ECONNRESET|EPIPE/i.test(
			message,
		)
	) {
		return 'transport'
	}
	return 'error'
}

export function classifyGcLogon(error: unknown): string {
	const message = errorMessage(error)
	if (/InvalidPassword/i.test(message)) return 'invalid_password'
	if (/rate.?limit/i.test(message)) return 'rate_limit'
	if (/timeout waiting for Dota GC|timeout/i.test(message)) return 'timeout'
	if (/no usable Steam account/i.test(message)) return 'no_account'
	return 'error'
}

export function classifyGcRequest(error: unknown): string {
	const message = errorMessage(error)
	if (/GC match details timeout/i.test(message)) return 'timeout'
	if (/no usable Steam account/i.test(message)) return 'no_account'
	return 'error'
}

function steamStatus(error: unknown): number | undefined {
	if (typeof error !== 'object' || error === null) return undefined
	if (!('status' in error)) return undefined
	const status = error.status
	return typeof status === 'number' ? status : undefined
}

const HISTORY_WALK_RESULTS = ['hits', 'empty', 'skipped'] as const
const GC_REQUEST_RESULTS = ['success', 'timeout', 'no_account', 'error']
const GC_LOGON_RESULTS = [
	'success',
	'timeout',
	'invalid_password',
	'rate_limit',
	'no_account',
	'error',
]

export function seedIdleHistorySeries(): void {
	if (historyWalkMatches.get() === 0) historyWalkMatches.inc({}, 0)
	for (const result of HISTORY_WALK_RESULTS) {
		if (historyWalkPages.get({ result }) === 0) {
			historyWalkPages.inc({ result }, 0)
		}
	}
}

export function seedIdleGcSeries(): void {
	if (gcSessionUp.get() === 0) gcSessionUp.setValue(0)
	for (const result of GC_REQUEST_RESULTS) {
		if (gcRequests.get({ method: 'match_details', result }) === 0) {
			gcRequests.inc({ method: 'match_details', result }, 0)
		}
	}
	for (const result of GC_LOGON_RESULTS) {
		if (gcLogons.get({ result }) === 0) {
			gcLogons.inc({ result }, 0)
		}
	}
	gcDuration.ensure({ method: 'match_details' })
}

function seedIdleCatalog(): void {
	seedIdleHistorySeries()
	seedIdleGcSeries()
}

onMetricsReset(seedIdleCatalog)
