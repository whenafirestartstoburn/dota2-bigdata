/** Newest-first GetMatchHistory page vs waiting live-finished match ids. */
export function historyWaiterPagePlan(input: {
	waiting: ReadonlySet<number>
	pageMatchIds: readonly number[]
	resultsRemaining: number
}): {
	foundIds: number[]
	missedIds: number[]
	continueAtMatchId: number | null
} {
	const foundIds = input.pageMatchIds.filter((id) => input.waiting.has(id))
	const found = new Set(foundIds)
	const remaining = [...input.waiting].filter((id) => !found.has(id))
	if (remaining.length === 0) {
		return { foundIds, missedIds: [], continueAtMatchId: null }
	}

	const newest = input.pageMatchIds[0]
	const oldest = input.pageMatchIds.at(-1)
	if (newest == null || oldest == null) {
		return { foundIds, missedIds: remaining, continueAtMatchId: null }
	}

	const missedIds: number[] = []
	const older: number[] = []
	for (const id of remaining) {
		if (id > newest) {
			missedIds.push(id)
			continue
		}
		if (id >= oldest) {
			missedIds.push(id)
			continue
		}
		older.push(id)
	}
	if (older.length === 0) {
		return { foundIds, missedIds, continueAtMatchId: null }
	}
	if (input.resultsRemaining <= 0) {
		return {
			foundIds,
			missedIds: [...missedIds, ...older],
			continueAtMatchId: null,
		}
	}
	return { foundIds, missedIds, continueAtMatchId: oldest }
}
