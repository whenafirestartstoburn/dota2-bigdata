import { describe, expect, test } from 'bun:test'
import {
	advanceHistoryMiss,
	canResumeLive,
	ERROR_KIND,
	INGEST,
	isLaterPhase,
	liveFeedsDone,
} from '#src/store/match-phase'

describe('liveFeedsDone', () => {
	test('requires every feed that listed the match to cross the threshold', () => {
		expect(liveFeedsDone([INGEST.liveLeague], 1, 0, 2)).toBe(false)
		expect(liveFeedsDone([INGEST.liveLeague], 2, 99, 2)).toBe(true)
		expect(liveFeedsDone([INGEST.liveLeague, INGEST.topLive], 2, 1, 2)).toBe(
			false,
		)
		expect(liveFeedsDone([INGEST.liveLeague, INGEST.topLive], 2, 2, 2)).toBe(
			true,
		)
		expect(liveFeedsDone([INGEST.topLive], 0, 2, 2)).toBe(true)
		expect(liveFeedsDone([INGEST.history], 5, 5, 2)).toBe(false)
	})
})

describe('advanceHistoryMiss', () => {
	test('uses the fast interval for the first 100 misses', () => {
		const first = advanceHistoryMiss({
			fastCount: 0,
			slowCount: 0,
			fastLimit: 100,
			slowLimit: 100,
			fastMs: 5000,
			slowMs: 60_000,
		})
		expect(first.fastCount).toBe(1)
		expect(first.slowCount).toBe(0)
		expect(first.phase).toBe('awaiting_history')
		expect(first.nextPollMs).toBe(5000)
		expect(first.errorKind).toBeNull()
	})

	test('switches to the slow interval after the fast budget', () => {
		const next = advanceHistoryMiss({
			fastCount: 100,
			slowCount: 0,
			fastLimit: 100,
			slowLimit: 100,
			fastMs: 5000,
			slowMs: 60_000,
		})
		expect(next.fastCount).toBe(100)
		expect(next.slowCount).toBe(1)
		expect(next.nextPollMs).toBe(60_000)
		expect(next.phase).toBe('awaiting_history')
	})

	test('fails after both budgets', () => {
		const done = advanceHistoryMiss({
			fastCount: 100,
			slowCount: 100,
			fastLimit: 100,
			slowLimit: 100,
			fastMs: 5000,
			slowMs: 60_000,
		})
		expect(done.phase).toBe('failed')
		expect(done.errorKind).toBe(ERROR_KIND.historyTimeout)
	})
})

describe('isLaterPhase', () => {
	test('protects terminal and replay phases from being rewritten', () => {
		expect(isLaterPhase('live')).toBe(false)
		expect(isLaterPhase('awaiting_history')).toBe(false)
		expect(isLaterPhase('not_started')).toBe(false)
		expect(isLaterPhase('parsed')).toBe(true)
		expect(isLaterPhase('failed')).toBe(true)
	})
})

describe('canResumeLive', () => {
	test('a live-feed sighting flaps false finishes, not replay/parse', () => {
		expect(canResumeLive('live')).toBe(true)
		expect(canResumeLive('not_started')).toBe(true)
		expect(canResumeLive('awaiting_history')).toBe(true)
		expect(canResumeLive('awaiting_details')).toBe(true)
		expect(canResumeLive('failed')).toBe(true)
		expect(canResumeLive('details_ready')).toBe(false)
		expect(canResumeLive('parsed')).toBe(false)
		expect(canResumeLive('replay_unavailable')).toBe(false)
	})
})
