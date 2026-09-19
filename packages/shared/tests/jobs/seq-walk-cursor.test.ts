import { describe, expect, test } from 'bun:test'
import {
	claimAdvance,
	formatSeqWalkStartTime,
	highestSeqNum,
	highestStartTime,
	isProfessionalSeqMatch,
	nextSeqWalkCursor,
	professionalSeqMatches,
	rewindSeqWalkCursor,
	seqWindowJobKey,
} from '#src/jobs/seq-walk-cursor'

describe('seq window claim math', () => {
	test('advances the cursor by the batch so a sibling can claim the next start', () => {
		expect(claimAdvance(7561931158, 100)).toBe(7561931258)
		expect(seqWindowJobKey(7561931158)).toBe('seq_window:7561931158')
	})

	test('success keeps the higher of the claimed cursor and the window high-water', () => {
		expect(nextSeqWalkCursor(200, 199)).toBe(200)
		expect(nextSeqWalkCursor(200, 250)).toBe(250)
	})

	test('empty window rewinds from the claimed start, not below 1', () => {
		expect(rewindSeqWalkCursor(7561931158, 2000)).toBe(7561929158)
		expect(rewindSeqWalkCursor(500, 2000)).toBe(1)
	})
})

describe('seq window response helpers', () => {
	test('keeps only league_id > 0 and tracks the global high-water', () => {
		const matches = [
			{
				match_id: 1,
				match_seq_num: 100,
				leagueid: 0,
				start_time: 1_700_000_000,
			},
			{
				match_id: 2,
				match_seq_num: 140,
				league_id: 17765,
				start_time: 1_700_000_100,
			},
			{
				match_id: 3,
				match_seq_num: 180,
				leagueid: 0,
				start_time: 1_700_000_300,
			},
		]
		expect(
			matches
				.filter((row) => isProfessionalSeqMatch(row))
				.map((row) => row.match_id),
		).toEqual([2])
		expect(professionalSeqMatches(matches).map((row) => row.match_id)).toEqual([
			2,
		])
		expect(highestSeqNum(matches)).toBe(180)
		expect(highestStartTime(matches)).toBe(1_700_000_300)
	})

	test('formats the write-only clock as sortable UTC text', () => {
		expect(formatSeqWalkStartTime(1_700_000_000)).toBe(
			'2023-11-14 22:13:20 UTC',
		)
		expect(formatSeqWalkStartTime(0)).toBe('')
		expect(formatSeqWalkStartTime(Number.NaN)).toBe('')
	})
})
