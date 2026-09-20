import { eq } from 'drizzle-orm'
import { leagues, matches } from '#src/db/schema'
import {
	asDate,
	asItemId,
	asNumber,
	asSteamId64,
	steamId64FromAccount,
} from '#src/store/coerce'
import {
	type DraftPick,
	type MatchFacts,
	normalizeValvePlayerSlot,
	type PlayerFacts,
} from '#src/store/match-details'
import {
	advanceHistoryMiss,
	ERROR_KIND,
	INGEST,
	KEEP_ON_LIVE_SIGHTING,
	type LiveIngest,
} from '#src/store/match-phase'
import { syntheticSeriesId } from '#src/store/series-id'
import { db, type Executor, sql, sqlIn, sqlValues } from '#src/utils/db'

export type { Executor as Tx }

export type MatchWriteOpts = {
	/** Keep existing non-null values; only fill NULL / 0-empty ids. */
	fillOnly?: boolean
}

export async function matchPostgameWritten(
	tx: Executor,
	matchId: number,
): Promise<boolean> {
	const [row] = await tx.execute(sql`
		SELECT seq_fetched_at, details_fetched_at
		FROM matches
		WHERE match_id = ${matchId}
	`)
	return (
		asDate(row?.seq_fetched_at) != null ||
		asDate(row?.details_fetched_at) != null
	)
}

function takePlayerCol(
	col: string,
	fillOnly: boolean,
	zeroEmpty = false,
): ReturnType<typeof sql> {
	const name = sql.identifier(col)
	if (zeroEmpty) {
		return fillOnly
			? sql`${name} = COALESCE(NULLIF(match_players.${name}, 0), NULLIF(excluded.${name}, 0), match_players.${name})`
			: sql`${name} = COALESCE(NULLIF(excluded.${name}, 0), NULLIF(match_players.${name}, 0), 0)`
	}
	return fillOnly
		? sql`${name} = COALESCE(match_players.${name}, excluded.${name})`
		: sql`${name} = COALESCE(excluded.${name}, match_players.${name})`
}

function keepOnLiveSighting(
	statusCol: ReturnType<typeof sql>,
): ReturnType<typeof sql> {
	const phases = sql.join(
		KEEP_ON_LIVE_SIGHTING.map((phase) => sql`${phase}`),
		sql`, `,
	)
	return sql`${statusCol} IN (${phases})`
}

/** Shared flap: a live-feed sighting pulls a false finish back to `live`. */
function liveSightingResumeSet(
	statusCol: ReturnType<typeof sql>,
	col: (name: string) => ReturnType<typeof sql>,
	resetLive: boolean,
	resetTop: boolean,
): ReturnType<typeof sql> {
	const keep = keepOnLiveSighting(statusCol)
	return sql`
		status = CASE
			WHEN ${keep} THEN ${col('status')}
			ELSE 'live'::match_status
		END,
		last_error = CASE
			WHEN ${keep} THEN ${col('last_error')}
			ELSE NULL
		END,
		last_error_kind = CASE
			WHEN ${keep} THEN ${col('last_error_kind')}
			ELSE NULL
		END,
		last_error_at = CASE
			WHEN ${keep} THEN ${col('last_error_at')}
			ELSE NULL
		END,
		finished_at = CASE
			WHEN ${keep} OR ${statusCol} = 'live' THEN ${col('finished_at')}
			ELSE NULL
		END,
		replay_available_at = CASE
			WHEN ${keep} OR ${statusCol} = 'live' THEN ${col('replay_available_at')}
			ELSE NULL
		END,
		history_next_poll_at = CASE
			WHEN ${keep} OR ${statusCol} = 'live' THEN ${col('history_next_poll_at')}
			ELSE NULL
		END,
		history_poll_fast_count = CASE
			WHEN ${keep} OR ${statusCol} = 'live' THEN ${col('history_poll_fast_count')}
			ELSE 0
		END,
		history_poll_slow_count = CASE
			WHEN ${keep} OR ${statusCol} = 'live' THEN ${col('history_poll_slow_count')}
			ELSE 0
		END,
		attempts = CASE
			WHEN ${keep} OR ${statusCol} = 'live' THEN ${col('attempts')}
			ELSE 0
		END,
		next_attempt_at = CASE
			WHEN ${keep} OR ${statusCol} = 'live' THEN ${col('next_attempt_at')}
			ELSE NULL
		END,
		live_seen_at = now(),
		live_disappeared_at = CASE
			WHEN ${keep} THEN ${col('live_disappeared_at')}
			ELSE NULL
		END,
		live_league_missed_polls = CASE
			WHEN ${resetLive} THEN 0 ELSE ${col('live_league_missed_polls')}
		END,
		top_live_missed_polls = CASE
			WHEN ${resetTop} THEN 0 ELSE ${col('top_live_missed_polls')}
		END
	`
}

export async function upsertTeam(
	tx: Executor,
	teamId: number | undefined | null,
	name: string | undefined | null,
	extra?: { tag?: string | null; logoUrl?: string | null },
): Promise<void> {
	if (teamId === undefined || teamId === null || teamId === 0) return
	await tx.execute(sql`
		INSERT INTO teams (team_id, name, tag, logo_url, updated_at)
		VALUES (
			${teamId},
			${name ?? `team ${teamId}`},
			${extra?.tag ?? null},
			${extra?.logoUrl ?? null},
			now()
		)
		ON CONFLICT (team_id) DO UPDATE SET
			name = COALESCE(NULLIF(excluded.name, ''), teams.name),
			tag = COALESCE(excluded.tag, teams.tag),
			logo_url = COALESCE(excluded.logo_url, teams.logo_url),
			updated_at = now()
	`)
}

export async function upsertPlayer(
	tx: Executor,
	row: {
		accountId: number
		personaName?: string | null
		isPro?: boolean
		teamId?: number | null
		matchId?: number | null
		matchAt?: Date | null
	},
): Promise<number | null> {
	if (row.accountId <= 0) return null
	const [created] = await tx.execute(sql`
		INSERT INTO players (
			account_id, steam_id, persona_name, is_pro, current_team_id,
			last_match_id, last_match_at, updated_at
		) VALUES (
			${row.accountId},
			${steamId64FromAccount(row.accountId)},
			${row.personaName ?? null},
			${row.isPro ?? false},
			${row.teamId ?? null},
			${row.matchId ?? null},
			${row.matchAt ?? null},
			now()
		)
		ON CONFLICT (account_id) DO UPDATE SET
			steam_id = COALESCE(players.steam_id, excluded.steam_id),
			persona_name = COALESCE(players.persona_name, excluded.persona_name),
			is_pro = players.is_pro OR excluded.is_pro,
			current_team_id = COALESCE(players.current_team_id, excluded.current_team_id),
			last_match_id = COALESCE(players.last_match_id, excluded.last_match_id),
			last_match_at = COALESCE(players.last_match_at, excluded.last_match_at),
			updated_at = now()
		RETURNING id
	`)
	return asNumber(created?.id)
}

async function lookupPlayerIds(
	tx: Executor,
	accountIds: readonly number[],
): Promise<Map<number, number>> {
	const ids = [...new Set(accountIds.filter((id) => id > 0))]
	if (ids.length === 0) return new Map()
	const rows = await tx.execute(sql`
		SELECT id, account_id
		FROM players
		WHERE account_id IN ${sqlIn(ids)}
	`)
	const out = new Map<number, number>()
	for (const row of rows) {
		const accountId = asNumber(row.account_id)
		const id = asNumber(row.id)
		if (accountId != null && id != null) out.set(accountId, id)
	}
	return out
}

async function matchSideTeamIds(
	tx: Executor,
	matchId: number,
): Promise<{ radiant: number | null; dire: number | null }> {
	const [row] = await tx.execute(sql`
		SELECT radiant_team_id, dire_team_id
		FROM matches
		WHERE match_id = ${matchId}
	`)
	return {
		radiant: asNumber(row?.radiant_team_id) ?? null,
		dire: asNumber(row?.dire_team_id) ?? null,
	}
}

function sideTeamId(
	slot: number,
	sides: { radiant: number | null; dire: number | null },
): number | null {
	return slot < 128 ? sides.radiant : sides.dire
}

