import { describe, expect, test } from 'bun:test'
import { PRIORITY, SCHEDULED_JOB } from '@app/shared/src/components/jobs'
import {
	concurrencyFor,
	cronFor,
	ENSURE_LOOP_JOBS,
	LOOP_JOB_MAX_ATTEMPTS,
	loopJobsFor,
	parseWorkerMode,
	scrapesInventory,
	startupJobsFor,
	syncsCatalogsOnBoot,
	taskNamesFor,
	WORKER_ROLES,
	WORKER_TASKS,
} from '#src/roles'
import { allTasks, taskListFor } from '#src/tasks'

describe('parseWorkerMode', () => {
	test('accepts each role, all, and empty', () => {
		expect(parseWorkerMode(undefined)).toBe('all')
		expect(parseWorkerMode('')).toBe('all')
		expect(parseWorkerMode('all')).toBe('all')
		expect(parseWorkerMode('live')).toBe('live')
		expect(parseWorkerMode('historical')).toBe('historical')
		expect(parseWorkerMode('match-processing')).toBe('match-processing')
	})

	test('rejects an unknown role', () => {
		expect(() => parseWorkerMode('march-processing')).toThrow(/WORKER_ROLE/)
	})
})

describe('task ownership', () => {
	test('roles cover every registered graphile task', () => {
		const owned = [
			...new Set(WORKER_ROLES.flatMap((role) => [...WORKER_TASKS[role]])),
		]
		expect([...owned, SCHEDULED_JOB, ENSURE_LOOP_JOBS].sort()).toEqual(
			Object.keys(allTasks).sort(),
		)
		expect(WORKER_TASKS.live).toContain('poll_finished_history')
		expect(WORKER_TASKS.live).toContain('fetch_seq_details')
		expect(WORKER_TASKS.live).toContain('walk_seq_history')
		expect(WORKER_TASKS.live).toContain('fetch_seq_window')
		expect(WORKER_TASKS.historical).toContain('poll_finished_history')
		expect(WORKER_TASKS.historical).toContain('fetch_seq_details')
		expect(WORKER_TASKS.historical).toContain('walk_seq_history')
		expect(WORKER_TASKS.historical).toContain('fetch_seq_window')
	})

	test('taskListFor keeps only the requested identifiers', () => {
		const withHop = (names: readonly string[]) =>
			[...names, SCHEDULED_JOB, ENSURE_LOOP_JOBS].sort()
		const live = taskListFor(taskNamesFor('live'))
		expect(Object.keys(live).sort()).toEqual(withHop(WORKER_TASKS.live))
		expect(live.poll_live_games).toBeDefined()
		expect(live.poll_finished_history).toBeDefined()
		expect(live.fetch_seq_details).toBeDefined()
		expect(live.walk_seq_history).toBeDefined()
		expect(live.fetch_seq_window).toBeDefined()
		expect(live[SCHEDULED_JOB]).toBeDefined()
		expect(live[ENSURE_LOOP_JOBS]).toBeDefined()
		expect(live.fetch_match_details).toBeUndefined()
		expect(live.walk_league_history).toBeUndefined()

		const historical = taskListFor(taskNamesFor('historical'))
		expect(Object.keys(historical).sort()).toEqual(
			withHop(WORKER_TASKS.historical),
		)
		expect(historical.walk_league_history).toBeDefined()
		expect(historical.poll_finished_history).toBeDefined()
		expect(historical.walk_seq_history).toBeDefined()
		expect(historical.fetch_seq_window).toBeDefined()
		expect(historical.poll_live_games).toBeUndefined()

		const processing = taskListFor(taskNamesFor('match-processing'))
		expect(Object.keys(processing).sort()).toEqual(
			withHop(WORKER_TASKS['match-processing']),
		)
		expect(processing.fetch_match_details).toBeDefined()
		expect(processing.download_replay).toBeDefined()
		expect(processing.archive_parsed_replays).toBeDefined()
		expect(processing.poll_realtime_stats).toBeUndefined()
	})

	test('all registers the union and processing concurrency', () => {
		expect(taskNamesFor('all')).toEqual([
			...new Set(WORKER_ROLES.flatMap((role) => [...WORKER_TASKS[role]])),
			SCHEDULED_JOB,
			ENSURE_LOOP_JOBS,
		])
		expect(concurrencyFor('live')).toBe(4)
		expect(concurrencyFor('historical')).toBe(4)
		expect(concurrencyFor('match-processing')).toBe(35)
		expect(concurrencyFor('all')).toBe(35)
	})
})

