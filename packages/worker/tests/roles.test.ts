import { describe, expect, test } from 'bun:test'
import { PRIORITY, SCHEDULED_JOB } from '@app/shared/src/components/jobs'
import {
	concurrencyFor,
	cronFor,
	parseWorkerMode,
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
	test('roles partition every registered graphile task', () => {
		const owned = WORKER_ROLES.flatMap((role) => [...WORKER_TASKS[role]])
		expect([...owned, SCHEDULED_JOB].sort()).toEqual(
			Object.keys(allTasks).sort(),
		)
		const seen = new Set<string>()
		for (const name of owned) {
			expect(seen.has(name)).toBe(false)
			seen.add(name)
		}
	})

	test('taskListFor keeps only the requested identifiers', () => {
		const withHop = (names: readonly string[]) =>
			[...names, SCHEDULED_JOB].sort()
		const live = taskListFor(taskNamesFor('live'))
		expect(Object.keys(live).sort()).toEqual(withHop(WORKER_TASKS.live))
		expect(live.poll_live_games).toBeDefined()
		expect(live[SCHEDULED_JOB]).toBeDefined()
		expect(live.fetch_match_details).toBeUndefined()
		expect(live.walk_league_history).toBeUndefined()

		const historical = taskListFor(taskNamesFor('historical'))
		expect(Object.keys(historical).sort()).toEqual(
			withHop(WORKER_TASKS.historical),
		)
		expect(historical.walk_league_history).toBeDefined()
		expect(historical.poll_finished_history).toBeDefined()
		expect(historical.poll_live_games).toBeUndefined()

		const processing = taskListFor(taskNamesFor('match-processing'))
		expect(Object.keys(processing).sort()).toEqual(
			withHop(WORKER_TASKS['match-processing']),
		)
		expect(processing.fetch_match_details).toBeDefined()
		expect(processing.download_replay).toBeDefined()
		expect(processing.poll_realtime_stats).toBeUndefined()
	})

	test('all registers the union and processing concurrency', () => {
		expect(taskNamesFor('all')).toEqual([
			...WORKER_ROLES.flatMap((role) => [...WORKER_TASKS[role]]),
			SCHEDULED_JOB,
		])
		expect(concurrencyFor('live')).toBe(4)
		expect(concurrencyFor('historical')).toBe(4)
		expect(concurrencyFor('match-processing')).toBe(35)
		expect(concurrencyFor('all')).toBe(35)
	})
})

describe('boot per role', () => {
	test('only historical (and all) install cron and catalog sync', () => {
		expect(cronFor('live')).toBe('')
		expect(cronFor('match-processing')).toBe('')
		expect(cronFor('historical')).toContain('fetch_leagues')
		expect(cronFor('historical')).toContain('walk_league_history')
		expect(cronFor('historical')).toContain('sync_catalogs')
		expect(cronFor('all')).toBe(cronFor('historical'))
		expect(syncsCatalogsOnBoot('historical')).toBe(true)
		expect(syncsCatalogsOnBoot('all')).toBe(true)
		expect(syncsCatalogsOnBoot('live')).toBe(false)
		expect(syncsCatalogsOnBoot('match-processing')).toBe(false)
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
		).toEqual([...WORKER_TASKS.live].sort())
		expect(
			startupJobsFor('match-processing').map((job) => job.identifier),
		).toEqual(['replenish_accounts', 'retest_disabled_resources'])
		const replenish = startupJobsFor('match-processing').find(
			(job) => job.identifier === 'replenish_accounts',
		)
		expect(replenish?.priority).toBe(PRIORITY.replenish)
	})
})
