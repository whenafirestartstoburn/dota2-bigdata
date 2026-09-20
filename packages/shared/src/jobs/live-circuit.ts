import {
	liveCallsInProgress,
	liveCircuitOpen,
	livePollSkipped,
} from '#src/metrics/observe'

export const LIVE_POLL_JOBS = [
	'poll_live_games',
	'poll_top_live',
	'poll_realtime_stats',
] as const

export type LivePollJob = (typeof LIVE_POLL_JOBS)[number]

export class LiveCircuitOpenError extends Error {
	readonly job: LivePollJob

	constructor(job: LivePollJob) {
		super(`live poll skipped: concurrent cap (${job})`)
		this.name = 'LiveCircuitOpenError'
		this.job = job
	}
}

let inFlight = 0
let lastMax = 0

export function liveCallsInFlight(): number {
	return inFlight
}

export function resetLiveCallsForTests(): void {
	inFlight = 0
	lastMax = 0
	liveCallsInProgress.setValue(0)
	liveCircuitOpen.setValue(0)
}

function setCircuitGauge(): void {
	liveCircuitOpen.setValue(lastMax > 0 && inFlight >= lastMax ? 1 : 0)
}

export function nextLiveRunAt(startedMs: number, intervalMs: number): Date {
	return new Date(startedMs + intervalMs)
}

export function tryEnterLiveCall(max: number): boolean {
	lastMax = max
	if (inFlight >= max) {
		setCircuitGauge()
		return false
	}
	inFlight += 1
	liveCallsInProgress.setValue(inFlight)
	setCircuitGauge()
	return true
}

export function leaveLiveCall(): void {
	if (inFlight > 0) inFlight -= 1
	liveCallsInProgress.setValue(inFlight)
	setCircuitGauge()
}

export function skipLiveCall(job: LivePollJob): never {
	livePollSkipped.inc({ job, reason: 'concurrency' })
	throw new LiveCircuitOpenError(job)
}
