export const INGEST = {
	liveLeague: 'GetLiveLeagueGames',
	topLive: 'GetTopLiveGame',
	history: 'GetMatchHistory',
} as const

export type IngestSource = (typeof INGEST)[keyof typeof INGEST]
export type LiveIngest = typeof INGEST.liveLeague | typeof INGEST.topLive

export const WAITING = {
	liveEnd: 'live_end',
	history: 'history',
	seq: 'seq',
	gc: 'gc',
	replay: 'replay',
	parse: 'parse',
} as const

export const ERROR_KIND = {
	network: 'network',
	rateLimit: 'rate_limit',
	auth: 'auth',
	notReady: 'not_ready',
	unavailable: 'unavailable',
	historyTimeout: 'history_timeout',
	notStarted: 'not_started',
	other: 'other',
} as const

const LATER_PHASES = new Set([
	'details_ready',
	'awaiting_replay',
	'replay_stored',
	'replay_unavailable',
	'parsed',
	'failed',
])

export function isLaterPhase(phase: string | null | undefined): boolean {
	return phase != null && LATER_PHASES.has(phase)
}

export function liveFeedsDone(
	sources: readonly string[],
	liveMisses: number,
	topMisses: number,
	threshold: number,
): boolean {
	const hasLive = sources.includes(INGEST.liveLeague)
	const hasTop = sources.includes(INGEST.topLive)
	if (!hasLive && !hasTop) return false
	if (hasLive && liveMisses < threshold) return false
	if (hasTop && topMisses < threshold) return false
	return true
}

export type HistoryPollState = {
	fastCount: number
	slowCount: number
	phase: 'awaiting_history' | 'failed'
	nextPollMs: number
	errorKind: typeof ERROR_KIND.historyTimeout | null
}

export function advanceHistoryMiss(input: {
	fastCount: number
	slowCount: number
	fastLimit: number
	slowLimit: number
	fastMs: number
	slowMs: number
}): HistoryPollState {
	let fast = input.fastCount
	let slow = input.slowCount
	if (fast < input.fastLimit) {
		fast += 1
		return {
			fastCount: fast,
			slowCount: slow,
			phase: 'awaiting_history',
			nextPollMs: input.fastMs,
			errorKind: null,
		}
	}
	if (slow < input.slowLimit) {
		slow += 1
		return {
			fastCount: fast,
			slowCount: slow,
			phase: 'awaiting_history',
			nextPollMs: input.slowMs,
			errorKind: null,
		}
	}
	return {
		fastCount: fast,
		slowCount: slow,
		phase: 'failed',
		nextPollMs: 0,
		errorKind: ERROR_KIND.historyTimeout,
	}
}
