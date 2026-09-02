import { db, sql } from '#src/utils/db'

export async function createIngestRun(input: {
	leagueId: number
	matchesLimit: number | null
}): Promise<{ id: string }> {
	const rows = await db.execute(sql`
		INSERT INTO league_ingest_runs (league_id, matches_limit, status)
		VALUES (${input.leagueId}, ${input.matchesLimit}, 'queued')
		RETURNING id::text AS id
	`)
	const id = rows[0]?.id
	if (typeof id !== 'string') throw new Error('failed to create ingest run')
	return { id }
}

export async function getIngestRun(id: string) {
	const rows = await db.execute(sql`
		SELECT
			id::text AS id,
			league_id,
			matches_limit,
			status,
			matches_listed,
			matches_detailed,
			replays_enqueued,
			error,
			created_at,
			started_at,
			finished_at
		FROM league_ingest_runs
		WHERE id = ${id}::uuid
	`)
	return rows[0] ?? null
}

export async function patchIngestRun(
	id: string,
	patch: {
		status?: string
		matchesListed?: number
		matchesDetailed?: number
		replaysEnqueued?: number
		error?: string | null
		started?: boolean
		finished?: boolean
	},
): Promise<void> {
	await db.execute(sql`
		UPDATE league_ingest_runs SET
			status = COALESCE(${patch.status ?? null}::ingest_run_status, status),
			matches_listed = COALESCE(${patch.matchesListed ?? null}, matches_listed),
			matches_detailed = COALESCE(${patch.matchesDetailed ?? null}, matches_detailed),
			replays_enqueued = COALESCE(${patch.replaysEnqueued ?? null}, replays_enqueued),
			error = COALESCE(${patch.error ?? null}, error),
			started_at = CASE WHEN ${patch.started === true} THEN now() ELSE started_at END,
			finished_at = CASE WHEN ${patch.finished === true} THEN now() ELSE finished_at END
		WHERE id = ${id}::uuid
	`)
}
