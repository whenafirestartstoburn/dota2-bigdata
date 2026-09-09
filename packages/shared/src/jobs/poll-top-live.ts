import { setCursor } from '#src/components/rate-limit'
import { pickApiCredential, steamCtx } from '#src/components/resources'
import { getAppSettings } from '#src/components/settings'
import { getTopLiveGames } from '#src/steam/web-api'
import { asPgInt8, asSteamId64 } from '#src/store/coerce'
import { ensureLeagueStub } from '#src/store/leagues'
import { INGEST } from '#src/store/match-phase'
import {
	finishMissingLiveMatches,
	noteLiveFeedMisses,
	touchMatchLive,
} from '#src/store/matches'
import { db } from '#src/utils/db'
import { logger } from '#src/utils/logger'

export function proTopLiveMatchId(game: {
	match_id: unknown
	league_id: number
}): number | null {
	const matchId = asPgInt8(game.match_id)
	if (matchId == null || matchId <= 0 || game.league_id <= 0) return null
	return matchId
}

export async function runPollTopLive(): Promise<{
	games: number
	finished: number
}> {
	const settings = await getAppSettings()
	const cred = await pickApiCredential()
	const ctx = steamCtx(cred, 'live')
	const { games } = await getTopLiveGames(ctx)

	await setCursor(
		'next_top_live_poll_at',
		new Date(Date.now() + settings.livePollIntervalMs).toISOString(),
	)

	const seen: number[] = []
	let finished: number[] = []

	await db.transaction(async (tx) => {
		for (const game of games) {
			const matchId = proTopLiveMatchId(game)
			const leagueId = game.league_id
			if (matchId == null) continue
			seen.push(matchId)
			await ensureLeagueStub(leagueId, tx)
			await touchMatchLive(tx, {
				matchId,
				leagueId,
				leagueNodeId: null,
				seriesId: null,
				seriesType: null,
				radiantSeriesWins: null,
				direSeriesWins: null,
				streamDelayS: game.delay,
				radiantTeamId: null,
				direTeamId: null,
				radiantTeamName: null,
				direTeamName: null,
				ingest: INGEST.topLive,
				serverSteamId: asSteamId64(game.server_steam_id),
			})
		}
		if (seen.length > 0 || games.length > 0) {
			if (games.length > 0) {
				await noteLiveFeedMisses(tx, INGEST.topLive, seen)
				finished = await finishMissingLiveMatches(
					tx,
					settings.liveMissingThreshold,
					settings.replayLiveDelayMs,
				)
			}
		}
	})

	logger.info(
		{ games: games.length, wrote: seen.length, finished: finished.length },
		'top live poll',
	)
	return { games: games.length, finished: finished.length }
}
