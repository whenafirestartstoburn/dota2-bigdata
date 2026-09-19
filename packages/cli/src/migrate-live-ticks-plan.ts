export type TickTable = 'live_match_ticks' | 'live_player_ticks'

export type IdBounds = {
	minId: number
	maxId: number
	count: number
}

export type IdRange = {
	lo: number
	hi: number
}

export type RangeDecision =
	| { action: 'skip' }
	| { action: 'delete_only' }
	| { action: 'insert_then_delete' }

/** Half-open `[minId, maxId + 1)` split into `batch`-sized ranges. */
export function planIdRanges(bounds: IdBounds, batch: number): IdRange[] {
	if (bounds.count <= 0 || batch <= 0) return []
	const ranges: IdRange[] = []
	let lo = bounds.minId
	const end = bounds.maxId + 1
	while (lo < end) {
		const hi = lo + batch
		ranges.push({ lo, hi: hi < end ? hi : end })
		lo = hi
	}
	return ranges
}

/**
 * Restart-safe step for one id range.
 * PG is the queue: after a successful CH insert the range is deleted.
 * If CH already has rows (insert ok, delete failed), only delete PG.
 */
export function decideRangeAction(
	pgCount: number,
	chCount: number,
): RangeDecision {
	if (pgCount <= 0) return { action: 'skip' }
	if (chCount > 0) return { action: 'delete_only' }
	return { action: 'insert_then_delete' }
}