export async function fillMatchPlayerLinks(
	tx: Executor,
	matchId: number,
): Promise<void> {
	await tx.execute(sql`
		UPDATE match_players mp
		SET player_id = COALESCE(mp.player_id, p.id)
		FROM players p
		WHERE mp.match_id = ${matchId}
			AND mp.account_id > 0
			AND p.account_id = mp.account_id
	`)
	await tx.execute(sql`
		UPDATE match_players mp
		SET team_id = COALESCE(
			mp.team_id,
			CASE
				WHEN mp.player_slot < 128 THEN m.radiant_team_id
				ELSE m.dire_team_id
			END
		)
		FROM matches m
		WHERE mp.match_id = ${matchId}
			AND m.match_id = mp.match_id
	`)
	await tx.execute(sql`
		UPDATE match_player_buffs
		SET
			account_id = CASE
				WHEN match_player_buffs.account_id = 0 THEN mp.account_id
				ELSE match_player_buffs.account_id
			END,
			player_id = COALESCE(match_player_buffs.player_id, mp.player_id),
			team_id = COALESCE(match_player_buffs.team_id, mp.team_id)
		FROM match_players mp
		WHERE match_player_buffs.match_id = ${matchId}
			AND mp.match_id = match_player_buffs.match_id
			AND mp.player_slot = match_player_buffs.player_slot
	`)
	await tx.execute(sql`
		UPDATE match_player_ability_upgrades
		SET
			account_id = CASE
				WHEN match_player_ability_upgrades.account_id = 0
					THEN mp.account_id
				ELSE match_player_ability_upgrades.account_id
			END,
			player_id = COALESCE(
				match_player_ability_upgrades.player_id, mp.player_id
			),
			team_id = COALESCE(match_player_ability_upgrades.team_id, mp.team_id)
		FROM match_players mp
		WHERE match_player_ability_upgrades.match_id = ${matchId}
			AND mp.match_id = match_player_ability_upgrades.match_id
			AND mp.player_slot = match_player_ability_upgrades.player_slot
	`)
	await tx.execute(sql`
		UPDATE match_player_damage_breakdown
		SET
			account_id = CASE
				WHEN match_player_damage_breakdown.account_id = 0
					THEN mp.account_id
				ELSE match_player_damage_breakdown.account_id
			END,
			player_id = COALESCE(
				match_player_damage_breakdown.player_id, mp.player_id
			),
			team_id = COALESCE(match_player_damage_breakdown.team_id, mp.team_id)
		FROM match_players mp
		WHERE match_player_damage_breakdown.match_id = ${matchId}
			AND mp.match_id = match_player_damage_breakdown.match_id
			AND mp.player_slot = match_player_damage_breakdown.player_slot
	`)
	await tx.execute(sql`
		UPDATE match_player_units
		SET
			account_id = CASE
				WHEN match_player_units.account_id = 0 THEN mp.account_id
				ELSE match_player_units.account_id
			END,
			player_id = COALESCE(match_player_units.player_id, mp.player_id),
			team_id = COALESCE(match_player_units.team_id, mp.team_id)
		FROM match_players mp
		WHERE match_player_units.match_id = ${matchId}
			AND mp.match_id = match_player_units.match_id
			AND mp.player_slot = match_player_units.player_slot
	`)
	await fillDraftPlayerSlots(tx, matchId)
	await tx.execute(sql`
		UPDATE match_objectives o
		SET
			account_id = COALESCE(o.account_id, mp.account_id),
			player_id = COALESCE(o.player_id, mp.player_id),
			team_id = COALESCE(o.team_id, mp.team_id)
		FROM match_players mp
		WHERE o.match_id = ${matchId}
			AND mp.match_id = o.match_id
			AND mp.player_slot = CASE
				WHEN o.slot IS NULL THEN NULL
				WHEN o.slot BETWEEN 0 AND 4 THEN o.slot
				WHEN o.slot BETWEEN 5 AND 9 THEN o.slot + 123
				ELSE o.slot
			END
	`)
	await tx.execute(sql`
		UPDATE match_objectives o
		SET team_id = CASE
			WHEN o.team = 0 THEN m.radiant_team_id
			WHEN o.team = 1 THEN m.dire_team_id
		END
		FROM matches m
		WHERE o.match_id = ${matchId}
			AND m.match_id = o.match_id
			AND o.team_id IS NULL
			AND CASE
				WHEN o.team = 0 THEN m.radiant_team_id
				WHEN o.team = 1 THEN m.dire_team_id
			END IS NOT NULL
	`)
	await tx.execute(sql`
		UPDATE match_coaches c
		SET player_id = COALESCE(c.player_id, p.id)
		FROM players p
		WHERE c.match_id = ${matchId}
			AND c.account_id > 0
			AND p.account_id = c.account_id
	`)
	await tx.execute(sql`
		UPDATE match_coaches c
		SET team_id = CASE
			WHEN c.coach_team IN (0, 2) THEN m.radiant_team_id
			WHEN c.coach_team IN (1, 3) THEN m.dire_team_id
		END
		FROM matches m
		WHERE c.match_id = ${matchId}
			AND m.match_id = c.match_id
			AND c.team_id IS NULL
			AND CASE
				WHEN c.coach_team IN (0, 2) THEN m.radiant_team_id
				WHEN c.coach_team IN (1, 3) THEN m.dire_team_id
			END IS NOT NULL
	`)
	await tx.execute(sql`
		UPDATE match_broadcasters b
		SET player_id = COALESCE(b.player_id, p.id)
		FROM players p
		WHERE b.match_id = ${matchId}
			AND b.account_id > 0
			AND p.account_id = b.account_id
	`)
	await tx.execute(sql`
		UPDATE matches m
		SET
			radiant_captain_player_id = COALESCE(
				m.radiant_captain_player_id,
				(
					SELECT p.id
					FROM players p
					WHERE p.account_id = m.radiant_captain
						AND m.radiant_captain > 0
				)
			),
			dire_captain_player_id = COALESCE(
				m.dire_captain_player_id,
				(
					SELECT p.id
					FROM players p
					WHERE p.account_id = m.dire_captain
						AND m.dire_captain > 0
				)
			)
		WHERE m.match_id = ${matchId}
	`)
}

export async function lookupPatch(
	tx: Executor,
	startTime: number | null,
): Promise<string | null> {
	if (startTime == null || startTime <= 0) return null
	const rows = await tx.execute(sql`
		SELECT patch
		FROM patches
		WHERE released_at <= to_timestamp(${startTime})
		ORDER BY released_at DESC
		LIMIT 1
	`)
	const patch = rows[0]?.patch
	return typeof patch === 'string' ? patch : null
}

export async function upsertSeriesForMatch(
	tx: Executor,
	input: {
		valveSeriesId: number | null
		leagueId: number | null
		radiantTeamId: number | null
		direTeamId: number | null
		seriesType: number | null
		radiantWins: number | null
		direWins: number | null
		matchId: number
		startTime: number | null
	},
): Promise<number | null> {
	const radiant = input.radiantTeamId ?? 0
	const dire = input.direTeamId ?? 0
	let seriesId =
		input.valveSeriesId != null && input.valveSeriesId > 0
			? input.valveSeriesId
			: null

	if (seriesId == null && input.leagueId != null && radiant > 0 && dire > 0) {
		const existing = await tx.execute(sql`
			SELECT series_id
			FROM series
			WHERE league_id = ${input.leagueId}
				AND (
					(radiant_team_id = ${radiant} AND dire_team_id = ${dire})
					OR (radiant_team_id = ${dire} AND dire_team_id = ${radiant})
				)
				AND ended_at IS NULL
				AND updated_at > now() - interval '8 hours'
			ORDER BY updated_at DESC
			LIMIT 1
		`)
		const found = asNumber(existing[0]?.series_id)
		if (found != null) seriesId = found
		else {
			seriesId = syntheticSeriesId({
				leagueId: input.leagueId,
				teamA: radiant,
				teamB: dire,
				firstMatchId: input.matchId,
			})
		}
	}

	if (seriesId == null) return null

	const startedAt =
		input.startTime != null && input.startTime > 0
			? new Date(input.startTime * 1000)
			: null

	await tx.execute(sql`
		INSERT INTO series (
			series_id, league_id, radiant_team_id, dire_team_id, series_type,
			radiant_wins, dire_wins, first_match_id,
			started_at, ended_at, updated_at
		) VALUES (
			${seriesId},
			${input.leagueId},
			${radiant || null},
			${dire || null},
			${input.seriesType ?? 0},
			${input.radiantWins ?? 0},
			${input.direWins ?? 0},
			${input.matchId},
			${startedAt},
			CASE
				WHEN GREATEST(
					${input.radiantWins ?? 0},
					${input.direWins ?? 0}
				) >= CASE ${input.seriesType ?? 0}
					WHEN 1 THEN 2
					WHEN 2 THEN 3
					ELSE NULL
				END
				THEN now()
				ELSE NULL
			END,
			now()
		)
		ON CONFLICT (series_id) DO UPDATE SET
			league_id = COALESCE(excluded.league_id, series.league_id),
			radiant_wins = GREATEST(series.radiant_wins, excluded.radiant_wins),
			dire_wins = GREATEST(series.dire_wins, excluded.dire_wins),
			ended_at = CASE
				WHEN GREATEST(
					GREATEST(series.radiant_wins, excluded.radiant_wins),
					GREATEST(series.dire_wins, excluded.dire_wins)
				) >= CASE COALESCE(excluded.series_type, series.series_type)
					WHEN 1 THEN 2
					WHEN 2 THEN 3
					ELSE NULL
				END
				THEN COALESCE(series.ended_at, now())
				ELSE series.ended_at
			END,
			updated_at = now()
	`)
	return seriesId
}

