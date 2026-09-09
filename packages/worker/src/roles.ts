import { PRIORITY } from '@app/shared/src/components/jobs'

export const WORKER_ROLES = ['live', 'historical', 'match-processing'] as const

export type WorkerRole = (typeof WORKER_ROLES)[number]
export type WorkerMode = WorkerRole | 'all'

export const WORKER_TASKS = {
	live: ['poll_live_games', 'poll_top_live', 'poll_realtime_stats'],
	historical: [
		'fetch_leagues',
		'sync_catalogs',
		'poll_finished_history',
		'walk_league_history',
		'process_league',
	],
	'match-processing': [
		'fetch_match_details',
		'download_replay',
		'replenish_accounts',
		'retest_disabled_resources',
	],
} as const satisfies Record<WorkerRole, readonly string[]>

export const WORKER_CONCURRENCY: Record<WorkerRole, number> = {
	live: 4,
	historical: 4,
	'match-processing': 35,
}

const HISTORICAL_CRON =
	'0 * * * * fetch_leagues ?max=3\n' +
	'*/5 * * * * walk_league_history ?jobKey=walk_league_history&jobKeyMode=preserve_run_at&max=3\n' +
	'0 5 * * * sync_catalogs ?max=3'

export type StartupJob = {
	identifier: string
	jobKey?: string
	priority?: number
	maxAttempts?: number
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
	if (mode === 'all') {
		return WORKER_ROLES.flatMap((role) => [...WORKER_TASKS[role]])
	}
	return WORKER_TASKS[mode]
}

export function concurrencyFor(mode: WorkerMode): number {
	if (mode === 'all') return WORKER_CONCURRENCY['match-processing']
	return WORKER_CONCURRENCY[mode]
}

export function cronFor(mode: WorkerMode): string {
	if (mode === 'historical' || mode === 'all') return HISTORICAL_CRON
	return ''
}

export function syncsCatalogsOnBoot(mode: WorkerMode): boolean {
	return mode === 'historical' || mode === 'all'
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
		maxAttempts: 1,
	})
	add({
		identifier: 'poll_top_live',
		jobKey: 'poll_top_live',
		maxAttempts: 1,
	})
	add({
		identifier: 'poll_realtime_stats',
		jobKey: 'poll_realtime_stats',
		maxAttempts: 1,
	})
	add({
		identifier: 'poll_finished_history',
		jobKey: 'poll_finished_history',
		maxAttempts: 1,
	})
	add({ identifier: 'fetch_leagues', jobKey: 'fetch_leagues_startup' })
	add({ identifier: 'walk_league_history', jobKey: 'walk_league_history' })
	add({
		identifier: 'replenish_accounts',
		jobKey: 'replenish_accounts',
		priority: PRIORITY.replenish,
		maxAttempts: 1,
	})
	add({
		identifier: 'retest_disabled_resources',
		jobKey: 'retest_disabled_resources',
		priority: PRIORITY.retest,
		maxAttempts: 1,
	})
	return jobs
}
