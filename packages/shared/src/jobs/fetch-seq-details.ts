import { enqueueJob, PRIORITY, seqQueue } from '#src/components/jobs'
import { pickApiCredential, steamCtx } from '#src/components/resources'
import { matchOrigin } from '#src/jobs/fetch-match-details'
import { applySeqWindow } from '#src/steam/seq-walk'
import { getMatchHistoryBySequenceNum } from '#src/steam/web-api'
import { asDate, asNumber } from '#src/store/coerce'
import {
	getMatch,
	markSeqFetched,
	stampMatchSeqAttempt,
} from '#src/store/matches'
import { persistMatchRecord } from '#src/store/persist-match'
import { db } from '#src/utils/db'
import { logger } from '#src/utils/logger'

export async function enqueueFetchSeqDetails(
	matchId: number,
	origin: 'live' | 'historical',
	runAt?: Date,
): Promise<void> {
	await stampMatchSeqAttempt(matchId, {
		nextAttemptAt: runAt ?? new Date(),
		bump: runAt != null,
	})
	await enqueueJob({
		identifier: 'fetch_seq_details',
		payload: { match_id: matchId, origin },
		queueName: seqQueue(matchId),
		priority:
			origin === 'live' ? PRIORITY.detailsLive : PRIORITY.detailsHistorical,
		runAt,
		jobKey: `seq:${matchId}`,
		jobKeyMode: runAt != null ? 'preserve_run_at' : 'replace',
		maxAttempts: 5,
	})
}

export async function runFetchSeqDetails(input: {
	matchId: number
	origin?: 'live' | 'historical'
}): Promise<{ saved: number }> {
	const match = await getMatch(input.matchId)
	if (match == null) return { saved: 0 }
	if (asDate(match.seq_fetched_at) != null) return { saved: 0 }
	const seq = asNumber(match.match_seq_num)
	if (seq == null || seq <= 0) {
		throw new Error(`seq details missing match_seq_num for ${input.matchId}`)
	}

	const origin = input.origin ?? matchOrigin(match.source)
	const cred = await pickApiCredential()
	const ctx = {
		...steamCtx(cred, origin),
		matchId: input.matchId,
	}
	const window = await getMatchHistoryBySequenceNum(ctx, {
		startAtMatchSeqNum: seq,
		matchesRequested: 1,
	})
	if (window.matches.length === 0) {
		throw new Error(`empty seq window at ${seq} for match ${input.matchId}`)
	}

	const { actions } = applySeqWindow(
		[{ match_id: input.matchId, match_seq_num: seq }],
		{ returned: window.matches },
		1,
	)
	const action = actions[0]
	if (action?.kind === 'unavailable') {
		logger.warn(
			{ matchId: input.matchId, seq, reason: action.reason },
			'seq details skipped by Valve',
		)
		return { saved: 0 }
	}

	const raw = window.matches.find((row) => row.match_id === input.matchId)
	if (raw == null) {
		throw new Error(
			`seq window at ${seq} did not include match ${input.matchId}`,
		)
	}

	await db.transaction(async (tx) => {
		await persistMatchRecord(tx, raw, {
			mustExist: false,
			skipStoryObjectives: true,
			fetched: 'seq',
		})
		await markSeqFetched(tx, [input.matchId])
		await stampMatchSeqAttempt(
			input.matchId,
			{ nextAttemptAt: null, bump: false, clear: true },
			tx,
		)
	})
	logger.info({ matchId: input.matchId, seq }, 'seq match details persisted')
	return { saved: 1 }
}
