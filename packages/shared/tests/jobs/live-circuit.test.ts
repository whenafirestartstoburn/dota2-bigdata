import { afterEach, describe, expect, test } from 'bun:test'
import {
	LiveCircuitOpenError,
	leaveLiveCall,
	liveCallsInFlight,
	nextLiveRunAt,
	resetLiveCallsForTests,
	skipLiveCall,
	tryEnterLiveCall,
} from '#src/jobs/live-circuit'
import {
	liveCallsInProgress,
	liveCircuitOpen,
	livePollSkipped,
} from '#src/metrics/observe'
import { resetMetrics } from '#src/metrics/registry'

afterEach(() => {
	resetLiveCallsForTests()
	resetMetrics()
})

describe('nextLiveRunAt', () => {
	test('is the period from tick start, not from finish', () => {
		expect(nextLiveRunAt(1_000_000, 1000).getTime()).toBe(1_001_000)
	})
})

describe('tryEnterLiveCall', () => {
	test('admits up to max and then opens the circuit', () => {
		expect(tryEnterLiveCall(5)).toBe(true)
		expect(tryEnterLiveCall(5)).toBe(true)
		expect(tryEnterLiveCall(5)).toBe(true)
		expect(tryEnterLiveCall(5)).toBe(true)
		expect(tryEnterLiveCall(5)).toBe(true)
		expect(liveCallsInFlight()).toBe(5)
		expect(liveCallsInProgress.get()).toBe(5)
		expect(liveCircuitOpen.get()).toBe(1)
		expect(tryEnterLiveCall(5)).toBe(false)
		expect(liveCallsInFlight()).toBe(5)
	})

	test('a leave frees the next second', () => {
		for (let i = 0; i < 5; i++) expect(tryEnterLiveCall(5)).toBe(true)
		expect(tryEnterLiveCall(5)).toBe(false)
		leaveLiveCall()
		expect(liveCircuitOpen.get()).toBe(0)
		expect(tryEnterLiveCall(5)).toBe(true)
		expect(liveCallsInFlight()).toBe(5)
	})

	test('skipLiveCall counts the dropped second', () => {
		expect(() => skipLiveCall('poll_live_games')).toThrow(LiveCircuitOpenError)
		expect(
			livePollSkipped.get({ job: 'poll_live_games', reason: 'concurrency' }),
		).toBe(1)
	})
})
