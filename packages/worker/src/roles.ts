import { PRIORITY, SCHEDULED_JOB } from '@app/shared/src/components/jobs'

export const WORKER_ROLES = ['live', 'historical', 'match-processing'] as const

/** Revives missing / permafailed self-reschedule `jobKey`s. Not a Valve job. */
export const ENSURE_LOOP_JOBS = 'ensure_loop_jobs'

/** Graphile default. Loop jobs must exceed 1 so a PG crash is retried. */
export const LOOP_JOB_MAX_ATTEMPTS = 25

export type WorkerRole = (typeof WORKER_ROLES)[number]
export type WorkerMode = WorkerRole | 'all'

export const WORKER_TASKS = {
	live: [
		'poll_live_games',
		'poll_top_live',
		'poll_realtime_stats',
		'poll_finished_history',
		'fetch_seq_details',
		'walk_seq_history',
		'fetch_seq_window',
	],
	historical: [
		'fetch_leagues',
		'sync_catalogs',
		'poll_finished_history',
		'walk_league_history',
		'walk_seq_history',
		'fetch_seq_window',
		'fetch_seq_details',
		'process_league',
	],
	'match-processing': [
		'fetch_match_details',
		'download_replay',
		'archive_parsed_replays',
		'maintain_request_logs',
		'replenish_accounts',
		'settle_marketplace_orders',
		'retest_disabled_resources',
	],
} as const satisfies Record<WorkerRole, readonly string[]>

export const WORKER_CONCURRENCY: Record<WorkerRole, number> = {
	live: 8,
	historical: 4,
	'match-processing': 35,
}

const HISTORICAL_CRON =
	'0 * * * * fetch_leagues ?max=3\n' +
	'*/5 * * * * walk_league_history ?jobKey=walk_league_history&jobKeyMode=preserve_run_at&max=3\n' +
	'0 * * * * sync_catalogs ?max=3'

const ENSURE_CRON = `* * * * * ${ENSURE_LOOP_JOBS} ?jobKey=${ENSURE_LOOP_JOBS}&jobKeyMode=preserve_run_at&max=3`

export type StartupJob = {
	identifier: string
	jobKey?: string
	priority?: number
	maxAttempts?: number
	/** Self-reschedules; revive if the row is missing or permafailed. */
	loop?: boolean
}

export function isWorkerRole(value: string): value is WorkerRole {
	return (WORKER_ROLES as readonly string[]).includes(value)
}

export function parseWorkerMode(value: string | undefined): WorkerMode {
	if (value == null || value === '' || value === 'all') return 'all'
	if (isWorkerRole(value)) return value
	throw new Error(
		`WORKER_ROLE must be ${WORKER_ROLES.join('|')} or all, got ${value}`,
	)
}

export function taskNamesFor(mode: WorkerMode): readonly string[] {
	const names =
		mode === 'all'
			? [...new Set(WORKER_ROLES.flatMap((role) => [...WORKER_TASKS[role]]))]
			: [...WORKER_TASKS[mode]]
	return [...names, SCHEDULED_JOB, ENSURE_LOOP_JOBS]
}

export function concurrencyFor(mode: WorkerMode): number {
	if (mode === 'all') return WORKER_CONCURRENCY['match-processing']
	return WORKER_CONCURRENCY[mode]
}

export function cronFor(mode: WorkerMode): string {
	if (mode === 'historical' || mode === 'all') {
		return `${ENSURE_CRON}\n${HISTORICAL_CRON}`
	}
	return ENSURE_CRON
}

export function syncsCatalogsOnBoot(mode: WorkerMode): boolean {
	return mode === 'historical' || mode === 'all'
}

/** Postgres inventory gauges are global — one scrape target, not × roles. */
export function scrapesInventory(mode: WorkerMode): boolean {
	return mode === 'match-processing' || mode === 'all'
}

export function startupJobsFor(mode: WorkerMode): StartupJob[] {
	const jobs: StartupJob[] = []
	const want = new Set(taskNamesFor(mode))
	const add = (job: StartupJob) => {
		if (want.has(job.identifier)) jobs.push(job)
	}
	add({
		identifier: 'poll_live_games',
		jobKey: 'poll_live_games',
		maxAttempts: LOOP_JOB_MAX_ATTEMPTS,
		loop: true,
	})
	add({
		identifier: 'poll_top_live',
		jobKey: 'poll_top_live',
		maxAttempts: LOOP_JOB_MAX_ATTEMPTS,
		loop: true,
	})
	add({
		identifier: 'poll_realtime_stats',
		jobKey: 'poll_realtime_stats',
		maxAttempts: LOOP_JOB_MAX_ATTEMPTS,
		loop: true,
	})
	add({
		identifier: 'poll_finished_history',
		jobKey: 'poll_finished_history',
		maxAttempts: LOOP_JOB_MAX_ATTEMPTS,
		loop: true,
	})
	add({
		identifier: 'walk_seq_history',
		jobKey: 'walk_seq_history',
		priority: PRIORITY.walkHistory,
		maxAttempts: LOOP_JOB_MAX_ATTEMPTS,
		loop: true,
	})
	add({ identifier: 'fetch_leagues', jobKey: 'fetch_leagues_startup' })
	add({
		identifier: 'walk_league_history',
		jobKey: 'walk_league_history',
		maxAttempts: LOOP_JOB_MAX_ATTEMPTS,
		loop: true,
	})
	add({
		identifier: 'archive_parsed_replays',
		jobKey: 'archive_parsed_replays',
		priority: PRIORITY.archive,
		maxAttempts: LOOP_JOB_MAX_ATTEMPTS,
		loop: true,
	})
	add({
		identifier: 'maintain_request_logs',
		jobKey: 'maintain_request_logs',
		priority: PRIORITY.maintainLogs,
		maxAttempts: LOOP_JOB_MAX_ATTEMPTS,
		loop: true,
	})
	add({
		identifier: 'replenish_accounts',
		jobKey: 'replenish_accounts',
		priority: PRIORITY.replenish,
		maxAttempts: LOOP_JOB_MAX_ATTEMPTS,
		loop: true,
	})
	add({
		identifier: 'settle_marketplace_orders',
		jobKey: 'settle_marketplace_orders',
		priority: PRIORITY.settleOrders,
		maxAttempts: LOOP_JOB_MAX_ATTEMPTS,
		loop: true,
	})
	add({
		identifier: 'retest_disabled_resources',
		jobKey: 'retest_disabled_resources',
		priority: PRIORITY.retest,
		maxAttempts: LOOP_JOB_MAX_ATTEMPTS,
		loop: true,
	})
	return jobs
}

export function loopJobsFor(mode: WorkerMode): StartupJob[] {
	return startupJobsFor(mode).filter((job) => job.loop === true)
}
