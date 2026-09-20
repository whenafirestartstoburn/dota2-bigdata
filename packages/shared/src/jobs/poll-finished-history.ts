import { pickApiCredential, steamCtx } from '#src/components/resources'
import { getAppSettings } from '#src/components/settings'
import { enqueueFetchMatchDetails } from '#src/jobs/fetch-match-details'
import { enqueueFetchSeqDetails } from '#src/jobs/fetch-seq-details'
import { historyWaiterPagePlan } from '#src/steam/history-page'
import type { HistoryMatch } from '#src/steam/schemas'
import { getMatchHistoryPage } from '#src/steam/web-api'
import { asNumber } from '#src/store/coerce'
import { partialPlayerFacts } from '#src/store/match-details'
import {
	fillMatchPlayerLinks,
	listAwaitingHistoryMatchIds,
	listDueHistoryLeagueIds,
	markHistoryAvailable,
	recordHistoryPollMisses,
	upsertMatchPlayers,
	upsertPlayer,
	upsertSeriesForMatch,
	upsertTeam,
} from '#src/store/matches'
import { db } from '#src/utils/db'
import { logger } from '#src/utils/logger'

export async function runPollFinishedHistory(): Promise<{
	leagues: number
	hits: number
	misses: number
	pages: number
}> {
	const settings = await getAppSettings()
	// Armed by live finish (`history_next_poll_at`); not gated on match status,
	// so GC / replay advancing the row still gets a seqnum + seq details.
	const leagueIds = await listDueHistoryLeagueIds()
	if (leagueIds.length === 0) {
		return { leagues: 0, hits: 0, misses: 0, pages: 0 }
	}

	const cred = await pickApiCredential()
	const ctx = steamCtx(cred, 'live')
	let hits = 0
	let misses = 0
	let pages = 0

	for (const leagueId of leagueIds) {
		const waiting = await listAwaitingHistoryMatchIds(leagueId)
		if (waiting.length === 0) continue
		const { found, missed, pageCount } = await crawlWaitingHistory(
			ctx,
			leagueId,
			waiting,
		)
		pages += pageCount

		await db.transaction(async (tx) => {
			for (const match of found) {
				await upsertTeam(tx, match.radiant_team_id, undefined)
				await upsertTeam(tx, match.dire_team_id, undefined)
				const seriesId = await upsertSeriesForMatch(tx, {
					valveSeriesId: match.series_id ?? null,
					leagueId,
					radiantTeamId: match.radiant_team_id || null,
					direTeamId: match.dire_team_id || null,
					seriesType: match.series_type ?? null,
					radiantWins: null,
					direWins: null,
					matchId: match.match_id,
					startTime: match.start_time,
				})
				await markHistoryAvailable(tx, {
					matchId: match.match_id,
					leagueId,
					matchSeqNum: match.match_seq_num,
					startTime: match.start_time,
					lobbyType: match.lobby_type,
					seriesId: seriesId != null && seriesId > 0 ? seriesId : null,
					seriesType: match.series_type ?? null,
					radiantTeamId: match.radiant_team_id || null,
					direTeamId: match.dire_team_id || null,
				})
				const players = match.players.flatMap((item, index) => {
					if (typeof item !== 'object' || item === null) return []
					const row = item as Record<string, unknown>
					const accountId = asNumber(row.account_id)
					if (accountId === null) return []
					const slot = asNumber(row.player_slot) ?? index
					return [
						partialPlayerFacts({
							accountId,
							playerSlot: slot,
							heroId: asNumber(row.hero_id) ?? 0,
							teamNumber: asNumber(row.team_number),
							teamSlot: asNumber(row.team_slot),
							side: slot < 128 ? 'radiant' : 'dire',
						}),
					]
				})
				for (const player of players) {
					await upsertPlayer(tx, {
						accountId: player.accountId,
						isPro: true,
						teamId:
							player.side === 'radiant'
								? match.radiant_team_id || null
								: match.dire_team_id || null,
						matchId: match.match_id,
					})
				}
				await upsertMatchPlayers(tx, match.match_id, players, {
					fillOnly: true,
				})
				await fillMatchPlayerLinks(tx, match.match_id)
			}
			await recordHistoryPollMisses(tx, missed, {
				fastLimit: settings.historyFastPollLimit,
				slowLimit: settings.historySlowPollLimit,
				fastMs: settings.historyFastPollMs,
				slowMs: settings.historySlowPollMs,
			})
		})

		for (const match of found) {
			await enqueueFetchSeqDetails(match.match_id, 'live')
			await enqueueFetchMatchDetails(match.match_id, 'live')
		}
		hits += found.length
		misses += missed.length
	}

	logger.info(
		{ leagues: leagueIds.length, hits, misses, pages },
		'finished history poll',
	)
	return { leagues: leagueIds.length, hits, misses, pages }
}

async function crawlWaitingHistory(
	ctx: ReturnType<typeof steamCtx>,
	leagueId: number,
	waiting: readonly number[],
): Promise<{
	found: HistoryMatch[]
	missed: number[]
	pageCount: number
}> {
	const remaining = new Set(waiting)
	const listed = new Map<number, HistoryMatch>()
	const missed = new Set<number>()
	let startAtMatchId: number | undefined
	let pageCount = 0

	while (remaining.size > 0) {
		const page = await getMatchHistoryPage(ctx, { leagueId, startAtMatchId })
		pageCount += 1
		for (const match of page.matches) {
			if (remaining.has(match.match_id)) listed.set(match.match_id, match)
		}
		const plan = historyWaiterPagePlan({
			waiting: remaining,
			pageMatchIds: page.matches.map((match) => match.match_id),
			resultsRemaining: page.resultsRemaining,
		})
		for (const id of plan.foundIds) remaining.delete(id)
		for (const id of plan.missedIds) {
			missed.add(id)
			remaining.delete(id)
		}
		if (
			plan.continueAtMatchId == null ||
			plan.continueAtMatchId === startAtMatchId
		) {
			break
		}
		startAtMatchId = plan.continueAtMatchId
	}

	for (const id of remaining) missed.add(id)
	return {
		found: [...listed.values()],
		missed: [...missed],
		pageCount,
	}
}
