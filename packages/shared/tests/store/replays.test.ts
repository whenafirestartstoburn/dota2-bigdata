import { describe, expect, test } from 'bun:test'
import { replayBackoffMs } from '#src/store/replays'

describe('replayBackoffMs', () => {
	test('1m, 1m, 3m × 20, 1h × 24, then give up', () => {
		expect(replayBackoffMs(0)).toBe(60_000)
		expect(replayBackoffMs(1)).toBe(60_000)
		expect(replayBackoffMs(2)).toBe(3 * 60_000)
		expect(replayBackoffMs(21)).toBe(3 * 60_000)
		expect(replayBackoffMs(22)).toBe(60 * 60_000)
		expect(replayBackoffMs(45)).toBe(60 * 60_000)
		expect(replayBackoffMs(46)).toBeNull()
		expect(replayBackoffMs(99)).toBeNull()
		expect(replayBackoffMs(-1)).toBe(60_000)
	})
})
