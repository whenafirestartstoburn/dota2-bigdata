import {
	jobNumber,
	PRIORITY,
	readJobPayload,
	runScheduledJob,
	SCHEDULED_JOB,
	scheduleQueuedJobRetry,
} from '@app/shared/src/components/jobs'
import { getAppSettings } from '@app/shared/src/components/settings'
import { runArchiveParsedReplays } from '@app/shared/src/jobs/archive-parsed-replays'
import { runFetchLeagues } from '@app/shared/src/jobs/fetch-leagues'
import {
	enqueueFetchMatchDetails,
	matchOrigin,
} from '@app/shared/src/jobs/fetch-match-details'
import {
	enqueueFetchSeqDetails,
	runFetchSeqDetails,
} from '@app/shared/src/jobs/fetch-seq-details'
import { runFetchSeqWindow } from '@app/shared/src/jobs/fetch-seq-window'
import { runMaintainRequestLogsJob } from '@app/shared/src/jobs/maintain-request-logs'
import { runPollFinishedHistory } from '@app/shared/src/jobs/poll-finished-history'
import { runPollLiveGames } from '@app/shared/src/jobs/poll-live'
import { runPollRealtimeStats } from '@app/shared/src/jobs/poll-realtime-stats'
import { runPollTopLive } from '@app/shared/src/jobs/poll-top-live'
import { runReplenishAccounts } from '@app/shared/src/jobs/replenish-accounts'
import { runRetestDisabledResources } from '@app/shared/src/jobs/retest-resources'
import { runSettleMarketplaceOrders } from '@app/shared/src/jobs/settle-marketplace-orders'
import { runSyncCatalogs } from '@app/shared/src/jobs/sync-catalogs'
import { runWalkLeagueHistory } from '@app/shared/src/jobs/walk-league-history'
import {
	enqueueFetchSeqWindow,
	runWalkSeqHistory,
	scheduleWalkSeqHistory,
} from '@app/shared/src/jobs/walk-seq-history'
import { jobsInProgress, observeJob } from '@app/shared/src/metrics/observe'
import { asString, errorMessage } from '@app/shared/src/store/coerce'
import { logger } from '@app/shared/src/utils/logger'
import { runWithTrace } from '@app/shared/src/utils/trace'
import type { JobHelpers, Task, TaskList } from 'graphile-worker'
import { runEnsureLoopJobs } from '#src/ensure-loop-jobs'
import { runDownloadReplay } from '#src/jobs/download-replay'
import { runFetchMatchDetails } from '#src/jobs/fetch-match-details'
import {
	ENSURE_LOOP_JOBS,
	LOOP_JOB_MAX_ATTEMPTS,
	loopJobsFor,
} from '#src/roles'
import env from '#src/utils/env'

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
			maxAttempts: LOOP_JOB_MAX_ATTEMPTS,
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
			maxAttempts: LOOP_JOB_MAX_ATTEMPTS,
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
			maxAttempts: LOOP_JOB_MAX_ATTEMPTS,
		},
	)
}

async function rescheduleSettleOrders(helpers: JobHelpers): Promise<void> {
	const settings = await getAppSettings()
	await helpers.addJob(
		'settle_marketplace_orders',
		{},
		{
			runAt: new Date(Date.now() + settings.marketplaceSettleIntervalMs),
			jobKey: 'settle_marketplace_orders',
			jobKeyMode: 'replace',
			priority: PRIORITY.settleOrders,
			maxAttempts: LOOP_JOB_MAX_ATTEMPTS,
		},
	)
}

async function rescheduleArchive(
	helpers: JobHelpers,
	more: boolean,
): Promise<void> {
	const settings = await getAppSettings()
	const delayMs = more ? 0 : settings.replayArchiveIntervalMs
	await helpers.addJob(
		'archive_parsed_replays',
		{},
		{
			runAt: new Date(Date.now() + delayMs),
			jobKey: 'archive_parsed_replays',
			jobKeyMode: 'replace',
			priority: PRIORITY.archive,
			maxAttempts: LOOP_JOB_MAX_ATTEMPTS,
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
			maxAttempts: LOOP_JOB_MAX_ATTEMPTS,
		},
	)
}

async function rescheduleMaintainRequestLogs(
	helpers: JobHelpers,
): Promise<void> {
	await helpers.addJob(
		'maintain_request_logs',
		{},
		{
			runAt: new Date(Date.now() + 60 * 60_000),
			jobKey: 'maintain_request_logs',
			jobKeyMode: 'replace',
			priority: PRIORITY.maintainLogs,
			maxAttempts: LOOP_JOB_MAX_ATTEMPTS,
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
	walk_seq_history: traced('walk_seq_history', async () => {
		let delayMs = 1000
		try {
			delayMs = (await runWalkSeqHistory()).delayMs
		} finally {
			await scheduleWalkSeqHistory(delayMs)
		}
	}),
	fetch_seq_window: traced('fetch_seq_window', async (payload) => {
		const startAt = jobNumber(payload, 'start_at')
		if (startAt === undefined) {
			throw new Error('fetch_seq_window payload requires start_at')
		}
		try {
			await runFetchSeqWindow({ startAt })
		} catch (error) {
			if (!/no ready Steam API key/i.test(errorMessage(error))) {
				throw error
			}
			await enqueueFetchSeqWindow(startAt, new Date(Date.now() + 30_000))
		}
	}),
	fetch_seq_details: traced('fetch_seq_details', async (payload) => {
		const matchId = jobNumber(payload, 'match_id')
		if (matchId === undefined) {
			throw new Error('fetch_seq_details payload requires match_id')
		}
		const origin = matchOrigin(readJobPayload(payload).origin)
		try {
			await runFetchSeqDetails({ matchId, origin })
		} catch (error) {
			if (!/no ready Steam API key/i.test(errorMessage(error))) {
				throw error
			}
			await enqueueFetchSeqDetails(
				matchId,
				origin,
				new Date(Date.now() + 30_000),
			)
		}
	}),
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
	archive_parsed_replays: traced(
		'archive_parsed_replays',
		async (_payload, helpers) => {
			let more = false
			try {
				more = (await runArchiveParsedReplays()).more
			} finally {
				await rescheduleArchive(helpers, more)
			}
		},
	),
	maintain_request_logs: traced(
		'maintain_request_logs',
		async (_payload, helpers) => {
			try {
				await runMaintainRequestLogsJob()
			} finally {
				await rescheduleMaintainRequestLogs(helpers)
			}
		},
	),
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
	settle_marketplace_orders: traced(
		'settle_marketplace_orders',
		async (_payload, helpers) => {
			try {
				await runSettleMarketplaceOrders()
			} finally {
				await rescheduleSettleOrders(helpers)
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
	[ENSURE_LOOP_JOBS]: traced(ENSURE_LOOP_JOBS, async (_payload, helpers) => {
		await runEnsureLoopJobs(helpers.addJob, loopJobsFor(env.WORKER_ROLE))
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
