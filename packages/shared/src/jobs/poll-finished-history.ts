import { pickApiCredential, steamCtx } from '#src/components/resources'
import { getAppSettings } from '#src/components/settings'
import { enqueueFetchMatchDetails } from '#src/jobs/fetch-match-details'
import { getMatchHistoryPage } from '#src/steam/web-api'
import { asNumber } from '#src/store/coerce'
import { partialPlayerFacts } from '#src/store/match-details'
import {
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
}> {
	const settings = await getAppSettings()
	const leagueIds = await listDueHistoryLeagueIds()
	if (leagueIds.length === 0) return { leagues: 0, hits: 0, misses: 0 }

	const cred = await pickApiCredential()
	const ctx = steamCtx(cred, 'live')
	let hits = 0
	let misses = 0

	for (const leagueId of leagueIds) {
		const waiting = await listAwaitingHistoryMatchIds(leagueId)
		if (waiting.length === 0) continue
		const waitingSet = new Set(waiting)
		const page = await getMatchHistoryPage(ctx, { leagueId })
		const found = page.matches.filter((row) => waitingSet.has(row.match_id))
		const foundIds = new Set(found.map((row) => row.match_id))
		const missed = waiting.filter((id) => !foundIds.has(id))

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
				await upsertMatchPlayers(tx, match.match_id, players)
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
			}
			await recordHistoryPollMisses(tx, missed, {
				fastLimit: settings.historyFastPollLimit,
				slowLimit: settings.historySlowPollLimit,
				fastMs: settings.historyFastPollMs,
				slowMs: settings.historySlowPollMs,
			})
		})

		for (const match of found) {
			await enqueueFetchMatchDetails(match.match_id, 'live')
		}
		hits += found.length
		misses += missed.length
	}

	logger.info(
		{ leagues: leagueIds.length, hits, misses },
		'finished history poll',
	)
	return { leagues: leagueIds.length, hits, misses }
}
