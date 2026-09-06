import { asNumber, asText } from '#src/store/coerce'
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

export async function enqueueJob(input: {
	identifier: string
	payload?: unknown
	queueName?: string | null
	runAt?: Date
	jobKey?: string | null
	jobKeyMode?: 'replace' | 'preserve_run_at' | 'unsafe_dedupe'
	maxAttempts?: number
	priority?: number
}): Promise<string> {
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
		const rows =
			priority === undefined
				? await db.execute(sql`
						SELECT count(*)::int AS n
						FROM graphile_worker.jobs
						WHERE task_identifier = ${identifier}
							AND attempts < max_attempts
					`)
				: await db.execute(sql`
						SELECT count(*)::int AS n
						FROM graphile_worker.jobs
						WHERE task_identifier = ${identifier}
							AND priority = ${priority}
							AND attempts < max_attempts
					`)
		const n = rows[0]?.n
		return typeof n === 'number' ? n : Number(n ?? 0)
	} catch {
		return 0
	}
}
