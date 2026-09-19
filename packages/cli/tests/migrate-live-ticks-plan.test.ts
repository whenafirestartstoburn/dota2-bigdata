import { describe, expect, test } from 'bun:test'
import { decideRangeAction, planIdRanges } from '#src/migrate-live-ticks-plan'

describe('planIdRanges', () => {
	test('splits a contiguous id span into half-open batches', () => {
		expect(planIdRanges({ minId: 1, maxId: 10, count: 10 }, 4)).toEqual([
			{ lo: 1, hi: 5 },
			{ lo: 5, hi: 9 },
			{ lo: 9, hi: 11 },
		])
	})

	test('returns nothing when the table is empty', () => {
		expect(planIdRanges({ minId: 0, maxId: 0, count: 0 }, 100)).toEqual([])
	})
})

describe('decideRangeAction', () => {
	test('skips an empty Postgres range', () => {
		expect(decideRangeAction(0, 0)).toEqual({ action: 'skip' })
		expect(decideRangeAction(0, 12)).toEqual({ action: 'skip' })
	})

	test('deletes leftover Postgres rows after a completed ClickHouse insert', () => {
		expect(decideRangeAction(50, 50)).toEqual({ action: 'delete_only' })
	})

	test('inserts first when ClickHouse does not have the range yet', () => {
		expect(decideRangeAction(50, 0)).toEqual({
			action: 'insert_then_delete',
		})
	})
})