export async function touchMatchLive(
	tx: Executor,
	row: {
		matchId: number
		leagueId: number
		leagueNodeId: number | null
		seriesId: number | null
		seriesType: number | null
		radiantSeriesWins: number | null
		direSeriesWins: number | null
		streamDelayS: number | null
		radiantTeamId: number | null
		direTeamId: number | null
		radiantTeamName: string | null
		direTeamName: string | null
		lobbyId?: number | null
		gameNumber?: number | null
		leagueSeriesId?: number | null
		leagueGameId?: number | null
		stageName?: string | null
		leagueTier?: number | null
		radiantTeamLogo?: number | null
		direTeamLogo?: number | null
		radiantTeamComplete?: number | null
		direTeamComplete?: number | null
		ingest?: LiveIngest
		serverSteamId?: string | number | null
	},
): Promise<void> {
	const ingest = row.ingest ?? INGEST.liveLeague
	const resetLive = ingest === INGEST.liveLeague
	const resetTop = ingest === INGEST.topLive
	await tx.execute(sql`
		INSERT INTO matches (
			match_id, league_id, league_node_id, series_id, series_type,
			radiant_series_wins, dire_series_wins, stream_delay_s,
			radiant_team_id, dire_team_id, radiant_team_name, dire_team_name,
			lobby_id, game_number, league_series_id, league_game_id,
			stage_name, league_tier, radiant_team_logo, dire_team_logo,
			radiant_team_complete, dire_team_complete, server_steam_id,
			ingest_sources,
			status, source, live_seen_at, live_disappeared_at, updated_at
		) VALUES (
			${row.matchId}, ${row.leagueId}, ${row.leagueNodeId}, ${row.seriesId},
			${row.seriesType}, ${row.radiantSeriesWins}, ${row.direSeriesWins},
			${row.streamDelayS}, ${row.radiantTeamId}, ${row.direTeamId},
			${row.radiantTeamName}, ${row.direTeamName},
			${row.lobbyId ?? null}, ${row.gameNumber ?? null},
			${row.leagueSeriesId ?? null}, ${row.leagueGameId ?? null},
			${row.stageName ?? null}, ${row.leagueTier ?? null},
			${row.radiantTeamLogo ?? null}, ${row.direTeamLogo ?? null},
			${row.radiantTeamComplete ?? null}, ${row.direTeamComplete ?? null},
			${asSteamId64(row.serverSteamId) ?? null}::bigint,
			ARRAY[${ingest}]::text[],
			'live'::match_status, 'live'::match_source,
			now(), NULL, now()
		)
		ON CONFLICT (match_id) DO UPDATE SET
			league_id = COALESCE(excluded.league_id, matches.league_id),
			league_node_id = COALESCE(excluded.league_node_id, matches.league_node_id),
			series_id = COALESCE(excluded.series_id, matches.series_id),
			series_type = COALESCE(excluded.series_type, matches.series_type),
			radiant_series_wins = COALESCE(excluded.radiant_series_wins, matches.radiant_series_wins),
			dire_series_wins = COALESCE(excluded.dire_series_wins, matches.dire_series_wins),
			stream_delay_s = COALESCE(excluded.stream_delay_s, matches.stream_delay_s),
			radiant_team_id = COALESCE(excluded.radiant_team_id, matches.radiant_team_id),
			dire_team_id = COALESCE(excluded.dire_team_id, matches.dire_team_id),
			radiant_team_name = COALESCE(excluded.radiant_team_name, matches.radiant_team_name),
			dire_team_name = COALESCE(excluded.dire_team_name, matches.dire_team_name),
			lobby_id = COALESCE(excluded.lobby_id, matches.lobby_id),
			game_number = COALESCE(excluded.game_number, matches.game_number),
			league_series_id = COALESCE(excluded.league_series_id, matches.league_series_id),
			league_game_id = COALESCE(excluded.league_game_id, matches.league_game_id),
			stage_name = COALESCE(excluded.stage_name, matches.stage_name),
			league_tier = COALESCE(excluded.league_tier, matches.league_tier),
			radiant_team_logo = COALESCE(excluded.radiant_team_logo, matches.radiant_team_logo),
			dire_team_logo = COALESCE(excluded.dire_team_logo, matches.dire_team_logo),
			radiant_team_complete = COALESCE(excluded.radiant_team_complete, matches.radiant_team_complete),
			dire_team_complete = COALESCE(excluded.dire_team_complete, matches.dire_team_complete),
			server_steam_id = COALESCE(excluded.server_steam_id, matches.server_steam_id),
			ingest_sources = CASE
				WHEN matches.ingest_sources @> ARRAY[${ingest}]::text[]
					THEN matches.ingest_sources
				ELSE matches.ingest_sources || ${ingest}::text
			END,
			source = 'live'::match_source,
			${liveSightingResumeSet(
				sql`matches.status`,
				(name) => sql.raw(`matches.${name}`),
				resetLive,
				resetTop,
			)},
			updated_at = now()
	`)
}

export async function noteLiveFeedSeen(
	tx: Executor,
	feed: LiveIngest,
	matchId: number,
): Promise<void> {
	const resetLive = feed === INGEST.liveLeague
	const resetTop = feed === INGEST.topLive
	await tx.execute(sql`
		UPDATE matches
		SET
			${liveSightingResumeSet(
				sql`status`,
				(name) => sql.raw(name),
				resetLive,
				resetTop,
			)},
			updated_at = now()
		WHERE match_id = ${matchId}
	`)
}

export async function noteLiveFeedMisses(
	tx: Executor,
	feed: LiveIngest,
	seenIds: readonly number[],
): Promise<void> {
	const column =
		feed === INGEST.liveLeague
			? sql`live_league_missed_polls`
			: sql`top_live_missed_polls`
	const notSeen =
		seenIds.length === 0 ? sql`TRUE` : sql`match_id NOT IN ${sqlIn(seenIds)}`
	await tx.execute(sql`
		UPDATE matches
		SET ${column} = ${column} + 1, updated_at = now()
		WHERE status = 'live'
			AND ingest_sources @> ARRAY[${feed}]::text[]
			AND ${notSeen}
	`)
}

export async function noteLiveClock(
	tx: Executor,
	matchId: number,
	duration: number,
): Promise<void> {
	if (!(duration > 0)) return
	await tx.execute(sql`
		UPDATE matches
		SET
			live_duration_max = GREATEST(live_duration_max, ${duration}::real),
			updated_at = now()
		WHERE match_id = ${matchId}
	`)
}

