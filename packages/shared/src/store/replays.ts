import { eq } from 'drizzle-orm'
import { match_replays } from '#src/db/schema'
import { db, sql } from '#src/utils/db'

export async function getReplay(matchId: number) {
	const rows = await db
		.select()
		.from(match_replays)
		.where(eq(match_replays.match_id, matchId))
		.limit(1)
	return rows[0] ?? null
}

export async function ensureReplayRow(
	matchId: number,
	priority: 'live' | 'historical' = 'historical',
): Promise<void> {
	await db.execute(sql`
		INSERT INTO match_replays (match_id, status, priority)
		VALUES (${matchId}, 'pending', ${priority}::replay_priority)
		ON CONFLICT (match_id) DO UPDATE SET
			priority = CASE
				WHEN match_replays.priority = 'live' THEN match_replays.priority
				ELSE excluded.priority
			END
	`)
}

export async function copyReplayLocatorFromMatch(
	matchId: number,
): Promise<void> {
	await db.execute(sql`
		UPDATE match_replays r
		SET
			cluster = COALESCE(r.cluster, m.cluster),
			replay_salt = COALESCE(r.replay_salt, m.replay_salt),
			updated_at = now()
		FROM matches m
		WHERE r.match_id = m.match_id AND r.match_id = ${matchId}
	`)
}

export async function updateReplay(
	matchId: number,
	patch: {
		status?: string
		cluster?: number | null
		replaySalt?: number | null
		replayState?: number | null
		sourceUrl?: string | null
		s3Bucket?: string | null
		s3Key?: string | null
		bytes?: number | null
		error?: string | null
		steamAccountId?: number | null
		proxyId?: number | null
		storedAt?: Date | null
		parserVersion?: number | null
		parsedAt?: Date | null
		nextAttemptAt?: Date | null
		bumpAttempt?: boolean
	},
): Promise<void> {
	await db.execute(sql`
		UPDATE match_replays SET
			status = COALESCE(${patch.status ?? null}::replay_status, status),
			cluster = COALESCE(${patch.cluster ?? null}::integer, cluster),
			replay_salt = COALESCE(${patch.replaySalt ?? null}::bigint, replay_salt),
			replay_state = COALESCE(${patch.replayState ?? null}::integer, replay_state),
			source_url = COALESCE(${patch.sourceUrl ?? null}::text, source_url),
			s3_bucket = COALESCE(${patch.s3Bucket ?? null}::text, s3_bucket),
			s3_key = COALESCE(${patch.s3Key ?? null}::text, s3_key),
			bytes = COALESCE(${patch.bytes ?? null}::bigint, bytes),
			last_error = COALESCE(${patch.error ?? null}::text, last_error),
			last_error_at = CASE
				WHEN ${patch.error ?? null}::text IS NULL THEN last_error_at
				ELSE now()
			END,
			steam_account_id = COALESCE(${patch.steamAccountId ?? null}::bigint, steam_account_id),
			proxy_id = COALESCE(${patch.proxyId ?? null}::bigint, proxy_id),
			stored_at = COALESCE(${patch.storedAt ?? null}::timestamptz, stored_at),
			parser_version = COALESCE(${patch.parserVersion ?? null}::integer, parser_version),
			parsed_at = COALESCE(${patch.parsedAt ?? null}::timestamptz, parsed_at),
			next_attempt_at = COALESCE(${patch.nextAttemptAt ?? null}::timestamptz, next_attempt_at),
			attempts = attempts + ${patch.bumpAttempt === true ? 1 : 0}::integer,
			updated_at = now()
		WHERE match_id = ${matchId}
	`)
}

export async function markMatchReplayPhase(
	matchId: number,
	phase: 'awaiting_replay' | 'replay_stored' | 'replay_unavailable' | 'failed',
): Promise<void> {
	await db.execute(sql`
		UPDATE matches
		SET phase = ${phase}::match_phase, updated_at = now()
		WHERE match_id = ${matchId}
	`)
}

export function replayBackoffMs(attempts: number): number {
	const steps = [5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000]
	return (
		steps[Math.min(Math.max(attempts, 0), steps.length - 1)] ?? 6 * 60 * 60_000
	)
}
