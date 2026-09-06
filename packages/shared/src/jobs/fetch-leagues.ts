import { pickApiCredential, steamCtx } from '#src/components/resources'
import { deriveLeagueStatus } from '#src/steam/league-status'
import {
	getLeagueInfoList,
	getLiveLeagueGames,
	getTopLiveGames,
} from '#src/steam/web-api'
import { errorMessage } from '#src/store/coerce'
import { upsertLeagues } from '#src/store/leagues'
import { logger } from '#src/utils/logger'

export async function runFetchLeagues(): Promise<{ count: number }> {
	const cred = await pickApiCredential()
	const ctx = steamCtx(cred, 'live')

	let live: Awaited<ReturnType<typeof getLiveLeagueGames>>
	try {
		live = await getLiveLeagueGames(ctx)
	} catch (error) {
		logger.warn(
			{ err: errorMessage(error) },
			'live games unavailable while deriving league status',
		)
		live = { games: [], raw: [] }
	}
	const liveIds = new Set(
		live.games.map((game) => game.league_id).filter((id) => id > 0),
	)
	try {
		const top = await getTopLiveGames(ctx)
		for (const game of top.games) {
			if (game.league_id > 0) liveIds.add(game.league_id)
		}
	} catch (error) {
		logger.warn(
			{ err: errorMessage(error) },
			'top live games unavailable while deriving league status',
		)
	}

	const infos = await getLeagueInfoList(ctx)
	const now = Math.floor(Date.now() / 1000)
	await upsertLeagues(infos, (info) =>
		deriveLeagueStatus(
			{
				league_id: info.league_id,
				start_timestamp: info.start_timestamp,
				end_timestamp: info.end_timestamp,
				most_recent_activity: info.most_recent_activity,
				valve_status: info.status,
			},
			now,
			liveIds,
		),
	)

	logger.info(
		{ count: infos.length, liveLeagues: liveIds.size },
		'upserted leagues',
	)
	return { count: infos.length }
}
