import { eq } from 'drizzle-orm'
import { leagues, matches } from '#src/db/schema'
import { asNumber } from '#src/store/coerce'
import type {
	DraftPick,
	MatchFacts,
	PlayerFacts,
} from '#src/store/match-details'
import { syntheticSeriesId } from '#src/store/series-id'
import { db, type Executor, sql, sqlIn, sqlValues } from '#src/utils/db'

export type { Executor as Tx }

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
): Promise<void> {
	if (row.accountId <= 0) return
	await tx.execute(sql`
		INSERT INTO players (
			account_id, persona_name, is_pro, current_team_id,
			last_match_id, last_match_at, updated_at
		) VALUES (
			${row.accountId},
			${row.personaName ?? null},
			${row.isPro ?? false},
			${row.teamId ?? null},
			${row.matchId ?? null},
			${row.matchAt ?? null},
			now()
		)
		ON CONFLICT (account_id) DO UPDATE SET
			persona_name = COALESCE(excluded.persona_name, players.persona_name),
			is_pro = players.is_pro OR excluded.is_pro,
			current_team_id = COALESCE(excluded.current_team_id, players.current_team_id),
			last_match_id = COALESCE(excluded.last_match_id, players.last_match_id),
			last_match_at = COALESCE(excluded.last_match_at, players.last_match_at),
			updated_at = now()
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
				AND (
					last_match_id IS NULL
					OR updated_at > now() - interval '8 hours'
				)
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
			radiant_wins, dire_wins, first_match_id, last_match_id,
			started_at, updated_at
		) VALUES (
			${seriesId},
			${input.leagueId},
			${radiant || null},
			${dire || null},
			${input.seriesType ?? 0},
			${input.radiantWins ?? 0},
			${input.direWins ?? 0},
			${input.matchId},
			${input.matchId},
			${startedAt},
			now()
		)
		ON CONFLICT (series_id) DO UPDATE SET
			league_id = COALESCE(excluded.league_id, series.league_id),
			radiant_wins = GREATEST(series.radiant_wins, excluded.radiant_wins),
			dire_wins = GREATEST(series.dire_wins, excluded.dire_wins),
			last_match_id = excluded.last_match_id,
			updated_at = now()
	`)
	return seriesId
}

export async function touchMatchLive(
	tx: Executor,
	row: {
		matchId: number
		leagueId: number
		leagueNodeId: number
		seriesId: number | null
		seriesType: number
		radiantSeriesWins: number
		direSeriesWins: number
		streamDelayS: number
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
	},
): Promise<void> {
	await tx.execute(sql`
		INSERT INTO matches (
			match_id, league_id, league_node_id, series_id, series_type,
			radiant_series_wins, dire_series_wins, stream_delay_s,
			radiant_team_id, dire_team_id, radiant_team_name, dire_team_name,
			lobby_id, game_number, league_series_id, league_game_id,
			stage_name, league_tier, radiant_team_logo, dire_team_logo,
			radiant_team_complete, dire_team_complete,
			phase, source, live_seen_at, live_disappeared_at, updated_at
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
			'live'::match_phase, 'live'::match_source,
			now(), NULL, now()
		)
		ON CONFLICT (match_id) DO UPDATE SET
			league_id = excluded.league_id,
			league_node_id = excluded.league_node_id,
			series_id = COALESCE(excluded.series_id, matches.series_id),
			series_type = excluded.series_type,
			radiant_series_wins = excluded.radiant_series_wins,
			dire_series_wins = excluded.dire_series_wins,
			stream_delay_s = excluded.stream_delay_s,
			radiant_team_id = excluded.radiant_team_id,
			dire_team_id = excluded.dire_team_id,
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
			source = 'live'::match_source,
			phase = CASE
				WHEN matches.phase IN ('details_ready', 'awaiting_replay', 'replay_stored', 'replay_unavailable')
					THEN matches.phase
				ELSE 'live'::match_phase
			END,
			live_seen_at = now(),
			live_disappeared_at = NULL,
			live_disappeared_count = 0,
			updated_at = now()
	`)
}

