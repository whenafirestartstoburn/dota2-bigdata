import { eq } from 'drizzle-orm'
import { leagues } from '#src/db/schema'
import type { LeagueStatus } from '#src/steam/league-status'
import type { LeagueInfo } from '#src/steam/schemas'
import { db, type Executor, sql, sqlValues } from '#src/utils/db'

export async function upsertLeagues(
	infos: readonly LeagueInfo[],
	statusOf: (info: LeagueInfo) => LeagueStatus,
): Promise<void> {
	if (infos.length === 0) return

	const rows = infos.map((info) => ({
		league_id: info.league_id,
		name: info.name,
		tier: info.tier,
		region: info.region,
		total_prize_pool: info.total_prize_pool,
		start_timestamp: info.start_timestamp,
		end_timestamp: info.end_timestamp,
		most_recent_activity: info.most_recent_activity,
		valve_status: info.status,
		status: statusOf(info),
		fetched_at: new Date(),
		updated_at: new Date(),
	}))

	const chunkSize = 300
	for (let offset = 0; offset < rows.length; offset += chunkSize) {
		const chunk = rows.slice(offset, offset + chunkSize)
		await db.execute(sql`
			INSERT INTO leagues ${sqlValues(chunk)}
			ON CONFLICT (league_id) DO UPDATE SET
				name = excluded.name,
				tier = excluded.tier,
				region = excluded.region,
				total_prize_pool = excluded.total_prize_pool,
				start_timestamp = excluded.start_timestamp,
				end_timestamp = excluded.end_timestamp,
				most_recent_activity = excluded.most_recent_activity,
				valve_status = excluded.valve_status,
				status = excluded.status,
				fetched_at = excluded.fetched_at,
				updated_at = excluded.updated_at
		`)
	}
}

export async function ensureLeagueStub(
	leagueId: number,
	exec: Executor = db,
	name = `league ${leagueId}`,
): Promise<void> {
	await exec.execute(sql`
		INSERT INTO leagues (league_id, name, status)
		VALUES (${leagueId}, ${name}, 'LIVE')
		ON CONFLICT (league_id) DO NOTHING
	`)
}

export async function getLeague(leagueId: number) {
	const rows = await db
		.select()
		.from(leagues)
		.where(eq(leagues.league_id, leagueId))
		.limit(1)
	return rows[0] ?? null
}

export async function pickNextHistoryLeague(exhaustedRefreshMs: number) {
	const rows = await db.execute(sql`
		SELECT *
		FROM leagues
		WHERE status <> 'UPCOMING'
			AND (
				history_exhausted = false
				OR history_checked_at IS NULL
				OR (
					history_exhausted
					AND history_checked_at < now()
						- ${exhaustedRefreshMs} * interval '1 millisecond'
				)
			)
		ORDER BY
			(history_checked_at IS NULL) DESC,
			history_exhausted ASC,
			NULLIF(most_recent_activity, 0) DESC NULLS LAST,
			NULLIF(start_timestamp, 0) DESC NULLS LAST,
			league_id DESC
		LIMIT 1
	`)
	return rows[0] ?? null
}

export async function updateLeagueHistoryCursor(
	leagueId: number,
	patch: {
		headMatchId?: number | null
		tailMatchId?: number | null
		exhausted?: boolean
		lastMatchSeqNum?: number | null
	},
): Promise<void> {
	await db.execute(sql`
		UPDATE leagues SET
			history_head_match_id = COALESCE(
				${patch.headMatchId ?? null}::bigint,
				history_head_match_id
			),
			history_tail_match_id = COALESCE(
				${patch.tailMatchId ?? null}::bigint,
				history_tail_match_id
			),
			history_exhausted = COALESCE(
				${patch.exhausted ?? null}::boolean,
				history_exhausted
			),
			last_match_seq_num = COALESCE(
				${patch.lastMatchSeqNum ?? null}::bigint,
				last_match_seq_num
			),
			history_checked_at = now(),
			updated_at = now()
		WHERE league_id = ${leagueId}
	`)
}

export async function resetLeagueHistory(leagueId: number): Promise<void> {
	await db.execute(sql`
		UPDATE leagues SET
			history_exhausted = false,
			history_checked_at = NULL,
			updated_at = now()
		WHERE league_id = ${leagueId}
	`)
}