export async function finishMissingLiveMatches(
	tx: Executor,
	threshold: number,
	replayDelayMs: number,
): Promise<number[]> {
	const delaySec = Math.round(replayDelayMs / 1000)
	const rows = await tx.execute(sql`
		UPDATE matches
		SET
			live_disappeared_at = now(),
			live_disappeared_count = live_disappeared_count + 1,
			finished_at = CASE
				WHEN live_duration_max > 0 THEN now()
				ELSE finished_at
			END,
			replay_available_at = CASE
				WHEN live_duration_max > 0
					THEN now() + ${delaySec} * interval '1 second'
				ELSE replay_available_at
			END,
			status = CASE
				WHEN live_duration_max > 0 THEN 'awaiting_history'::match_status
				ELSE 'not_started'::match_status
			END,
			history_next_poll_at = CASE
				WHEN live_duration_max > 0 THEN now()
				ELSE NULL
			END,
			last_error = CASE
				WHEN live_duration_max > 0 THEN last_error
				ELSE 'live listing never started'
			END,
			last_error_kind = CASE
				WHEN live_duration_max > 0 THEN last_error_kind
				ELSE ${ERROR_KIND.notStarted}
			END,
			last_error_at = CASE
				WHEN live_duration_max > 0 THEN last_error_at
				ELSE now()
			END,
			updated_at = now()
		WHERE status = 'live'
			AND (
				ingest_sources @> ARRAY[${INGEST.liveLeague}]::text[]
				OR ingest_sources @> ARRAY[${INGEST.topLive}]::text[]
			)
			AND (
				NOT ingest_sources @> ARRAY[${INGEST.liveLeague}]::text[]
				OR live_league_missed_polls >= ${threshold}
			)
			AND (
				NOT ingest_sources @> ARRAY[${INGEST.topLive}]::text[]
				OR top_live_missed_polls >= ${threshold}
			)
		RETURNING match_id
	`)
	return rows
		.map((row) => asNumber(row.match_id))
		.filter((id): id is number => id != null)
}

export async function clearServerSteamId(
	matchId: number,
	tx?: Executor,
): Promise<void> {
	const exec = tx ?? db
	await exec.execute(sql`
		UPDATE matches
		SET server_steam_id = NULL, updated_at = now()
		WHERE match_id = ${matchId}
	`)
}

export async function touchRealtimeSeen(
	tx: Executor,
	matchId: number,
): Promise<void> {
	await tx.execute(sql`
		UPDATE matches
		SET last_realtime_at = now(), updated_at = now()
		WHERE match_id = ${matchId}
	`)
}

export async function listLiveRealtimeTargets(
	limit: number,
): Promise<Array<{ matchId: number; serverSteamId: string }>> {
	const rows = await db.execute(sql`
		SELECT match_id, server_steam_id::text AS server_steam_id
		FROM matches
		WHERE status = 'live' AND server_steam_id IS NOT NULL
		ORDER BY last_realtime_at NULLS FIRST, match_id
		LIMIT ${limit}
	`)
	const out: Array<{ matchId: number; serverSteamId: string }> = []
	for (const row of rows) {
		const matchId = asNumber(row.match_id)
		const serverSteamId = asSteamId64(row.server_steam_id)
		if (matchId == null || serverSteamId == null) continue
		out.push({ matchId, serverSteamId })
	}
	return out
}

/** Live-finish waiter is armed until GetMatchHistory stores a seqnum. */
function historyWaiterPending(): ReturnType<typeof sql> {
	return sql`history_next_poll_at IS NOT NULL AND match_seq_num IS NULL`
}

export async function listDueHistoryLeagueIds(): Promise<number[]> {
	const rows = await db.execute(sql`
		SELECT DISTINCT league_id
		FROM matches
		WHERE ${historyWaiterPending()}
			AND league_id IS NOT NULL
			AND history_next_poll_at <= now()
		ORDER BY league_id
	`)
	return rows
		.map((row) => asNumber(row.league_id))
		.filter((id): id is number => id != null)
}

export async function listAwaitingHistoryMatchIds(
	leagueId: number,
): Promise<number[]> {
	const rows = await db.execute(sql`
		SELECT match_id
		FROM matches
		WHERE league_id = ${leagueId}
			AND ${historyWaiterPending()}
	`)
	return rows
		.map((row) => asNumber(row.match_id))
		.filter((id): id is number => id != null)
}

export async function markHistoryAvailable(
	tx: Executor,
	row: {
		matchId: number
		leagueId: number
		matchSeqNum: number
		startTime: number
		lobbyType: number
		seriesId: number | null
		seriesType: number | null
		radiantTeamId: number | null
		direTeamId: number | null
	},
): Promise<void> {
	const patch = await lookupPatch(tx, row.startTime)
	await tx.execute(sql`
		UPDATE matches
		SET
			league_id = COALESCE(${row.leagueId}, league_id),
			match_seq_num = COALESCE(${row.matchSeqNum}, match_seq_num),
			start_time = COALESCE(${row.startTime}, start_time),
			lobby_type = COALESCE(${row.lobbyType}, lobby_type),
			series_id = COALESCE(${row.seriesId}, series_id),
			series_type = COALESCE(${row.seriesType}, series_type),
			radiant_team_id = COALESCE(${row.radiantTeamId}, radiant_team_id),
			dire_team_id = COALESCE(${row.direTeamId}, dire_team_id),
			patch = COALESCE(patch, ${patch}),
			ingest_sources = CASE
				WHEN ingest_sources @> ARRAY[${INGEST.history}]::text[]
					THEN ingest_sources
				ELSE ingest_sources || ${INGEST.history}::text
			END,
			status = CASE
				WHEN status IN (
					'awaiting_history', 'not_started', 'discovered', 'failed'
				) THEN 'awaiting_details'::match_status
				ELSE status
			END,
			history_last_polled_at = now(),
			history_next_poll_at = NULL,
			updated_at = now()
		WHERE match_id = ${row.matchId}
			AND status <> 'live'
	`)
}

export async function recordHistoryPollMisses(
	tx: Executor,
	matchIds: readonly number[],
	input: {
		fastLimit: number
		slowLimit: number
		fastMs: number
		slowMs: number
	},
): Promise<void> {
	if (matchIds.length === 0) return
	const rows = await tx.execute(sql`
		SELECT match_id, status, history_poll_fast_count, history_poll_slow_count
		FROM matches
		WHERE match_id IN ${sqlIn(matchIds)}
			AND ${historyWaiterPending()}
	`)
	for (const row of rows) {
		const matchId = asNumber(row.match_id)
		if (matchId == null) continue
		const next = advanceHistoryMiss({
			fastCount: asNumber(row.history_poll_fast_count) ?? 0,
			slowCount: asNumber(row.history_poll_slow_count) ?? 0,
			fastLimit: input.fastLimit,
			slowLimit: input.slowLimit,
			fastMs: input.fastMs,
			slowMs: input.slowMs,
		})
		const waiterDone = next.status === 'failed'
		const failMatch = waiterDone && row.status === 'awaiting_history'
		const nextAt = waiterDone ? null : new Date(Date.now() + next.nextPollMs)
		await tx.execute(sql`
			UPDATE matches
			SET
				history_poll_fast_count = ${next.fastCount},
				history_poll_slow_count = ${next.slowCount},
				history_last_polled_at = now(),
				history_next_poll_at = ${nextAt},
				status = CASE
					WHEN ${failMatch} THEN 'failed'::match_status
					ELSE status
				END,
				last_error = CASE
					WHEN ${failMatch} THEN 'history_timeout'
					ELSE last_error
				END,
				last_error_kind = CASE
					WHEN ${failMatch} THEN ${ERROR_KIND.historyTimeout}
					ELSE last_error_kind
				END,
				last_error_at = CASE
					WHEN ${failMatch} THEN now()
					ELSE last_error_at
				END,
				updated_at = now()
			WHERE match_id = ${matchId}
		`)
	}
}

