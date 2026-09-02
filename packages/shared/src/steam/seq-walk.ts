export type SeqRef = {
	match_id: number
	match_seq_num: number
}

export type SeqWindow = {
	returned: ReadonlyArray<{ match_id: number; match_seq_num: number }>
}

export type SeqWalkDecision =
	| { kind: 'save'; match_id: number }
	| { kind: 'unavailable'; match_id: number; reason: string }
	| { kind: 'retry'; remaining: SeqRef[] }

// GetMatchHistoryBySequenceNum returns up to `batchSize` *global* matches
// starting at a seq number, not "N league matches". After each response we
// decide which of our targets landed in the window, which were skipped by
// Valve, and where the next request must start.
export function applySeqWindow(
	remaining: readonly SeqRef[],
	window: SeqWindow,
	batchSize: number,
): {
	actions: Array<Exclude<SeqWalkDecision, { kind: 'retry' }>>
	next: SeqRef[]
} {
	const [head, ...tail] = remaining
	if (head === undefined) {
		return { actions: [], next: [] }
	}

	if (window.returned.length === 0) {
		return {
			actions: [
				{
					kind: 'unavailable',
					match_id: head.match_id,
					reason: `empty seq window at ${head.match_seq_num}`,
				},
			],
			next: tail,
		}
	}

	const got = new Map(
		window.returned.map((row) => [row.match_id, row.match_seq_num]),
	)
	const maxSeq = Math.max(...window.returned.map((row) => row.match_seq_num))

	const actions: Array<Exclude<SeqWalkDecision, { kind: 'retry' }>> = []
	const next: SeqRef[] = []

	for (const match of remaining) {
		if (got.has(match.match_id)) {
			actions.push({ kind: 'save', match_id: match.match_id })
			continue
		}
		if (match.match_seq_num <= maxSeq) {
			actions.push({
				kind: 'unavailable',
				match_id: match.match_id,
				reason: `seq ${match.match_seq_num} inside window (${head.match_seq_num}..${maxSeq}) but not returned`,
			})
			continue
		}
		next.push(match)
	}

	if (
		next.length > 0 &&
		next[0]!.match_seq_num === head.match_seq_num &&
		!got.has(head.match_id)
	) {
		// Window did not advance — avoid an infinite loop on a stuck cursor.
		actions.push({
			kind: 'unavailable',
			match_id: head.match_id,
			reason: `seq cursor did not advance from ${head.match_seq_num} (batch ${batchSize})`,
		})
		return { actions, next: next.slice(1) }
	}

	return { actions, next }
}
