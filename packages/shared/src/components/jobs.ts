import { asNumber, asRecord, asString, asText } from '#src/store/coerce'
import { db, sql } from '#src/utils/db'

export const QUEUE = {
	live: 'live',
	historical: 'historical',
	details: 'details',
	replayLive: 'replay-live',
	replayHistorical: 'replay-historical',
	gc: 'dota-gc',
} as const

/** Graphile serializes one queue; this many shards cap details parallelism. */
export const DETAILS_PARALLELISM = 5

/** Same idea for Valve CDN → S3 downloads, live and historical each. */
export const REPLAY_PARALLELISM = 10

export function detailsQueue(matchId: number): string {
	const n = DETAILS_PARALLELISM
	return `${QUEUE.details}:${((matchId % n) + n) % n}`
}

export function replayQueue(
	matchId: number,
	origin: 'live' | 'historical',
): string {
	const n = REPLAY_PARALLELISM
	const prefix = origin === 'live' ? QUEUE.replayLive : QUEUE.replayHistorical
	return `${prefix}:${((matchId % n) + n) % n}`
}

export const PRIORITY = {
	live: 0,
	detailsLive: 0,
	detailsHistorical: 10,
	replenish: 15,
	replayLive: 0,
	walkHistory: 20,
	replayHistorical: 20,
	retest: 25,
} as const

/** Off-queue waiter. When `run_at` comes, hops back onto a named queue. */
export const SCHEDULED_JOB = 'run_scheduled_job'

export type EnqueueJobInput = {
	identifier: string
	payload?: unknown
	queueName?: string | null
	runAt?: Date
	jobKey?: string | null
	jobKeyMode?: 'replace' | 'preserve_run_at' | 'unsafe_dedupe'
	maxAttempts?: number
	priority?: number
}

export type ScheduledJobPayload = {
	identifier: string
	payload: unknown
	queueName: string
	jobKey: string | null
	jobKeyMode: 'replace' | 'preserve_run_at' | 'unsafe_dedupe'
	priority: number
	maxAttempts: number
}

export function scheduledJobKey(jobKey: string): string {
	return jobKey.startsWith('later:') ? jobKey : `later:${jobKey}`
}

export function jobRetryDelayMs(failedTry: number): number {
	const n = Math.max(failedTry, 1)
	if (n <= 1) return 30_000
	if (n <= 2) return 60_000
	if (n <= 5) return 3 * 60_000
	if (n <= 10) return 15 * 60_000
	return 60 * 60_000
}

export function parseScheduledJob(
	payload: unknown,
): ScheduledJobPayload | null {
	const body = asRecord(payload)
	if (body == null) return null
	const identifier = asString(body.identifier)
	const queueName = asString(body.queueName)
	if (identifier == null || queueName == null) return null
	const mode = body.jobKeyMode
	const jobKeyMode =
		mode === 'preserve_run_at' || mode === 'unsafe_dedupe' ? mode : 'replace'
	return {
		identifier,
		payload: body.payload,
		queueName,
		jobKey: asString(body.jobKey),
		jobKeyMode,
		priority: asNumber(body.priority) ?? 0,
		maxAttempts: asNumber(body.maxAttempts) ?? 25,
	}
}

export function readJobPayload(payload: unknown): Record<string, unknown> {
	let value: unknown = payload
	if (typeof value === 'string') {
		try {
			value = JSON.parse(value)
		} catch {
			return {}
		}
	}
	if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
		return value as Record<string, unknown>
	}
	return {}
}

export function jobNumber(payload: unknown, key: string): number | undefined {
	return asNumber(readJobPayload(payload)[key]) ?? undefined
}

export async function enqueueJob(input: EnqueueJobInput): Promise<string> {
	const runAt = input.runAt ?? new Date()
	const queueName = input.queueName ?? null
	const queued = queueName != null && queueName !== ''
	if (queued && runAt.getTime() > Date.now()) {
		return addJob({
			identifier: SCHEDULED_JOB,
			payload: {
				identifier: input.identifier,
				payload: input.payload ?? {},
				queueName,
				jobKey: input.jobKey ?? null,
				jobKeyMode: input.jobKeyMode ?? 'replace',
				priority: input.priority ?? 0,
				maxAttempts: input.maxAttempts ?? 25,
			} satisfies ScheduledJobPayload,
			queueName: null,
			runAt,
			jobKey: input.jobKey != null ? scheduledJobKey(input.jobKey) : null,
			jobKeyMode: input.jobKeyMode ?? 'replace',
			maxAttempts: 1,
			priority: input.priority ?? 0,
		})
	}
	const payload = queued
		? stampRetryBudget(input.payload, input.maxAttempts ?? 25, queueName)
		: (input.payload ?? {})
	return addJob({
		...input,
		payload,
		queueName,
		runAt,
		maxAttempts: queued ? 1 : (input.maxAttempts ?? 25),
	})
}