describe('boot per role', () => {
	test('only historical (and all) install cron and catalog sync', () => {
		expect(cronFor('live')).toContain(ENSURE_LOOP_JOBS)
		expect(cronFor('live')).not.toContain('fetch_leagues')
		expect(cronFor('match-processing')).toContain(ENSURE_LOOP_JOBS)
		expect(cronFor('historical')).toContain(ENSURE_LOOP_JOBS)
		expect(cronFor('historical')).toContain('fetch_leagues')
		expect(cronFor('historical')).toContain('walk_league_history')
		expect(cronFor('historical')).toContain('sync_catalogs')
		expect(cronFor('all')).toBe(cronFor('historical'))
		expect(syncsCatalogsOnBoot('historical')).toBe(true)
		expect(syncsCatalogsOnBoot('all')).toBe(true)
		expect(syncsCatalogsOnBoot('live')).toBe(false)
		expect(syncsCatalogsOnBoot('match-processing')).toBe(false)
	})

	test('only match-processing (and all) scrape Postgres inventory gauges', () => {
		expect(scrapesInventory('match-processing')).toBe(true)
		expect(scrapesInventory('all')).toBe(true)
		expect(scrapesInventory('live')).toBe(false)
		expect(scrapesInventory('historical')).toBe(false)
	})

	test('startup jobs stay inside the role task list', () => {
		for (const role of ['live', 'historical', 'match-processing'] as const) {
			const names = new Set(taskNamesFor(role))
			for (const job of startupJobsFor(role)) {
				expect(names.has(job.identifier)).toBe(true)
			}
		}
		expect(
			startupJobsFor('live')
				.map((job) => job.identifier)
				.sort(),
		).toEqual([
			'poll_finished_history',
			'poll_live_games',
			'poll_realtime_stats',
			'poll_top_live',
			'walk_seq_history',
		])
		expect(
			startupJobsFor('match-processing').map((job) => job.identifier),
		).toEqual([
			'archive_parsed_replays',
			'maintain_request_logs',
			'replenish_accounts',
			'settle_marketplace_orders',
			'retest_disabled_resources',
		])
		const archive = startupJobsFor('match-processing').find(
			(job) => job.identifier === 'archive_parsed_replays',
		)
		expect(archive?.priority).toBe(PRIORITY.archive)
		const maintainLogs = startupJobsFor('match-processing').find(
			(job) => job.identifier === 'maintain_request_logs',
		)
		expect(maintainLogs?.priority).toBe(PRIORITY.maintainLogs)
		const replenish = startupJobsFor('match-processing').find(
			(job) => job.identifier === 'replenish_accounts',
		)
		expect(replenish?.priority).toBe(PRIORITY.replenish)
		const settle = startupJobsFor('match-processing').find(
			(job) => job.identifier === 'settle_marketplace_orders',
		)
		expect(settle?.priority).toBe(PRIORITY.settleOrders)
		const walkSeq = startupJobsFor('live').find(
			(job) => job.identifier === 'walk_seq_history',
		)
		expect(walkSeq?.priority).toBe(PRIORITY.walkHistory)
		expect(startupJobsFor('live').map((job) => job.maxAttempts)).toEqual([
			LOOP_JOB_MAX_ATTEMPTS,
			LOOP_JOB_MAX_ATTEMPTS,
			LOOP_JOB_MAX_ATTEMPTS,
			LOOP_JOB_MAX_ATTEMPTS,
			LOOP_JOB_MAX_ATTEMPTS,
		])
		expect(
			loopJobsFor('live')
				.map((job) => job.identifier)
				.sort(),
		).toEqual([
			'poll_finished_history',
			'poll_live_games',
			'poll_realtime_stats',
			'poll_top_live',
			'walk_seq_history',
		])
		expect(
			loopJobsFor('historical')
				.map((job) => job.identifier)
				.sort(),
		).toEqual([
			'poll_finished_history',
			'walk_league_history',
			'walk_seq_history',
		])
		expect(
			loopJobsFor('historical').some(
				(job) => job.identifier === 'fetch_leagues',
			),
		).toBe(false)
	})
})
