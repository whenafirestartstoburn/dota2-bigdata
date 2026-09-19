import { bumpGlobalMatchSeq } from '#src/components/rate-limit'
import { pickApiCredential, steamCtx } from '#src/components/resources'
import { getAppSettings } from '#src/components/settings'
import {
	enqueueFetchMatchDetails,
	matchOrigin,
} from '#src/jobs/fetch-match-details'
import {
	bumpSeqWalkCursor,
	formatSeqWalkStartTime,
	highestSeqNum,
	highestStartTime,
	professionalSeqMatches,
	rewindSeqWalkCursor,
	SEQ_WALK_CAUGHT_UP_MS,
	setSeqWalkCooldown,
	setSeqWalkCursor,
	writeSeqWalkStartTime,
} from '#src/jobs/seq-walk-cursor'
import { enqueueSeqWalkWindows } from '#src/jobs/walk-seq-history'
import { observeSeqWalk } from '#src/metrics/observe'
import { getMatchHistoryBySequenceNum } from '#src/steam/web-api'
import { asNumber } from '#src/store/coerce'
import { markSeqFetched } from '#src/store/matches'
import { persistMatchRecord } from '#src/store/persist-match'
import { db, sql, sqlIn } from '#src/utils/db'
import { logger } from '#src/utils/logger'

export async function runFetchSeqWindow(input: { startAt: number }): Promise<{
	saved: number
	empty: boolean
}> {
	const settings = await getAppSettings()
	const cred = await pickApiCredential()
	const ctx = {
		...steamCtx(cred, 'historical'),
		logResponseBody: false,
	}
	const window = await getMatchHistoryBySequenceNum(ctx, {
		startAtMatchSeqNum: input.startAt,
		matchesRequested: settings.seqBatchSize,
	})

	if (window.matches.length === 0) {
		await setSeqWalkCursor(rewindSeqWalkCursor(input.startAt))
		await setSeqWalkCooldown(SEQ_WALK_CAUGHT_UP_MS)
		observeSeqWalk({ saved: 0, result: 'empty' })
		logger.info(
			{ startAt: input.startAt, rewindTo: rewindSeqWalkCursor(input.startAt) },
			'seq window empty; rewound cursor',
		)
		return { saved: 0, empty: true }
	}

	const highestSeq = highestSeqNum(window.matches)
	const highestStart = highestStartTime(window.matches)
	const pro = professionalSeqMatches(window.matches)

	await db.transaction(async (tx) => {
		for (const match of pro) {
			await persistMatchRecord(tx, match, {
				mustExist: false,
				skipStoryObjectives: true,
				fetched: 'seq',
			})
			await markSeqFetched(tx, [match.match_id])
		}
		if (highestSeq != null) {
			await bumpSeqWalkCursor(highestSeq, tx)
		}
		if (highestStart != null) {
			await writeSeqWalkStartTime(formatSeqWalkStartTime(highestStart), tx)
		}
	})

	if (highestSeq != null) await bumpGlobalMatchSeq(highestSeq)

	const savedIds = pro.map((match) => match.match_id)
	if (savedIds.length > 0) {
		const pending = await db.execute(sql`
			SELECT match_id, source
			FROM matches
			WHERE match_id IN ${sqlIn(savedIds)}
				AND details_fetched_at IS NULL
		`)
		for (const row of pending) {
			const matchId = asNumber(row.match_id)
			if (matchId == null) continue
			await enqueueFetchMatchDetails(matchId, matchOrigin(row.source))
		}
	}

	observeSeqWalk({ saved: savedIds.length, result: 'hits' })
	logger.info(
		{
			startAt: input.startAt,
			returned: window.matches.length,
			saved: savedIds.length,
			highestSeq,
		},
		'seq window persisted',
	)
	await enqueueSeqWalkWindows()
	return { saved: savedIds.length, empty: false }
}