export async function runScheduledJob(payload: unknown): Promise<void> {
	const scheduled = parseScheduledJob(payload)
	if (scheduled == null) {
		throw new Error('run_scheduled_job payload is invalid')
	}
	await enqueueJob({
		identifier: scheduled.identifier,
		payload: scheduled.payload,
		queueName: scheduled.queueName,
		jobKey: scheduled.jobKey,
		jobKeyMode: scheduled.jobKeyMode,
		priority: scheduled.priority,
		maxAttempts: scheduled.maxAttempts,
		runAt: new Date(),
	})
}

export async function scheduleQueuedJobRetry(input: {
	identifier: string
	payload: unknown
	queueName: string
	jobKey: string | null
	priority: number
	failedTry: number
}): Promise<boolean> {
	const body = asRecord(input.payload) ?? {}
	const failedTry = asNumber(body._tries) ?? input.failedTry
	const maxAttempts = asNumber(body._maxAttempts) ?? 25
	if (failedTry >= maxAttempts) return false
	await enqueueJob({
		identifier: input.identifier,
		payload: { ...body, _tries: failedTry + 1, _maxAttempts: maxAttempts },
		queueName: input.queueName,
		jobKey: input.jobKey,
		jobKeyMode: 'replace',
		priority: input.priority,
		maxAttempts,
		runAt: new Date(Date.now() + jobRetryDelayMs(failedTry)),
	})
	return true
}

function stampRetryBudget(
	payload: unknown,
	maxAttempts: number,
	queueName: string,
): unknown {
	const body = asRecord(payload)
	if (body == null) {
		return { _maxAttempts: maxAttempts, _queueName: queueName }
	}
	return {
		...body,
		_maxAttempts: asNumber(body._maxAttempts) ?? maxAttempts,
		_queueName: asString(body._queueName) ?? queueName,
	}
}

async function addJob(input: EnqueueJobInput): Promise<string> {
	const payloadJson = JSON.stringify(input.payload ?? {})
	const payloadSql = sql.raw(`'${payloadJson.replace(/'/g, "''")}'::json`)
	const rows = await db.execute(sql`
		SELECT id::text AS id
		FROM graphile_worker.add_job(
			${input.identifier},
			${payloadSql},
			${input.queueName ?? null}::text,
			${input.runAt ?? new Date()}::timestamptz,
			${input.maxAttempts ?? 25}::integer,
			${input.jobKey ?? null}::text,
			${input.priority ?? 0}::integer,
			NULL,
			${input.jobKeyMode ?? 'replace'}::text
		)
	`)
	const id = asText(rows[0]?.id)
	if (id == null) {
		throw new Error(`add_job ${input.identifier} returned no id`)
	}
	return id
}

export async function countJobs(
	identifier: string,
	priority?: number,
): Promise<number> {
	try {
		const rows = await db.execute(sql`
			SELECT count(*)::int AS n
			FROM graphile_worker._private_jobs j
			JOIN graphile_worker._private_tasks t ON t.id = j.task_id
			LEFT JOIN graphile_worker._private_job_queues q
				ON q.id = j.job_queue_id
			WHERE j.attempts < j.max_attempts
				AND (
					(
						t.identifier = ${identifier}
						AND (${priority ?? null}::smallint IS NULL
							OR j.priority = ${priority ?? null})
						AND (j.locked_at IS NOT NULL OR q.locked_at IS NULL)
					)
					OR (
						t.identifier = ${SCHEDULED_JOB}
						AND j.payload->>'identifier' = ${identifier}
						AND (${priority ?? null}::smallint IS NULL
							OR (j.payload->>'priority')::int = ${priority ?? null})
					)
				)
		`)
		const n = rows[0]?.n
		return typeof n === 'number' ? n : Number(n ?? 0)
	} catch {
		return 0
	}
}
