import { describe, expect, test } from 'bun:test'
import { replayBackoffMs } from './replays'

describe('replayBackoffMs', () => {
	test('steps 5m → 15m → 1h → 6h and clamps', () => {
		expect(replayBackoffMs(0)).toBe(5 * 60_000)
		expect(replayBackoffMs(1)).toBe(15 * 60_000)
		expect(replayBackoffMs(2)).toBe(60 * 60_000)
		expect(replayBackoffMs(3)).toBe(6 * 60 * 60_000)
		expect(replayBackoffMs(99)).toBe(6 * 60 * 60_000)
		expect(replayBackoffMs(-1)).toBe(5 * 60_000)
	})
})
