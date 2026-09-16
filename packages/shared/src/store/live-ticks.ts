import { type Executor, sql, sqlValues } from '#src/utils/db'

export type LiveMatchTick = {
	match_id: number
	captured_at: Date
	league_id: number
	duration: number
	radiant_score: number
	dire_score: number
	spectators: number
	tower_state_radiant: number
	tower_state_dire: number
	barracks_state_radiant: number
	barracks_state_dire: number
	roshan_respawn_timer: number
	series_type: number
	radiant_series_wins: number
	dire_series_wins: number
	stream_delay_s: number
	source: string
	lobby_id: number
	game_number: number
	league_series_id: number
	league_game_id: number
	league_tier: number
	game_state: number
	server_steam_id: number
}

export type LivePlayerTick = {
	match_id: number
	captured_at: Date
	player_slot: number
	account_id: number
	hero_id: number
	kills: number
	deaths: number
	assists: number
	last_hits: number
	denies: number
	gold: number
	net_worth: number
	level: number
	gold_per_min: number
	xp_per_min: number
	x: number
	y: number
	source: string
	item0: number
	item1: number
	item2: number
	item3: number
	item4: number
	item5: number
	item6: number
	item7: number
	item8: number
	ultimate_state: number
	ultimate_cooldown: number
	respawn_timer: number
}

export async function insertLiveTicks(
	tx: Executor,
	matchTicks: readonly LiveMatchTick[],
	playerTicks: readonly LivePlayerTick[],
): Promise<void> {
	if (matchTicks.length > 0) {
		await tx.execute(sql`
			INSERT INTO live_match_ticks ${sqlValues(matchTicks)}
			ON CONFLICT (match_id, captured_at, source) DO NOTHING
		`)
	}
	if (playerTicks.length > 0) {
		await tx.execute(sql`
			INSERT INTO live_player_ticks ${sqlValues(playerTicks)}
			ON CONFLICT (match_id, captured_at, player_slot, source) DO NOTHING
		`)
	}
}
