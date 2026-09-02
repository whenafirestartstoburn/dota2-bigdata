import { jobNumber, readJobPayload } from '@app/shared/src/components/jobs'
import { runFetchLeagues } from '@app/shared/src/jobs/fetch-leagues'
import { matchOrigin } from '@app/shared/src/jobs/fetch-match-details'
import { runPollLiveGames } from '@app/shared/src/jobs/poll-live'
import { runWalkLeagueHistory } from '@app/shared/src/jobs/walk-league-history'
import env from '@app/shared/src/utils/env'
import type { JobHelpers, TaskList } from 'graphile-worker'
import { runDownloadReplay } from '#src/jobs/download-replay'
import { runFetchMatchDetails } from '#src/jobs/fetch-match-details'
import { runParseReplay } from '#src/jobs/parse-replay'

async function rescheduleLive(helpers: JobHelpers): Promise<void> {
	await helpers.addJob(
		'poll_live_games',
		{},
		{
			runAt: new Date(Date.now() + env.LIVE_POLL_INTERVAL_MS),
			jobKey: 'poll_live_games',
			jobKeyMode: 'replace',
		},
	)
}

function matchIdOf(payload: unknown): number {
	const id = jobNumber(payload, 'match_id') ?? jobNumber(payload, 'matchId')
	if (id === undefined) {
		throw new Error('payload requires match_id')
	}
	return id
}

export const taskList = {
	fetch_leagues: async () => {
		await runFetchLeagues()
	},
	poll_live_games: async (_payload, helpers) => {
		try {
			await runPollLiveGames()
		} finally {
			await rescheduleLive(helpers)
		}
	},
	walk_league_history: async (payload) => {
		const body = readJobPayload(payload)
		await runWalkLeagueHistory({
			leagueId: jobNumber(payload, 'league_id'),
			matchesLimit: jobNumber(payload, 'matches_limit') ?? null,
			reset: body.reset === true,
		})
	},
	fetch_match_details: async (payload) => {
		const matchId = jobNumber(payload, 'match_id')
		if (matchId === undefined) {
			throw new Error('fetch_match_details payload requires match_id')
		}
		const origin = readJobPayload(payload).origin
		await runFetchMatchDetails({
			matchId,
			origin: matchOrigin(origin),
		})
	},
	process_league: async (payload) => {
		const leagueId = jobNumber(payload, 'league_id')
		if (leagueId === undefined) {
			throw new Error('process_league payload requires league_id')
		}
		await runWalkLeagueHistory({
			leagueId,
			matchesLimit: jobNumber(payload, 'matches_limit') ?? null,
			reset: true,
		})
	},
	download_replay: async (payload) => {
		await runDownloadReplay(matchIdOf(payload))
	},
	parse_replay: async (payload) => {
		await runParseReplay(matchIdOf(payload))
	},
} satisfies TaskList