export async function markMatchesFinishedLive(
	tx: Executor,
	matchIds: readonly number[],
	replayDelayMs: number,
): Promise<void> {
	if (matchIds.length === 0) return
	const delaySec = Math.round(replayDelayMs / 1000)
	await tx.execute(sql`
		UPDATE matches
		SET
			live_disappeared_at = now(),
			live_disappeared_count = live_disappeared_count + 1,
			finished_at = now(),
			replay_available_at = now() + ${delaySec} * interval '1 second',
			phase = CASE
				WHEN details_fetched_at IS NULL THEN 'awaiting_details'::match_phase
				ELSE 'details_ready'::match_phase
			END,
			updated_at = now()
		WHERE match_id IN ${sqlIn(matchIds)}
			AND phase = 'live'
	`)
}

export async function upsertMatchPlayers(
	tx: Executor,
	matchId: number,
	players: readonly PlayerFacts[],
): Promise<void> {
	if (players.length === 0) return
	const rows = players.map((player) => ({
		match_id: matchId,
		account_id: player.accountId,
		player_slot: player.playerSlot,
		hero_id: player.heroId,
		hero_variant: player.heroVariant,
		player_name: player.playerName,
		pro_name: player.proName,
		real_name: player.realName,
		team_number: player.teamNumber,
		team_slot: player.teamSlot,
		side: player.side,
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
		item_0: player.item0,
		item_1: player.item1,
		item_2: player.item2,
		item_3: player.item3,
		item_4: player.item4,
		item_5: player.item5,
		item_neutral: player.itemNeutral,
		item_neutral2: player.itemNeutral2,
		item_6: player.item6,
		item_7: player.item7,
		item_8: player.item8,
		item_9: player.item9,
		item_10: player.item10,
		item_10_lvl: player.item10Lvl,
		backpack_0: player.backpack0,
		backpack_1: player.backpack1,
		backpack_2: player.backpack2,
		backpack_3: player.backpack3,
		selected_facet: player.selectedFacet,
		aghanims_scepter: player.aghanimsScepter,
		aghanims_shard: player.aghanimsShard,
		moonshard: player.moonshard,
		ability_upgrades: player.abilityUpgrades,
		leaver_status: player.leaverStatus,
		party_id: player.partyId,
		party_size: player.partySize,
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
	await tx.execute(sql`
		INSERT INTO match_players ${sqlValues(rows)}
		ON CONFLICT (match_id, player_slot) DO UPDATE SET
			account_id = excluded.account_id,
			hero_id = excluded.hero_id,
			hero_variant = COALESCE(excluded.hero_variant, match_players.hero_variant),
			player_name = COALESCE(excluded.player_name, match_players.player_name),
			pro_name = COALESCE(excluded.pro_name, match_players.pro_name),
			real_name = COALESCE(excluded.real_name, match_players.real_name),
			team_number = COALESCE(excluded.team_number, match_players.team_number),
			team_slot = COALESCE(excluded.team_slot, match_players.team_slot),
			side = excluded.side,
			kills = COALESCE(excluded.kills, match_players.kills),
			deaths = COALESCE(excluded.deaths, match_players.deaths),
			assists = COALESCE(excluded.assists, match_players.assists),
			last_hits = COALESCE(excluded.last_hits, match_players.last_hits),
			denies = COALESCE(excluded.denies, match_players.denies),
			gold = COALESCE(excluded.gold, match_players.gold),
			gold_spent = COALESCE(excluded.gold_spent, match_players.gold_spent),
			level = COALESCE(excluded.level, match_players.level),
			gold_per_min = COALESCE(excluded.gold_per_min, match_players.gold_per_min),
			xp_per_min = COALESCE(excluded.xp_per_min, match_players.xp_per_min),
			net_worth = COALESCE(excluded.net_worth, match_players.net_worth),
			hero_damage = COALESCE(excluded.hero_damage, match_players.hero_damage),
			tower_damage = COALESCE(excluded.tower_damage, match_players.tower_damage),
			hero_healing = COALESCE(excluded.hero_healing, match_players.hero_healing),
			scaled_hero_damage = COALESCE(excluded.scaled_hero_damage, match_players.scaled_hero_damage),
			scaled_tower_damage = COALESCE(excluded.scaled_tower_damage, match_players.scaled_tower_damage),
			scaled_hero_healing = COALESCE(excluded.scaled_hero_healing, match_players.scaled_hero_healing),
			item_0 = COALESCE(excluded.item_0, match_players.item_0),
			item_1 = COALESCE(excluded.item_1, match_players.item_1),
			item_2 = COALESCE(excluded.item_2, match_players.item_2),
			item_3 = COALESCE(excluded.item_3, match_players.item_3),
			item_4 = COALESCE(excluded.item_4, match_players.item_4),
			item_5 = COALESCE(excluded.item_5, match_players.item_5),
			item_neutral = COALESCE(excluded.item_neutral, match_players.item_neutral),
			item_neutral2 = COALESCE(excluded.item_neutral2, match_players.item_neutral2),
			item_6 = COALESCE(excluded.item_6, match_players.item_6),
			item_7 = COALESCE(excluded.item_7, match_players.item_7),
			item_8 = COALESCE(excluded.item_8, match_players.item_8),
			item_9 = COALESCE(excluded.item_9, match_players.item_9),
			item_10 = COALESCE(excluded.item_10, match_players.item_10),
			item_10_lvl = COALESCE(excluded.item_10_lvl, match_players.item_10_lvl),
			backpack_0 = COALESCE(excluded.backpack_0, match_players.backpack_0),
			backpack_1 = COALESCE(excluded.backpack_1, match_players.backpack_1),
			backpack_2 = COALESCE(excluded.backpack_2, match_players.backpack_2),
			backpack_3 = COALESCE(excluded.backpack_3, match_players.backpack_3),
			selected_facet = COALESCE(excluded.selected_facet, match_players.selected_facet),
			aghanims_scepter = COALESCE(excluded.aghanims_scepter, match_players.aghanims_scepter),
			aghanims_shard = COALESCE(excluded.aghanims_shard, match_players.aghanims_shard),
			moonshard = COALESCE(excluded.moonshard, match_players.moonshard),
			ability_upgrades = COALESCE(excluded.ability_upgrades, match_players.ability_upgrades),
			leaver_status = COALESCE(excluded.leaver_status, match_players.leaver_status),
			party_id = COALESCE(excluded.party_id, match_players.party_id),
			party_size = COALESCE(excluded.party_size, match_players.party_size),
			claimed_farm_gold = COALESCE(excluded.claimed_farm_gold, match_players.claimed_farm_gold),
			support_gold = COALESCE(excluded.support_gold, match_players.support_gold),
			claimed_denies = COALESCE(excluded.claimed_denies, match_players.claimed_denies),
			claimed_misses = COALESCE(excluded.claimed_misses, match_players.claimed_misses),
			misses = COALESCE(excluded.misses, match_players.misses),
			support_ability_value = COALESCE(excluded.support_ability_value, match_players.support_ability_value),
			scaled_kills = COALESCE(excluded.scaled_kills, match_players.scaled_kills),
			scaled_deaths = COALESCE(excluded.scaled_deaths, match_players.scaled_deaths),
			scaled_assists = COALESCE(excluded.scaled_assists, match_players.scaled_assists),
			hero_pick_order = COALESCE(excluded.hero_pick_order, match_players.hero_pick_order),
			hero_was_randomed = COALESCE(excluded.hero_was_randomed, match_players.hero_was_randomed),
			seconds_dead = COALESCE(excluded.seconds_dead, match_players.seconds_dead),
			gold_lost_to_death = COALESCE(excluded.gold_lost_to_death, match_players.gold_lost_to_death),
			lane_selection_flags = COALESCE(excluded.lane_selection_flags, match_players.lane_selection_flags),
			bounty_runes = COALESCE(excluded.bounty_runes, match_players.bounty_runes),
			outposts_captured = COALESCE(excluded.outposts_captured, match_players.outposts_captured),
			disable_duration = COALESCE(excluded.disable_duration, match_players.disable_duration),
			updated_at = now()
	`)

	for (const player of players) {
		if (player.buffs.length > 0) {
			await tx.execute(sql`
				INSERT INTO match_player_buffs ${sqlValues(
					player.buffs.map((buff) => ({
						match_id: matchId,
						player_slot: player.playerSlot,
						buff_id: buff.buffId,
						stacks: buff.stacks,
						grant_time: buff.grantTime,
					})),
				)}
				ON CONFLICT (match_id, player_slot, buff_id) DO UPDATE SET
					stacks = excluded.stacks,
					grant_time = COALESCE(excluded.grant_time, match_player_buffs.grant_time)
			`)
		}
		if (player.units.length > 0) {
			await tx.execute(sql`
				INSERT INTO match_player_units ${sqlValues(
					player.units.map((unit) => ({
						match_id: matchId,
						player_slot: player.playerSlot,
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
					item_0 = excluded.item_0,
					item_1 = excluded.item_1,
					item_2 = excluded.item_2,
					item_3 = excluded.item_3,
					item_4 = excluded.item_4,
					item_5 = excluded.item_5
			`)
		}
		if (player.abilityUpgradeRows.length > 0) {
			await tx.execute(sql`
				DELETE FROM match_player_ability_upgrades
				WHERE match_id = ${matchId} AND player_slot = ${player.playerSlot}
			`)
			await tx.execute(sql`
				INSERT INTO match_player_ability_upgrades ${sqlValues(
					player.abilityUpgradeRows.map((row) => ({
						match_id: matchId,
						player_slot: player.playerSlot,
						seq: row.seq,
						ability_id: row.abilityId,
						time: row.time,
						level: row.level,
					})),
				)}
			`)
		}
		if (player.damageBreakdown.length > 0) {
			await tx.execute(sql`
				INSERT INTO match_player_damage_breakdown ${sqlValues(
					player.damageBreakdown.map((row) => ({
						match_id: matchId,
						player_slot: player.playerSlot,
						direction: row.direction,
						damage_type: row.damageType,
						pre_reduction: row.preReduction,
						post_reduction: row.postReduction,
					})),
				)}
				ON CONFLICT (match_id, player_slot, direction, damage_type)
				DO UPDATE SET
					pre_reduction = COALESCE(excluded.pre_reduction, match_player_damage_breakdown.pre_reduction),
					post_reduction = COALESCE(excluded.post_reduction, match_player_damage_breakdown.post_reduction)
			`)
		}
	}
}

export async function replaceMatchDraft(
	tx: Executor,
	matchId: number,
	rows: readonly DraftPick[],
): Promise<void> {
	await tx.execute(sql`DELETE FROM match_draft WHERE match_id = ${matchId}`)
	if (rows.length === 0) return
	await tx.execute(sql`
		INSERT INTO match_draft ${sqlValues(
			rows.map((row) => ({
				match_id: matchId,
				ord: row.ord,
				is_pick: row.isPick,
				hero_id: row.heroId,
				team: row.team,
				player_slot: row.playerSlot ?? null,
				clock: row.clock ?? null,
			})),
		)}
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
				patch, phase, source, created_at, updated_at
			) VALUES (
				${row.match_id}, ${row.league_id}, ${row.match_seq_num},
				${row.start_time}, ${row.lobby_type}, ${row.series_id || null},
				${row.series_type}, ${row.radiant_team_id}, ${row.dire_team_id},
				${patch}, 'discovered'::match_phase, 'historical'::match_source,
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
				updated_at = now()
		`)
	}
}

export async function saveMatchFacts(
	tx: Executor,
	facts: MatchFacts,
	apiKeyId: number | null,
): Promise<void> {
	const patch = await lookupPatch(tx, facts.startTime)
	const finishedAt =
		facts.startTime != null && facts.duration != null
			? new Date((facts.startTime + facts.duration) * 1000)
			: null
	await tx.execute(sql`
		UPDATE matches SET
			match_seq_num = COALESCE(${facts.matchSeqNum}, match_seq_num),
			league_id = COALESCE(${facts.leagueId}, league_id),
			start_time = COALESCE(${facts.startTime}, start_time),
			duration = COALESCE(${facts.duration}, duration),
			pre_game_duration = COALESCE(${facts.preGameDuration}, pre_game_duration),
			radiant_win = COALESCE(${facts.radiantWin}, radiant_win),
			radiant_score = COALESCE(${facts.radiantScore}, radiant_score),
			dire_score = COALESCE(${facts.direScore}, dire_score),
			tower_status_radiant = COALESCE(${facts.towerStatusRadiant}, tower_status_radiant),
			tower_status_dire = COALESCE(${facts.towerStatusDire}, tower_status_dire),
			barracks_status_radiant = COALESCE(${facts.barracksStatusRadiant}, barracks_status_radiant),
			barracks_status_dire = COALESCE(${facts.barracksStatusDire}, barracks_status_dire),
			first_blood_time = COALESCE(${facts.firstBloodTime}, first_blood_time),
			lobby_type = COALESCE(${facts.lobbyType}, lobby_type),
			lobby_id = COALESCE(${facts.lobbyId}, lobby_id),
			game_mode = COALESCE(${facts.gameMode}, game_mode),
			engine = COALESCE(${facts.engine}, engine),
			human_players = COALESCE(${facts.humanPlayers}, human_players),
			cluster = COALESCE(${facts.cluster}, cluster),
			replay_salt = COALESCE(${facts.replaySalt}, replay_salt),
			series_type = COALESCE(${facts.seriesType}, series_type),
			radiant_team_id = COALESCE(${facts.radiantTeamId}, radiant_team_id),
			dire_team_id = COALESCE(${facts.direTeamId}, dire_team_id),
			radiant_team_name = COALESCE(${facts.radiantTeamName}, radiant_team_name),
			dire_team_name = COALESCE(${facts.direTeamName}, dire_team_name),
			radiant_team_complete = COALESCE(${facts.radiantTeamComplete}, radiant_team_complete),
			dire_team_complete = COALESCE(${facts.direTeamComplete}, dire_team_complete),
			radiant_captain = COALESCE(${facts.radiantCaptain}, radiant_captain),
			dire_captain = COALESCE(${facts.direCaptain}, dire_captain),
			positive_votes = COALESCE(${facts.positiveVotes}, positive_votes),
			negative_votes = COALESCE(${facts.negativeVotes}, negative_votes),
			match_flags = COALESCE(${facts.matchFlags}, match_flags),
			match_outcome = COALESCE(${facts.matchOutcome}, match_outcome),
			game_balance = COALESCE(${facts.gameBalance}, game_balance),
			radiant_team_logo = COALESCE(${facts.radiantTeamLogo}, radiant_team_logo),
			dire_team_logo = COALESCE(${facts.direTeamLogo}, dire_team_logo),
			radiant_team_logo_url = COALESCE(${facts.radiantTeamLogoUrl}, radiant_team_logo_url),
			dire_team_logo_url = COALESCE(${facts.direTeamLogoUrl}, dire_team_logo_url),
			radiant_team_tag = COALESCE(${facts.radiantTeamTag}, radiant_team_tag),
			dire_team_tag = COALESCE(${facts.direTeamTag}, dire_team_tag),
			radiant_guild_id = COALESCE(${facts.radiantGuildId}, radiant_guild_id),
			dire_guild_id = COALESCE(${facts.direGuildId}, dire_guild_id),
			tournament_id = COALESCE(${facts.tournamentId}, tournament_id),
			tournament_round = COALESCE(${facts.tournamentRound}, tournament_round),
			league_series_id = COALESCE(${facts.leagueSeriesId}, league_series_id),
			league_game_id = COALESCE(${facts.leagueGameId}, league_game_id),
			game_number = COALESCE(${facts.gameNumber}, game_number),
			stage_name = COALESCE(${facts.stageName}, stage_name),
			league_tier = COALESCE(${facts.leagueTier}, league_tier),
			patch = COALESCE(patch, ${patch}),
			finished_at = COALESCE(finished_at, ${finishedAt}),
			replay_available_at = CASE
				WHEN source = 'historical' AND replay_available_at IS NULL THEN now()
				ELSE replay_available_at
			END,
			details_fetched_at = now(),
			phase = CASE
				WHEN phase IN ('awaiting_replay', 'replay_stored', 'replay_unavailable') THEN phase
				ELSE 'details_ready'::match_phase
			END,
			last_api_key_id = COALESCE(${apiKeyId}, last_api_key_id),
			last_error = NULL,
			updated_at = now()
		WHERE match_id = ${facts.matchId}
	`)
}

export async function insertUndiscoveredMatch(
	tx: Executor,
	facts: MatchFacts,
): Promise<void> {
	const patch = await lookupPatch(tx, facts.startTime)
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
			match_flags, match_outcome,
			patch, phase, source, details_fetched_at, created_at, updated_at
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
			${facts.matchFlags}, ${facts.matchOutcome},
			${patch}, 'details_ready'::match_phase, 'historical'::match_source,
			now(), now(), now()
		)
		ON CONFLICT (match_id) DO NOTHING
	`)
}

export async function ensureMatchStub(matchId: number): Promise<void> {
	await db.execute(sql`
		INSERT INTO matches (match_id, source, phase)
		VALUES (
			${matchId},
			'historical'::match_source,
			'awaiting_replay'::match_phase
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
	await tx.execute(
		sql`DELETE FROM match_objectives WHERE match_id = ${matchId}`,
	)
	if (rows.length === 0) return
	await tx.execute(sql`
		INSERT INTO match_objectives ${sqlValues(
			rows.map((row) => ({
				match_id: matchId,
				seq: row.seq,
				time: row.time,
				kind: row.kind,
				team: row.team,
				slot: row.slot,
				key: row.key,
				value: row.value,
			})),
		)}
	`)
}

export async function replaceCoaches(
	tx: Executor,
	matchId: number,
	rows: MatchFacts['coaches'],
): Promise<void> {
	if (rows.length === 0) return
	await tx.execute(sql`DELETE FROM match_coaches WHERE match_id = ${matchId}`)
	await tx.execute(sql`
		INSERT INTO match_coaches ${sqlValues(
			rows.map((row) => ({
				match_id: matchId,
				account_id: row.accountId,
				coach_name: row.coachName,
				coach_rating: row.coachRating,
				coach_team: row.coachTeam,
				coach_party_id: row.coachPartyId,
				is_private_coach: row.isPrivateCoach,
			})),
		)}
	`)
}

export async function replaceBroadcasters(
	tx: Executor,
	matchId: number,
	rows: MatchFacts['broadcasters'],
): Promise<void> {
	if (rows.length === 0) return
	await tx.execute(
		sql`DELETE FROM match_broadcasters WHERE match_id = ${matchId}`,
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
				name: row.name,
			})),
		)}
	`)
}

export async function recordMatchError(
	matchId: number,
	error: string,
): Promise<void> {
	await db.execute(sql`
		UPDATE matches
		SET
			last_error = ${error},
			last_error_at = now(),
			attempts = attempts + 1,
			updated_at = now()
		WHERE match_id = ${matchId}
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