export async function upsertMatchPlayers(
	tx: Executor,
	matchId: number,
	players: readonly PlayerFacts[],
	opts?: MatchWriteOpts,
): Promise<void> {
	const fillOnly = opts?.fillOnly === true
	if (players.length === 0) return
	const playerIds = await lookupPlayerIds(
		tx,
		players.map((player) => player.accountId),
	)
	const sides = await matchSideTeamIds(tx, matchId)
	const resolved = players.flatMap((player) => {
		const playerSlot = normalizeValvePlayerSlot(player.playerSlot)
		if (playerSlot === null) return []
		return [
			{
				player,
				playerSlot,
				playerId:
					player.accountId > 0
						? (playerIds.get(player.accountId) ?? null)
						: null,
				teamId: sideTeamId(playerSlot, sides),
			},
		]
	})
	if (resolved.length === 0) return
	const rows = resolved.map(({ player, playerSlot, playerId, teamId }) => ({
		match_id: matchId,
		account_id: player.accountId,
		player_id: playerId,
		team_id: teamId,
		player_slot: playerSlot,
		hero_id: player.heroId,
		hero_variant: player.heroVariant,
		player_name: player.playerName,
		pro_name: player.proName,
		real_name: player.realName,
		team_number: player.teamNumber,
		team_slot: player.teamSlot,
		side: playerSlot < 128 ? 'radiant' : 'dire',
		kills: player.kills,
		deaths: player.deaths,
		assists: player.assists,
		last_hits: player.lastHits,
		denies: player.denies,
		gold: player.gold,
		gold_spent: player.goldSpent,
		level: player.level,
		gold_per_min: player.goldPerMin,
		xp_per_min: player.xpPerMin,
		net_worth: player.netWorth,
		hero_damage: player.heroDamage,
		tower_damage: player.towerDamage,
		hero_healing: player.heroHealing,
		scaled_hero_damage: player.scaledHeroDamage,
		scaled_tower_damage: player.scaledTowerDamage,
		scaled_hero_healing: player.scaledHeroHealing,
		item_0: asItemId(player.item0),
		item_1: asItemId(player.item1),
		item_2: asItemId(player.item2),
		item_3: asItemId(player.item3),
		item_4: asItemId(player.item4),
		item_5: asItemId(player.item5),
		item_neutral: asItemId(player.itemNeutral),
		item_neutral2: asItemId(player.itemNeutral2),
		item_6: asItemId(player.item6),
		item_7: asItemId(player.item7),
		item_8: asItemId(player.item8),
		item_9: asItemId(player.item9),
		item_10: asItemId(player.item10),
		item_10_lvl: player.item10Lvl,
		backpack_0: asItemId(player.backpack0),
		backpack_1: asItemId(player.backpack1),
		backpack_2: asItemId(player.backpack2),
		selected_facet: player.selectedFacet,
		aghanims_scepter: player.aghanimsScepter,
		aghanims_shard: player.aghanimsShard,
		moonshard: player.moonshard,
		ability_upgrades: player.abilityUpgrades,
		leaver_status: player.leaverStatus,
		party_id: player.partyId,
		claimed_farm_gold: player.claimedFarmGold,
		support_gold: player.supportGold,
		claimed_denies: player.claimedDenies,
		claimed_misses: player.claimedMisses,
		misses: player.misses,
		support_ability_value: player.supportAbilityValue,
		scaled_kills: player.scaledKills,
		scaled_deaths: player.scaledDeaths,
		scaled_assists: player.scaledAssists,
		hero_pick_order: player.heroPickOrder,
		hero_was_randomed: player.heroWasRandomed,
		seconds_dead: player.secondsDead,
		gold_lost_to_death: player.goldLostToDeath,
		lane_selection_flags: player.laneSelectionFlags,
		bounty_runes: player.bountyRunes,
		outposts_captured: player.outpostsCaptured,
		disable_duration: player.disableDuration,
		updated_at: new Date(),
	}))
	const zeroIds = new Set([
		'account_id',
		'hero_id',
		'item_0',
		'item_1',
		'item_2',
		'item_3',
		'item_4',
		'item_5',
		'item_neutral',
		'item_neutral2',
		'item_6',
		'item_7',
		'item_8',
		'item_9',
		'item_10',
		'backpack_0',
		'backpack_1',
		'backpack_2',
	])
	const playerCols = [
		'account_id',
		'hero_id',
		'hero_variant',
		'player_name',
		'pro_name',
		'real_name',
		'team_number',
		'team_slot',
		'kills',
		'deaths',
		'assists',
		'last_hits',
		'denies',
		'gold',
		'gold_spent',
		'level',
		'gold_per_min',
		'xp_per_min',
		'net_worth',
		'hero_damage',
		'tower_damage',
		'hero_healing',
		'scaled_hero_damage',
		'scaled_tower_damage',
		'scaled_hero_healing',
		'item_0',
		'item_1',
		'item_2',
		'item_3',
		'item_4',
		'item_5',
		'item_neutral',
		'item_neutral2',
		'item_6',
		'item_7',
		'item_8',
		'item_9',
		'item_10',
		'item_10_lvl',
		'backpack_0',
		'backpack_1',
		'backpack_2',
		'selected_facet',
		'aghanims_scepter',
		'aghanims_shard',
		'moonshard',
		'ability_upgrades',
		'leaver_status',
		'party_id',
		'claimed_farm_gold',
		'support_gold',
		'claimed_denies',
		'claimed_misses',
		'misses',
		'support_ability_value',
		'scaled_kills',
		'scaled_deaths',
		'scaled_assists',
		'hero_pick_order',
		'hero_was_randomed',
		'seconds_dead',
		'gold_lost_to_death',
		'lane_selection_flags',
		'bounty_runes',
		'outposts_captured',
		'disable_duration',
	]
	await tx.execute(sql`
		INSERT INTO match_players ${sqlValues(rows)}
		ON CONFLICT (match_id, player_slot) DO UPDATE SET
			${sql.join(
				[
					...playerCols.map((col) =>
						takePlayerCol(col, fillOnly, zeroIds.has(col)),
					),
					fillOnly ? sql`side = match_players.side` : sql`side = excluded.side`,
					sql`player_id = COALESCE(match_players.player_id, excluded.player_id)`,
					sql`team_id = COALESCE(match_players.team_id, excluded.team_id)`,
					sql`updated_at = now()`,
				],
				sql`, `,
			)}
	`)

	for (const { player, playerSlot, playerId, teamId } of resolved) {
		if (player.buffs.length > 0) {
			await tx.execute(sql`
				INSERT INTO match_player_buffs ${sqlValues(
					player.buffs.map((buff) => ({
						match_id: matchId,
						player_slot: playerSlot,
						account_id: player.accountId,
						player_id: playerId,
						team_id: teamId,
						buff_id: buff.buffId,
						stacks: buff.stacks,
						grant_time: buff.grantTime,
					})),
				)}
				ON CONFLICT (match_id, player_slot, buff_id) DO UPDATE SET
					stacks = ${
						fillOnly
							? sql`COALESCE(match_player_buffs.stacks, excluded.stacks)`
							: sql`COALESCE(excluded.stacks, match_player_buffs.stacks)`
					},
					grant_time = COALESCE(
						match_player_buffs.grant_time, excluded.grant_time
					),
					account_id = COALESCE(
						NULLIF(match_player_buffs.account_id, 0),
						NULLIF(excluded.account_id, 0),
						match_player_buffs.account_id
					),
					player_id = COALESCE(
						match_player_buffs.player_id, excluded.player_id
					),
					team_id = COALESCE(match_player_buffs.team_id, excluded.team_id)
			`)
		}
		if (player.units.length > 0) {
			await tx.execute(sql`
				INSERT INTO match_player_units ${sqlValues(
					player.units.map((unit) => ({
						match_id: matchId,
						player_slot: playerSlot,
						account_id: player.accountId,
						player_id: playerId,
						team_id: teamId,
						unit_name: unit.unitName,
						item_0: unit.item0,
						item_1: unit.item1,
						item_2: unit.item2,
						item_3: unit.item3,
						item_4: unit.item4,
						item_5: unit.item5,
					})),
				)}
				ON CONFLICT (match_id, player_slot, unit_name) DO UPDATE SET
					item_0 = COALESCE(NULLIF(match_player_units.item_0, 0), NULLIF(excluded.item_0, 0), match_player_units.item_0),
					item_1 = COALESCE(NULLIF(match_player_units.item_1, 0), NULLIF(excluded.item_1, 0), match_player_units.item_1),
					item_2 = COALESCE(NULLIF(match_player_units.item_2, 0), NULLIF(excluded.item_2, 0), match_player_units.item_2),
					item_3 = COALESCE(NULLIF(match_player_units.item_3, 0), NULLIF(excluded.item_3, 0), match_player_units.item_3),
					item_4 = COALESCE(NULLIF(match_player_units.item_4, 0), NULLIF(excluded.item_4, 0), match_player_units.item_4),
					item_5 = COALESCE(NULLIF(match_player_units.item_5, 0), NULLIF(excluded.item_5, 0), match_player_units.item_5),
					account_id = COALESCE(
						NULLIF(match_player_units.account_id, 0),
						NULLIF(excluded.account_id, 0),
						match_player_units.account_id
					),
					player_id = COALESCE(
						match_player_units.player_id, excluded.player_id
					),
					team_id = COALESCE(match_player_units.team_id, excluded.team_id)
			`)
		}
		if (player.abilityUpgradeRows.length > 0) {
			await tx.execute(sql`
				INSERT INTO match_player_ability_upgrades ${sqlValues(
					player.abilityUpgradeRows.map((row) => ({
						match_id: matchId,
						player_slot: playerSlot,
						account_id: player.accountId,
						player_id: playerId,
						team_id: teamId,
						seq: row.seq,
						ability_id: row.abilityId,
						time: row.time,
						level: row.level,
					})),
				)}
				ON CONFLICT (match_id, player_slot, seq) DO UPDATE SET
					ability_id = COALESCE(
						NULLIF(match_player_ability_upgrades.ability_id, 0),
						NULLIF(excluded.ability_id, 0),
						match_player_ability_upgrades.ability_id
					),
					time = COALESCE(
						match_player_ability_upgrades.time, excluded.time
					),
					level = COALESCE(
						match_player_ability_upgrades.level, excluded.level
					),
					account_id = COALESCE(
						NULLIF(match_player_ability_upgrades.account_id, 0),
						NULLIF(excluded.account_id, 0),
						match_player_ability_upgrades.account_id
					),
					player_id = COALESCE(
						match_player_ability_upgrades.player_id, excluded.player_id
					),
					team_id = COALESCE(
						match_player_ability_upgrades.team_id, excluded.team_id
					)
			`)
		}
		if (player.damageBreakdown.length > 0) {
			await tx.execute(sql`
				INSERT INTO match_player_damage_breakdown ${sqlValues(
					player.damageBreakdown.map((row) => ({
						match_id: matchId,
						player_slot: playerSlot,
						account_id: player.accountId,
						player_id: playerId,
						team_id: teamId,
						direction: row.direction,
						damage_type: row.damageType,
						pre_reduction: row.preReduction,
						post_reduction: row.postReduction,
					})),
				)}
				ON CONFLICT (match_id, player_slot, direction, damage_type)
				DO UPDATE SET
					pre_reduction = COALESCE(
						match_player_damage_breakdown.pre_reduction,
						excluded.pre_reduction
					),
					post_reduction = COALESCE(
						match_player_damage_breakdown.post_reduction,
						excluded.post_reduction
					),
					account_id = COALESCE(
						NULLIF(match_player_damage_breakdown.account_id, 0),
						NULLIF(excluded.account_id, 0),
						match_player_damage_breakdown.account_id
					),
					player_id = COALESCE(
						match_player_damage_breakdown.player_id, excluded.player_id
					),
					team_id = COALESCE(
						match_player_damage_breakdown.team_id, excluded.team_id
					)
			`)
		}
	}
	await fillDraftPlayerSlots(tx, matchId)
}

