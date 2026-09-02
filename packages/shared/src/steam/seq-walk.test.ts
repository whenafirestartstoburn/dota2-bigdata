import { describe, expect, test } from 'bun:test'
import { applySeqWindow } from './seq-walk'

describe('applySeqWindow', () => {
	test('saves matches present in the window and keeps later ones', () => {
		const remaining = [
			{ match_id: 1, match_seq_num: 100 },
			{ match_id: 2, match_seq_num: 150 },
			{ match_id: 3, match_seq_num: 400 },
		]
		const { actions, next } = applySeqWindow(
			remaining,
			{
				returned: [
					{ match_id: 1, match_seq_num: 100 },
					{ match_id: 99, match_seq_num: 140 },
					{ match_id: 2, match_seq_num: 150 },
				],
			},
			100,
		)
		expect(
			actions.filter((a) => a.kind === 'save').map((a) => a.match_id),
		).toEqual([1, 2])
		expect(next).toEqual([{ match_id: 3, match_seq_num: 400 }])
	})

	test('marks in-window misses as unavailable', () => {
		const { actions, next } = applySeqWindow(
			[
				{ match_id: 1, match_seq_num: 100 },
				{ match_id: 2, match_seq_num: 110 },
			],
			{
				returned: [
					{ match_id: 1, match_seq_num: 100 },
					{ match_id: 9, match_seq_num: 120 },
				],
			},
			100,
		)
		expect(actions).toContainEqual({
			kind: 'unavailable',
			match_id: 2,
			reason: 'seq 110 inside window (100..120) but not returned',
		})
		expect(next).toEqual([])
	})

	test('empty window skips the head so the cursor can move', () => {
		const { actions, next } = applySeqWindow(
			[
				{ match_id: 1, match_seq_num: 100 },
				{ match_id: 2, match_seq_num: 200 },
			],
			{ returned: [] },
			100,
		)
		expect(actions[0]).toMatchObject({ kind: 'unavailable', match_id: 1 })
		expect(next).toEqual([{ match_id: 2, match_seq_num: 200 }])
	})

	test('marks the head unavailable when the window does not advance', () => {
		const { actions, next } = applySeqWindow(
			[
				{ match_id: 1, match_seq_num: 100 },
				{ match_id: 2, match_seq_num: 500 },
			],
			{
				returned: [{ match_id: 99, match_seq_num: 50 }],
			},
			100,
		)
		expect(actions).toContainEqual({
			kind: 'unavailable',
			match_id: 1,
			reason: 'seq cursor did not advance from 100 (batch 100)',
		})
		expect(next).toEqual([{ match_id: 2, match_seq_num: 500 }])
	})
})
