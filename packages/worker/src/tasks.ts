import {
	jobNumber,
	PRIORITY,
	readJobPayload,
	runScheduledJob,
	SCHEDULED_JOB,
	scheduleQueuedJobRetry,
} from '@app/shared/src/components/jobs'
import { getAppSettings } from '@app/shared/src/components/settings'
import { runFetchLeagues } from '@app/shared/src/jobs/fetch-leagues'
import {
	enqueueFetchMatchDetails,
	matchOrigin,
} from '@app/shared/src/jobs/fetch-match-details'
import { runPollFinishedHistory } from '@app/shared/src/jobs/poll-finished-history'
import { runPollLiveGames } from '@app/shared/src/jobs/poll-live'
import { runPollRealtimeStats } from '@app/shared/src/jobs/poll-realtime-stats'
import { runPollTopLive } from '@app/shared/src/jobs/poll-top-live'
import { runReplenishAccounts } from '@app/shared/src/jobs/replenish-accounts'
import { runRetestDisabledResources } from '@app/shared/src/jobs/retest-resources'
import { runSyncCatalogs } from '@app/shared/src/jobs/sync-catalogs'
import { runWalkLeagueHistory } from '@app/shared/src/jobs/walk-league-history'
import { jobsInProgress, observeJob } from '@app/shared/src/metrics/observe'
import { asString, errorMessage } from '@app/shared/src/store/coerce'
import { logger } from '@app/shared/src/utils/logger'
import { runWithTrace } from '@app/shared/src/utils/trace'
import type { JobHelpers, Task, TaskList } from 'graphile-worker'
import { runDownloadReplay } from '#src/jobs/download-replay'
import { runFetchMatchDetails } from '#src/jobs/fetch-match-details'

function traced(name: string, fn: Task, opts?: { skipNoKey?: boolean }): Task {
	return async (payload, helpers) => {
		const matchId =
			jobNumber(payload, 'match_id') ?? jobNumber(payload, 'matchId')
		await runWithTrace(
			{
				trace_id: helpers.job.id,
				job: name,
				job_id: helpers.job.id,
				...(matchId != null ? { match_id: matchId } : {}),
			},
			async () => {
				const started = performance.now()
				jobsInProgress.inc({ job: name })
				try {
					await fn(payload, helpers)
					observeJob(name, 'success', started)
				} catch (error) {
					if (
						opts?.skipNoKey === true &&
						/no ready Steam API key/i.test(errorMessage(error))
					) {
						observeJob(name, 'skipped', started)
						logger.warn({ err: errorMessage(error) }, `${name} skipped`)
						return
					}
					observeJob(name, 'error', started)
					const queueName =
						asString(readJobPayload(payload)._queueName) ??
						(await helpers.getQueueName())
					if (queueName != null && queueName !== '') {
						const retried = await scheduleQueuedJobRetry({
							identifier: name,
							payload,
							queueName,
							jobKey: helpers.job.key,
							priority: helpers.job.priority,
							failedTry: Math.max(helpers.job.attempts, 1),
						})
						if (retried) {
							logger.warn(
								{ err: errorMessage(error), queue: queueName },
								`${name} scheduled for retry off-queue`,
							)
							return
						}
						logger.error(
							{ err: errorMessage(error), queue: queueName },
							`${name} gave up; leaving the named queue`,
						)
						return
					}
					throw error
				} finally {
					jobsInProgress.dec({ job: name })
				}
			},
		)
	}
}

async function rescheduleLive(
	helpers: JobHelpers,
	identifier: 'poll_live_games' | 'poll_top_live' | 'poll_realtime_stats',
): Promise<void> {
	const settings = await getAppSettings()
	await helpers.addJob(
		identifier,
		{},
		{
			runAt: new Date(Date.now() + settings.livePollIntervalMs),
			jobKey: identifier,
			jobKeyMode: 'replace',
			maxAttempts: 1,
		},
	)
}

async function rescheduleFinishedHistory(helpers: JobHelpers): Promise<void> {
	const settings = await getAppSettings()
	await helpers.addJob(
		'poll_finished_history',
		{},
		{
			runAt: new Date(Date.now() + settings.historyFastPollMs),
			jobKey: 'poll_finished_history',
			jobKeyMode: 'replace',
			maxAttempts: 1,
		},
	)
}

