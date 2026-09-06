import { afterAll, describe, expect, test } from 'bun:test'
import {
	DETAILS_PARALLELISM,
	countJobs,
	detailsQueue,
	enqueueJob,
	PRIORITY,
	QUEUE,
	REPLAY_PARALLELISM,
	replayQueue,
} from '#src/components/jobs'
import { db, sql } from '#src/utils/db'

describe('detailsQueue', () => {
	test('shards match ids across DETAILS_PARALLELISM queues', () => {
		expect(DETAILS_PARALLELISM).toBe(5)
		expect(detailsQueue(0)).toBe(`${QUEUE.details}:0`)
		expect(detailsQueue(1)).toBe(`${QUEUE.details}:1`)
		expect(detailsQueue(5)).toBe(`${QUEUE.details}:0`)
		expect(detailsQueue(5184)).toBe(`${QUEUE.details}:4`)
		const shards = new Set(
			[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((id) => detailsQueue(id)),
		)
		expect(shards.size).toBe(DETAILS_PARALLELISM)
	})
})

describe('replayQueue', () => {
	test('shards match ids across REPLAY_PARALLELISM queues per origin', () => {
		expect(REPLAY_PARALLELISM).toBe(10)
		expect(replayQueue(0, 'live')).toBe(`${QUEUE.replayLive}:0`)
		expect(replayQueue(1, 'historical')).toBe(`${QUEUE.replayHistorical}:1`)
		expect(replayQueue(10, 'live')).toBe(`${QUEUE.replayLive}:0`)
		expect(replayQueue(5184, 'historical')).toBe(`${QUEUE.replayHistorical}:4`)
		const live = new Set(
			[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((id) => replayQueue(id, 'live')),
		)
		expect(live.size).toBe(REPLAY_PARALLELISM)
	})
})

describe('countJobs', () => {
	const identifier = `test_count_jobs_${Date.now()}`
	const keys = [`${identifier}:live`, `${identifier}:dead`]

	afterAll(async () => {
		await db.execute(sql`
			DELETE FROM graphile_worker._private_jobs
			WHERE key IN (${keys[0]}, ${keys[1]})
		`)
	})

	test('ignores jobs that have exhausted max_attempts', async () => {
		await enqueueJob({
			identifier,
			payload: { kind: 'live' },
			priority: PRIORITY.detailsHistorical,
			jobKey: keys[0],
			maxAttempts: 5,
		})
		await enqueueJob({
			identifier,
			payload: { kind: 'dead' },
			priority: PRIORITY.detailsHistorical,
			jobKey: keys[1],
			maxAttempts: 5,
		})
		await db.execute(sql`
			UPDATE graphile_worker._private_jobs
			SET attempts = max_attempts, last_error = 'exhausted'
			WHERE key = ${keys[1]}
		`)
		expect(await countJobs(identifier, PRIORITY.detailsHistorical)).toBe(1)
		expect(await countJobs(identifier)).toBe(1)
	})
})