export async function replaceMatchDraft(
	tx: Executor,
	matchId: number,
	rows: readonly DraftPick[],
	opts?: MatchWriteOpts,
): Promise<void> {
	if (rows.length === 0) return
	const [counts] = await tx.execute(sql`
		SELECT
			count(*) FILTER (WHERE hero_id > 0) AS n,
			count(*) FILTER (WHERE is_pick AND hero_id > 0) AS picks,
			count(*) FILTER (WHERE clock IS NOT NULL AND clock <> 0) AS clocks
		FROM match_draft
		WHERE match_id = ${matchId}
	`)
	const existingComplete = draftLooksComplete(
		asNumber(counts?.n) ?? 0,
		asNumber(counts?.picks) ?? 0,
	)
	const existingHasClock = (asNumber(counts?.clocks) ?? 0) > 0
	if (opts?.fillOnly === true || (existingComplete && existingHasClock)) {
		await stampDraftClocks(tx, matchId, rows)
		await fillDraftPlayerSlots(tx, matchId)
		return
	}
	const previous = await tx.execute(sql`
		SELECT hero_id, is_pick, clock
		FROM match_draft
		WHERE match_id = ${matchId}
			AND clock IS NOT NULL
			AND clock <> 0
	`)
	const clocks = new Map<string, number>()
	for (const row of previous) {
		const heroId = asNumber(row.hero_id)
		const clock = asNumber(row.clock)
		if (heroId == null || clock == null) continue
		clocks.set(`${heroId}:${row.is_pick === true}`, clock)
	}
	await tx.execute(sql`DELETE FROM match_draft WHERE match_id = ${matchId}`)
	const sides = await matchSideTeamIds(tx, matchId)
	await tx.execute(sql`
		INSERT INTO match_draft ${sqlValues(
			rows.map((row) => ({
				match_id: matchId,
				ord: row.ord,
				is_pick: row.isPick,
				hero_id: row.heroId,
				team: row.team,
				player_slot: row.playerSlot ?? null,
				team_id: row.team === 0 ? sides.radiant : sides.dire,
				clock: row.clock ?? clocks.get(`${row.heroId}:${row.isPick}`) ?? null,
			})),
		)}
	`)
	await fillDraftPlayerSlots(tx, matchId)
}

function draftLooksComplete(n: number, picks: number): boolean {
	return n >= 20 && n <= 32 && picks >= 10
}

async function stampDraftClocks(
	tx: Executor,
	matchId: number,
	rows: readonly DraftPick[],
): Promise<void> {
	for (const row of rows) {
		if (row.clock == null || row.clock === 0) continue
		await tx.execute(sql`
			UPDATE match_draft
			SET clock = ${row.clock}, updated_at = now()
			WHERE match_id = ${matchId}
				AND hero_id = ${row.heroId}
				AND is_pick = ${row.isPick}
				AND (clock IS NULL OR clock = 0)
		`)
	}
}

export async function fillDraftPlayerSlots(
	tx: Executor,
	matchId: number,
): Promise<void> {
	await tx.execute(sql`
		UPDATE match_draft AS d
		SET player_slot = p.player_slot
		FROM match_players AS p
		WHERE d.match_id = ${matchId}
			AND p.match_id = d.match_id
			AND d.is_pick
			AND d.hero_id <> 0
			AND p.hero_id = d.hero_id
			AND d.player_slot IS NULL
	`)
	await tx.execute(sql`
		UPDATE match_draft AS d
		SET
			account_id = COALESCE(d.account_id, p.account_id),
			player_id = COALESCE(d.player_id, p.player_id),
			team_id = COALESCE(d.team_id, p.team_id)
		FROM match_players AS p
		WHERE d.match_id = ${matchId}
			AND p.match_id = d.match_id
			AND p.player_slot = d.player_slot
	`)
	await tx.execute(sql`
		UPDATE match_draft AS d
		SET team_id = CASE
			WHEN d.team = 0 THEN m.radiant_team_id
			ELSE m.dire_team_id
		END
		FROM matches m
		WHERE d.match_id = ${matchId}
			AND m.match_id = d.match_id
			AND d.team_id IS NULL
			AND CASE
				WHEN d.team = 0 THEN m.radiant_team_id
				ELSE m.dire_team_id
			END IS NOT NULL
	`)
}

export async function upsertHistoryMatches(
	tx: Executor,
	rows: ReadonlyArray<{
		match_id: number
		league_id: number
		match_seq_num: number
		start_time: number
		lobby_type: number
		series_id: number | null
		series_type: number | null
		radiant_team_id: number | null
		dire_team_id: number | null
	}>,
): Promise<void> {
	if (rows.length === 0) return
	for (const row of rows) {
		const patch = await lookupPatch(tx, row.start_time)
		await tx.execute(sql`
			INSERT INTO matches (
				match_id, league_id, match_seq_num, start_time, lobby_type,
				series_id, series_type, radiant_team_id, dire_team_id,
				patch, status, source, ingest_sources,
				created_at, updated_at
			) VALUES (
				${row.match_id}, ${row.league_id}, ${row.match_seq_num},
				${row.start_time}, ${row.lobby_type}, ${row.series_id || null},
				${row.series_type}, ${row.radiant_team_id}, ${row.dire_team_id},
				${patch}, 'awaiting_details'::match_status, 'historical'::match_source,
				ARRAY[${INGEST.history}]::text[],
				now(), now()
			)
			ON CONFLICT (match_id) DO UPDATE SET
				league_id = COALESCE(excluded.league_id, matches.league_id),
				match_seq_num = COALESCE(excluded.match_seq_num, matches.match_seq_num),
				start_time = COALESCE(excluded.start_time, matches.start_time),
				lobby_type = COALESCE(excluded.lobby_type, matches.lobby_type),
				series_id = COALESCE(excluded.series_id, matches.series_id),
				series_type = COALESCE(excluded.series_type, matches.series_type),
				radiant_team_id = COALESCE(excluded.radiant_team_id, matches.radiant_team_id),
				dire_team_id = COALESCE(excluded.dire_team_id, matches.dire_team_id),
				patch = COALESCE(matches.patch, excluded.patch),
				ingest_sources = CASE
					WHEN matches.ingest_sources @> ARRAY[${INGEST.history}]::text[]
						THEN matches.ingest_sources
					ELSE matches.ingest_sources || ${INGEST.history}::text
				END,
				status = CASE
					WHEN matches.status IN (
						'live', 'details_ready', 'awaiting_replay', 'replay_stored',
						'replay_unavailable', 'parsed', 'failed'
					) THEN matches.status
					ELSE 'awaiting_details'::match_status
				END,
				updated_at = now()
		`)
	}
}

