import { afterAll, describe, expect, test } from 'bun:test'
import {
	countJobs,
	DETAILS_PARALLELISM,
	detailsQueue,
	enqueueJob,
	jobRetryDelayMs,
	PRIORITY,
	QUEUE,
	REPLAY_PARALLELISM,
	replayQueue,
	runScheduledJob,
	SCHEDULED_JOB,
	scheduledJobKey,
	scheduleQueuedJobRetry,
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
	const keys = [
		`${identifier}:live`,
		`${identifier}:dead`,
		`${identifier}:blocked`,
	]
	const blockedQueue = `${identifier}:q`

	afterAll(async () => {
		await db.execute(sql`
			DELETE FROM graphile_worker._private_jobs
			WHERE key IN (${keys[0]}, ${keys[1]}, ${keys[2]})
		`)
		await db.execute(sql`
			DELETE FROM graphile_worker._private_job_queues
			WHERE queue_name = ${blockedQueue}
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

	test('ignores jobs waiting on a locked graphile queue', async () => {
		await enqueueJob({
			identifier,
			payload: { kind: 'blocked' },
			queueName: blockedQueue,
			priority: PRIORITY.detailsHistorical,
			jobKey: keys[2],
			maxAttempts: 5,
		})
		await db.execute(sql`
			UPDATE graphile_worker._private_job_queues
			SET locked_at = now(), locked_by = 'test-dead-worker'
			WHERE queue_name = ${blockedQueue}
		`)
		expect(await countJobs(identifier, PRIORITY.detailsHistorical)).toBe(1)
		expect(await countJobs(identifier)).toBe(1)
	})
})

describe('named-queue scheduling', () => {
	const identifier = `test_schedule_${Date.now()}`
	const jobKey = `${identifier}:match`
	const laterKey = scheduledJobKey(jobKey)
	const queueName = `${identifier}:q`

	afterAll(async () => {
		await db.execute(sql`
			DELETE FROM graphile_worker._private_jobs
			WHERE key IN (${jobKey}, ${laterKey})
		`)
		await db.execute(sql`
			DELETE FROM graphile_worker._private_job_queues
			WHERE queue_name = ${queueName}
		`)
	})

	test('jobRetryDelayMs grows, then caps at an hour', () => {
		expect(jobRetryDelayMs(1)).toBe(30_000)
		expect(jobRetryDelayMs(2)).toBe(60_000)
		expect(jobRetryDelayMs(3)).toBe(180_000)
		expect(jobRetryDelayMs(11)).toBe(3_600_000)
	})

	test('a future named-queue enqueue parks off-queue and hops back', async () => {
		await enqueueJob({
			identifier,
			payload: { match_id: 7 },
			queueName,
			jobKey,
			priority: PRIORITY.detailsHistorical,
			maxAttempts: 5,
			runAt: new Date(Date.now() + 60_000),
		})
		const [parked] = await db.execute(sql`
			SELECT task_identifier, queue_name
			FROM graphile_worker.jobs
			WHERE key = ${laterKey}
		`)
		expect(parked?.task_identifier).toBe(SCHEDULED_JOB)
		expect(parked?.queue_name).toBeNull()
		expect(await countJobs(identifier, PRIORITY.detailsHistorical)).toBe(1)

		const [row] = await db.execute(sql`
			SELECT payload FROM graphile_worker._private_jobs
			WHERE key = ${laterKey}
		`)
		await runScheduledJob(row?.payload)
		const [live] = await db.execute(sql`
			SELECT task_identifier, queue_name, max_attempts, run_at <= now() AS due
			FROM graphile_worker.jobs
			WHERE key = ${jobKey}
		`)
		expect(live?.task_identifier).toBe(identifier)
		expect(live?.queue_name).toBe(queueName)
		expect(live?.max_attempts).toBe(1)
		expect(live?.due).toBe(true)
	})

	test('scheduleQueuedJobRetry parks off-queue until the delay', async () => {
		const retryKey = `${identifier}:retry`
		const laterRetry = scheduledJobKey(retryKey)
		const retried = await scheduleQueuedJobRetry({
			identifier,
			payload: { _tries: 1, _maxAttempts: 5 },
			queueName,
			jobKey: retryKey,
			priority: PRIORITY.detailsHistorical,
			failedTry: 1,
		})
		expect(retried).toBe(true)
		const [parked] = await db.execute(sql`
			SELECT task_identifier, queue_name
			FROM graphile_worker.jobs
			WHERE key = ${laterRetry}
		`)
		expect(parked?.task_identifier).toBe(SCHEDULED_JOB)
		expect(parked?.queue_name).toBeNull()
		await db.execute(sql`
			DELETE FROM graphile_worker._private_jobs
			WHERE key = ${laterRetry}
		`)
	})

	test('scheduleQueuedJobRetry gives up after the stamped budget', async () => {
		const retried = await scheduleQueuedJobRetry({
			identifier,
			payload: { _tries: 5, _maxAttempts: 5 },
			queueName,
			jobKey: `${identifier}:done`,
			priority: PRIORITY.detailsHistorical,
			failedTry: 5,
		})
		expect(retried).toBe(false)
	})
})
