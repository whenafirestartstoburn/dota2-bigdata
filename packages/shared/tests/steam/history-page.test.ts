import { describe, expect, test } from 'bun:test'
import { historyWaiterPagePlan } from '#src/steam/history-page'

describe('historyWaiterPagePlan', () => {
	test('stops on the newest page when the waiting id is newer than Valve', () => {
		const plan = historyWaiterPagePlan({
			waiting: new Set([900]),
			pageMatchIds: [850, 840, 830],
			resultsRemaining: 200,
		})
		expect(plan.foundIds).toEqual([])
		expect(plan.missedIds).toEqual([900])
		expect(plan.continueAtMatchId).toBeNull()
	})

	test('pages older when a waiting id is below this page', () => {
		const plan = historyWaiterPagePlan({
			waiting: new Set([100, 850]),
			pageMatchIds: [900, 850, 800],
			resultsRemaining: 50,
		})
		expect(plan.foundIds).toEqual([850])
		expect(plan.missedIds).toEqual([])
		expect(plan.continueAtMatchId).toBe(800)
	})

	test('treats an in-range hole as a miss and stops if nothing older waits', () => {
		const plan = historyWaiterPagePlan({
			waiting: new Set([820]),
			pageMatchIds: [900, 850, 800],
			resultsRemaining: 50,
		})
		expect(plan.foundIds).toEqual([])
		expect(plan.missedIds).toEqual([820])
		expect(plan.continueAtMatchId).toBeNull()
	})

	test('marks leftover older ids missed when the league is exhausted', () => {
		const plan = historyWaiterPagePlan({
			waiting: new Set([10]),
			pageMatchIds: [900, 850, 800],
			resultsRemaining: 0,
		})
		expect(plan.missedIds).toEqual([10])
		expect(plan.continueAtMatchId).toBeNull()
	})
})
