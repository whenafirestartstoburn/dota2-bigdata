import { describe, expect, test } from 'bun:test'
import { deriveLeagueStatus } from './league-status'

const base = {
	league_id: 1,
	start_timestamp: 0,
	end_timestamp: 0,
	most_recent_activity: 0,
	valve_status: 0,
}

describe('deriveLeagueStatus', () => {
	test('live games force LIVE even after end timestamp', () => {
		expect(
			deriveLeagueStatus({ ...base, end_timestamp: 10 }, 100, new Set([1])),
		).toBe('LIVE')
	})

	test('future start is UPCOMING', () => {
		expect(
			deriveLeagueStatus({ ...base, start_timestamp: 200 }, 100, new Set()),
		).toBe('UPCOMING')
	})

	test('past end is FINISHED', () => {
		expect(
			deriveLeagueStatus(
				{ ...base, start_timestamp: 1, end_timestamp: 50 },
				100,
				new Set(),
			),
		).toBe('FINISHED')
	})

	test('window between start and end is LIVE', () => {
		expect(
			deriveLeagueStatus(
				{ ...base, start_timestamp: 10, end_timestamp: 200 },
				100,
				new Set(),
			),
		).toBe('LIVE')
	})

	test('Valve concluded without dates is FINISHED', () => {
		expect(
			deriveLeagueStatus({ ...base, valve_status: 5 }, 100, new Set()),
		).toBe('FINISHED')
	})

	test('stale most_recent_activity is FINISHED even if the window is open', () => {
		expect(
			deriveLeagueStatus(
				{
					...base,
					start_timestamp: 1,
					end_timestamp: 10_000_000,
					most_recent_activity: 100,
				},
				100 + 15 * 24 * 60 * 60,
				new Set(),
			),
		).toBe('FINISHED')
	})
})
