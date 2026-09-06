import {
	countJobs,
	detailsQueue,
	enqueueJob,
	PRIORITY,
	replayQueue,
} from '#src/components/jobs'
import { bumpGlobalMatchSeq } from '#src/components/rate-limit'
import { getAppSettings } from '#src/components/settings'
import type { SteamRequestContext } from '#src/steam/web-api'
import { getMatchHistoryBySequenceNum } from '#src/steam/web-api'
import { asNumber } from '#src/store/coerce'
import { listKnownLeagueIds, markSeqFetched } from '#src/store/matches'
import { persistMatchRecord } from '#src/store/persist-match'
import { copyReplayLocatorFromMatch, ensureReplayRow } from '#src/store/replays'
import { db } from '#src/utils/db'

export function matchOrigin(source: unknown): 'live' | 'historical' {
	return source === 'live' ? 'live' : 'historical'
}

export async function persistSeqMatches(
	ctx: SteamRequestContext,
	startAtMatchSeqNum: number,
): Promise<{ saved: number }> {
	const settings = await getAppSettings()
	const window = await getMatchHistoryBySequenceNum(ctx, {
		startAtMatchSeqNum,
		matchesRequested: settings.seqBatchSize,
	})
	const knownLeagues = await listKnownLeagueIds()
	const savedIds: number[] = []
	for (const match of window.matches) {
		const leagueId = asNumber(match.leagueid) ?? asNumber(match.league_id) ?? 0
		if (leagueId <= 0 || !knownLeagues.has(leagueId)) continue
		await db.transaction(async (tx) => {
			await persistMatchRecord(tx, match, {
				apiKeyId: ctx.keyId,
				mustExist: false,
				fetched: 'seq',
			})
			await markSeqFetched(tx, [match.match_id])
		})
		savedIds.push(match.match_id)
		if (typeof match.match_seq_num === 'number') {
			await bumpGlobalMatchSeq(match.match_seq_num)
		}
	}
	return { saved: savedIds.length }
}

export async function enqueueFetchMatchDetails(
	matchId: number,
	origin: 'live' | 'historical',
	runAt?: Date,
): Promise<void> {
	await enqueueJob({
		identifier: 'fetch_match_details',
		payload: { match_id: matchId, origin },
		queueName: detailsQueue(matchId),
		priority:
			origin === 'live' ? PRIORITY.detailsLive : PRIORITY.detailsHistorical,
		runAt,
		jobKey: `details:${matchId}`,
		jobKeyMode: runAt != null ? 'preserve_run_at' : 'replace',
		maxAttempts: 5,
	})
}

export async function enqueueDownloadReplay(
	matchId: number,
	origin: 'live' | 'historical',
	runAt?: Date,
	opts?: { jobKeyMode?: 'replace' | 'preserve_run_at'; ignoreLimit?: boolean },
): Promise<void> {
	if (origin === 'historical' && opts?.ignoreLimit !== true) {
		const settings = await getAppSettings()
		const inflight = await countJobs(
			'download_replay',
			PRIORITY.replayHistorical,
		)
		if (inflight >= settings.historyReplayEnqueueLimit) return
	}
	await ensureReplayRow(matchId, origin)
	await copyReplayLocatorFromMatch(matchId)
	const live = origin === 'live'
	await enqueueJob({
		identifier: 'download_replay',
		payload: { match_id: matchId },
		queueName: replayQueue(matchId, origin),
		priority: live ? PRIORITY.replayLive : PRIORITY.replayHistorical,
		runAt,
		jobKey: `replay:${matchId}`,
		jobKeyMode: opts?.jobKeyMode ?? 'preserve_run_at',
	})
}