async function rescheduleReplenish(helpers: JobHelpers): Promise<void> {
	const settings = await getAppSettings()
	await helpers.addJob(
		'replenish_accounts',
		{},
		{
			runAt: new Date(Date.now() + settings.replenishIntervalMs),
			jobKey: 'replenish_accounts',
			jobKeyMode: 'replace',
			priority: PRIORITY.replenish,
			maxAttempts: 1,
		},
	)
}

async function rescheduleRetest(helpers: JobHelpers): Promise<void> {
	const settings = await getAppSettings()
	await helpers.addJob(
		'retest_disabled_resources',
		{},
		{
			runAt: new Date(Date.now() + settings.retestIntervalMs),
			jobKey: 'retest_disabled_resources',
			jobKeyMode: 'replace',
			priority: PRIORITY.retest,
			maxAttempts: 1,
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

export const allTasks = {
	fetch_leagues: traced(
		'fetch_leagues',
		async () => {
			await runFetchLeagues()
		},
		{ skipNoKey: true },
	),
	sync_catalogs: traced('sync_catalogs', async () => {
		await runSyncCatalogs()
	}),
	poll_live_games: traced(
		'poll_live_games',
		async (_payload, helpers) => {
			try {
				await runPollLiveGames()
			} finally {
				await rescheduleLive(helpers, 'poll_live_games')
			}
		},
		{ skipNoKey: true },
	),
	poll_top_live: traced(
		'poll_top_live',
		async (_payload, helpers) => {
			try {
				await runPollTopLive()
			} finally {
				await rescheduleLive(helpers, 'poll_top_live')
			}
		},
		{ skipNoKey: true },
	),
	poll_realtime_stats: traced(
		'poll_realtime_stats',
		async (_payload, helpers) => {
			try {
				await runPollRealtimeStats()
			} finally {
				await rescheduleLive(helpers, 'poll_realtime_stats')
			}
		},
		{ skipNoKey: true },
	),
	poll_finished_history: traced(
		'poll_finished_history',
		async (_payload, helpers) => {
			try {
				await runPollFinishedHistory()
			} finally {
				await rescheduleFinishedHistory(helpers)
			}
		},
		{ skipNoKey: true },
	),
	walk_league_history: traced(
		'walk_league_history',
		async (payload) => {
			const body = readJobPayload(payload)
			await runWalkLeagueHistory({
				leagueId: jobNumber(payload, 'league_id'),
				matchesLimit: jobNumber(payload, 'matches_limit') ?? null,
				reset: body.reset === true,
			})
		},
		{ skipNoKey: true },
	),
	fetch_match_details: traced('fetch_match_details', async (payload) => {
		const matchId = jobNumber(payload, 'match_id')
		if (matchId === undefined) {
			throw new Error('fetch_match_details payload requires match_id')
		}
		const origin = matchOrigin(readJobPayload(payload).origin)
		try {
			await runFetchMatchDetails({ matchId, origin })
		} catch (error) {
			if (!/no ready Steam API key/i.test(errorMessage(error))) {
				throw error
			}
			await enqueueFetchMatchDetails(
				matchId,
				origin,
				new Date(Date.now() + 30_000),
			)
		}
	}),
	process_league: traced(
		'process_league',
		async (payload) => {
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
		{ skipNoKey: true },
	),
	download_replay: traced('download_replay', async (payload) => {
		await runDownloadReplay(matchIdOf(payload))
	}),
	replenish_accounts: traced(
		'replenish_accounts',
		async (_payload, helpers) => {
			try {
				await runReplenishAccounts()
			} finally {
				await rescheduleReplenish(helpers)
			}
		},
	),
	retest_disabled_resources: traced(
		'retest_disabled_resources',
		async (_payload, helpers) => {
			try {
				await runRetestDisabledResources()
			} finally {
				await rescheduleRetest(helpers)
			}
		},
	),
	[SCHEDULED_JOB]: traced(SCHEDULED_JOB, async (payload) => {
		await runScheduledJob(payload)
	}),
} satisfies TaskList

export function taskListFor(names: readonly string[]): TaskList {
	const picked: TaskList = {}
	for (const name of names) {
		const task = allTasks[name as keyof typeof allTasks]
		if (task === undefined) {
			throw new Error(`unknown worker task ${name}`)
		}
		picked[name] = task
	}
	return picked
}