export async function saveMatchFacts(
	tx: Executor,
	facts: MatchFacts,
	fetched: 'seq' | 'gc' = 'gc',
): Promise<void> {
	const patch = await lookupPatch(tx, facts.startTime)
	const finishedAt =
		facts.startTime != null && facts.duration != null
			? new Date((facts.startTime + facts.duration) * 1000)
			: null
	await tx.execute(sql`
		UPDATE matches SET
			match_seq_num = COALESCE(match_seq_num, ${facts.matchSeqNum}),
			league_id = COALESCE(league_id, ${facts.leagueId}),
			start_time = COALESCE(start_time, ${facts.startTime}),
			duration = COALESCE(duration, ${facts.duration}),
			pre_game_duration = COALESCE(pre_game_duration, ${facts.preGameDuration}),
			radiant_win = COALESCE(radiant_win, ${facts.radiantWin}),
			radiant_score = COALESCE(radiant_score, ${facts.radiantScore}),
			dire_score = COALESCE(dire_score, ${facts.direScore}),
			tower_status_radiant = COALESCE(tower_status_radiant, ${facts.towerStatusRadiant ?? null}),
			tower_status_dire = COALESCE(tower_status_dire, ${facts.towerStatusDire ?? null}),
			barracks_status_radiant = COALESCE(barracks_status_radiant, ${facts.barracksStatusRadiant ?? null}),
			barracks_status_dire = COALESCE(barracks_status_dire, ${facts.barracksStatusDire ?? null}),
			first_blood_time = COALESCE(first_blood_time, ${facts.firstBloodTime}),
			lobby_type = COALESCE(lobby_type, ${facts.lobbyType}),
			lobby_id = COALESCE(lobby_id, ${facts.lobbyId}),
			game_mode = COALESCE(game_mode, ${facts.gameMode}),
			engine = COALESCE(engine, ${facts.engine}),
			human_players = COALESCE(human_players, ${facts.humanPlayers}),
			cluster = COALESCE(cluster, ${facts.cluster}),
			replay_salt = COALESCE(replay_salt, ${facts.replaySalt}),
			series_type = COALESCE(series_type, ${facts.seriesType}),
			radiant_team_id = COALESCE(radiant_team_id, ${facts.radiantTeamId}),
			dire_team_id = COALESCE(dire_team_id, ${facts.direTeamId}),
			radiant_team_name = COALESCE(radiant_team_name, ${facts.radiantTeamName}),
			dire_team_name = COALESCE(dire_team_name, ${facts.direTeamName}),
			radiant_team_complete = COALESCE(radiant_team_complete, ${facts.radiantTeamComplete}),
			dire_team_complete = COALESCE(dire_team_complete, ${facts.direTeamComplete}),
			radiant_captain = COALESCE(radiant_captain, ${facts.radiantCaptain}),
			dire_captain = COALESCE(dire_captain, ${facts.direCaptain}),
			match_flags = COALESCE(match_flags, ${facts.matchFlags}),
			match_outcome = COALESCE(match_outcome, ${facts.matchOutcome}),
			game_balance = COALESCE(game_balance, ${facts.gameBalance}),
			radiant_team_logo = COALESCE(radiant_team_logo, ${facts.radiantTeamLogo}),
			dire_team_logo = COALESCE(dire_team_logo, ${facts.direTeamLogo}),
			radiant_team_logo_url = COALESCE(radiant_team_logo_url, ${facts.radiantTeamLogoUrl}),
			dire_team_logo_url = COALESCE(dire_team_logo_url, ${facts.direTeamLogoUrl}),
			radiant_team_tag = COALESCE(radiant_team_tag, ${facts.radiantTeamTag}),
			dire_team_tag = COALESCE(dire_team_tag, ${facts.direTeamTag}),
			radiant_guild_id = COALESCE(radiant_guild_id, ${facts.radiantGuildId}),
			dire_guild_id = COALESCE(dire_guild_id, ${facts.direGuildId}),
			tournament_id = COALESCE(tournament_id, ${facts.tournamentId}),
			tournament_round = COALESCE(tournament_round, ${facts.tournamentRound}),
			league_series_id = COALESCE(league_series_id, ${facts.leagueSeriesId}),
			league_game_id = COALESCE(league_game_id, ${facts.leagueGameId}),
			game_number = COALESCE(game_number, ${facts.gameNumber}),
			stage_name = COALESCE(stage_name, ${facts.stageName}),
			league_tier = COALESCE(league_tier, ${facts.leagueTier}),
			patch = COALESCE(patch, ${patch}),
			finished_at = COALESCE(finished_at, ${finishedAt}),
			replay_available_at = CASE
				WHEN source = 'historical' AND replay_available_at IS NULL THEN now()
				ELSE replay_available_at
			END,
			seq_fetched_at = CASE
				WHEN ${fetched} = 'seq' THEN COALESCE(seq_fetched_at, now())
				ELSE seq_fetched_at
			END,
			details_fetched_at = CASE
				WHEN ${fetched} = 'gc' THEN COALESCE(details_fetched_at, now())
				ELSE details_fetched_at
			END,
			ingest_sources = CASE
				WHEN ${fetched} = 'seq'
					AND NOT ingest_sources @> ARRAY[${INGEST.seq}]::text[]
					THEN ingest_sources || ${INGEST.seq}::text
				ELSE ingest_sources
			END,
			status = CASE
				WHEN status IN (
					'awaiting_replay', 'replay_stored', 'replay_unavailable', 'parsed'
				) THEN status
				WHEN ${fetched} = 'gc' OR details_fetched_at IS NOT NULL
					THEN 'details_ready'::match_status
				ELSE 'awaiting_details'::match_status
			END,
			last_error = NULL,
			last_error_kind = NULL,
			updated_at = now()
		WHERE match_id = ${facts.matchId}
	`)
}

export async function insertUndiscoveredMatch(
	tx: Executor,
	facts: MatchFacts,
	fetched: 'seq' | 'gc' = 'gc',
): Promise<void> {
	const patch = await lookupPatch(tx, facts.startTime)
	const status = fetched === 'gc' ? 'details_ready' : 'awaiting_details'
	await tx.execute(sql`
		INSERT INTO matches (
			match_id, league_id, match_seq_num, start_time, duration,
			pre_game_duration, radiant_win, radiant_score, dire_score,
			tower_status_radiant, tower_status_dire,
			barracks_status_radiant, barracks_status_dire,
			first_blood_time, lobby_type, lobby_id, game_mode, engine,
			human_players, cluster, replay_salt, series_type,
			radiant_team_id, dire_team_id, radiant_team_name, dire_team_name,
			radiant_team_logo, dire_team_logo, radiant_team_tag, dire_team_tag,
			radiant_captain, dire_captain,
			match_flags, match_outcome,
			patch, status, source, ingest_sources,
			seq_fetched_at, details_fetched_at, created_at, updated_at
		) VALUES (
			${facts.matchId}, ${facts.leagueId}, ${facts.matchSeqNum},
			${facts.startTime}, ${facts.duration}, ${facts.preGameDuration},
			${facts.radiantWin}, ${facts.radiantScore}, ${facts.direScore},
			${facts.towerStatusRadiant}, ${facts.towerStatusDire},
			${facts.barracksStatusRadiant}, ${facts.barracksStatusDire},
			${facts.firstBloodTime}, ${facts.lobbyType}, ${facts.lobbyId},
			${facts.gameMode}, ${facts.engine}, ${facts.humanPlayers},
			${facts.cluster}, ${facts.replaySalt}, ${facts.seriesType},
			${facts.radiantTeamId}, ${facts.direTeamId},
			${facts.radiantTeamName}, ${facts.direTeamName},
			${facts.radiantTeamLogo}, ${facts.direTeamLogo},
			${facts.radiantTeamTag}, ${facts.direTeamTag},
			${facts.radiantCaptain}, ${facts.direCaptain},
			${facts.matchFlags}, ${facts.matchOutcome},
			${patch}, ${status}::match_status, 'historical'::match_source,
			${fetched === 'seq' ? sql`ARRAY[${INGEST.seq}]::text[]` : sql`'{}'::text[]`},
			${fetched === 'seq' ? new Date() : null},
			${fetched === 'gc' ? new Date() : null},
			now(), now()
		)
		ON CONFLICT (match_id) DO NOTHING
	`)
}

export async function stampMatchSeqAttempt(
	matchId: number,
	input: {
		nextAttemptAt: Date | null
		bump: boolean
		clear?: boolean
	},
	tx?: Executor,
): Promise<void> {
	const exec = tx ?? db
	if (input.clear === true) {
		await exec.execute(sql`
			UPDATE matches
			SET next_attempt_at = NULL, updated_at = now()
			WHERE match_id = ${matchId}
		`)
		return
	}
	await exec.execute(sql`
		UPDATE matches
		SET
			attempts = attempts + ${input.bump ? 1 : 0}::integer,
			next_attempt_at = ${input.nextAttemptAt},
			updated_at = now()
		WHERE match_id = ${matchId}
	`)
}

export async function markSeqFetched(
	tx: Executor,
	matchIds: readonly number[],
): Promise<void> {
	if (matchIds.length === 0) return
	await tx.execute(sql`
		UPDATE matches
		SET
			seq_fetched_at = COALESCE(seq_fetched_at, now()),
			updated_at = now()
		WHERE match_id IN ${sqlIn(matchIds)}
	`)
}

export async function ensureMatchStub(matchId: number): Promise<void> {
	await db.execute(sql`
		INSERT INTO matches (match_id, source, status)
		VALUES (
			${matchId},
			'historical'::match_source,
			'awaiting_replay'::match_status
		)
		ON CONFLICT (match_id) DO NOTHING
	`)
}

export async function replaceObjectives(
	tx: Executor,
	matchId: number,
	rows: ReadonlyArray<{
		seq: number
		time: number
		kind: string
		team: number | null
		slot: number | null
		key: string | null
		value: number | null
	}>,
): Promise<void> {
	for (const row of rows) {
		const [dup] = await tx.execute(sql`
			SELECT 1 AS ok
			FROM match_objectives
			WHERE match_id = ${matchId}
				AND kind = ${row.kind}
				AND time = ${row.time}
				AND COALESCE(key, '') = COALESCE(${row.key}, '')
			LIMIT 1
		`)
		if (dup != null) continue
		if (row.kind === 'first_blood') {
			const [fb] = await tx.execute(sql`
				SELECT 1 AS ok
				FROM match_objectives
				WHERE match_id = ${matchId} AND kind = 'first_blood'
				LIMIT 1
			`)
			if (fb != null) continue
		}
		const [next] = await tx.execute(sql`
			SELECT COALESCE(max(seq), -1) + 1 AS n
			FROM match_objectives
			WHERE match_id = ${matchId}
		`)
		const seq = asNumber(next?.n) ?? 0
		await tx.execute(sql`
			INSERT INTO match_objectives (
				match_id, seq, time, kind, team, slot, key, value,
				account_id, player_id, team_id
			)
			SELECT
				${matchId},
				${seq},
				${row.time},
				${row.kind},
				${row.team},
				${row.slot},
				${row.key},
				${row.value},
				mp.account_id,
				mp.player_id,
				COALESCE(
					mp.team_id,
					CASE
						WHEN ${row.team} = 0 THEN m.radiant_team_id
						WHEN ${row.team} = 1 THEN m.dire_team_id
					END
				)
			FROM (SELECT ${matchId}::bigint AS match_id) x
			LEFT JOIN matches m ON m.match_id = x.match_id
			LEFT JOIN match_players mp
				ON mp.match_id = x.match_id
				AND mp.player_slot = CASE
					WHEN ${row.slot} IS NULL THEN NULL
					WHEN ${row.slot} BETWEEN 0 AND 4 THEN ${row.slot}
					WHEN ${row.slot} BETWEEN 5 AND 9 THEN ${row.slot} + 123
					ELSE ${row.slot}
				END
		`)
	}
}

export async function replaceCoaches(
	tx: Executor,
	matchId: number,
	rows: MatchFacts['coaches'],
): Promise<void> {
	if (rows.length === 0) return
	const playerIds = await lookupPlayerIds(
		tx,
		rows.map((row) => row.accountId),
	)
	const sides = await matchSideTeamIds(tx, matchId)
	await tx.execute(sql`
		INSERT INTO match_coaches ${sqlValues(
			rows.map((row) => ({
				match_id: matchId,
				account_id: row.accountId,
				player_id:
					row.accountId > 0 ? (playerIds.get(row.accountId) ?? null) : null,
				team_id:
					row.coachTeam === 0 || row.coachTeam === 2
						? sides.radiant
						: row.coachTeam === 1 || row.coachTeam === 3
							? sides.dire
							: null,
				coach_name: row.coachName,
				coach_rating: row.coachRating,
				coach_team: row.coachTeam,
				coach_party_id: row.coachPartyId,
				is_private_coach: row.isPrivateCoach,
			})),
		)}
		ON CONFLICT (match_id, account_id) DO UPDATE SET
			coach_name = COALESCE(match_coaches.coach_name, excluded.coach_name),
			coach_rating = COALESCE(match_coaches.coach_rating, excluded.coach_rating),
			coach_team = COALESCE(match_coaches.coach_team, excluded.coach_team),
			coach_party_id = COALESCE(match_coaches.coach_party_id, excluded.coach_party_id),
			is_private_coach = COALESCE(
				match_coaches.is_private_coach, excluded.is_private_coach
			),
			player_id = COALESCE(match_coaches.player_id, excluded.player_id),
			team_id = COALESCE(match_coaches.team_id, excluded.team_id)
	`)
}

export async function replaceBroadcasters(
	tx: Executor,
	matchId: number,
	rows: MatchFacts['broadcasters'],
): Promise<void> {
	if (rows.length === 0) return
	const playerIds = await lookupPlayerIds(
		tx,
		rows.flatMap((row) => (row.accountId != null ? [row.accountId] : [])),
	)
	await tx.execute(sql`
		INSERT INTO match_broadcasters ${sqlValues(
			rows.map((row) => ({
				match_id: matchId,
				seq: row.seq,
				country_code: row.countryCode,
				description: row.description,
				language_code: row.languageCode,
				account_id: row.accountId,
				player_id:
					row.accountId != null && row.accountId > 0
						? (playerIds.get(row.accountId) ?? null)
						: null,
				name: row.name,
			})),
		)}
		ON CONFLICT (match_id, seq) DO UPDATE SET
			country_code = COALESCE(
				match_broadcasters.country_code, excluded.country_code
			),
			description = COALESCE(
				match_broadcasters.description, excluded.description
			),
			language_code = COALESCE(
				match_broadcasters.language_code, excluded.language_code
			),
			account_id = COALESCE(
				NULLIF(match_broadcasters.account_id, 0),
				NULLIF(excluded.account_id, 0),
				match_broadcasters.account_id
			),
			player_id = COALESCE(
				match_broadcasters.player_id, excluded.player_id
			),
			name = COALESCE(match_broadcasters.name, excluded.name)
	`)
}

export async function getMatch(matchId: number) {
	const rows = await db
		.select()
		.from(matches)
		.where(eq(matches.match_id, matchId))
		.limit(1)
	return rows[0] ?? null
}

export async function listKnownLeagueIds(): Promise<Set<number>> {
	const rows = await db.select({ league_id: leagues.league_id }).from(leagues)
	return new Set(rows.map((row) => row.league_id))
}
