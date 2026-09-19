import { insertJsonEachRow } from '#src/components/clickhouse'

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

/** ClickHouse DateTime64(3) JSONEachRow: `YYYY-MM-DD HH:MM:SS.mmm`. */
export function toClickhouseDateTime64(value: Date): string {
	const iso = value.toISOString()
	return `${iso.slice(0, 10)} ${iso.slice(11, 23)}`
}

export function liveMatchTickRow(
	tick: LiveMatchTick,
	id = 0,
): Record<string, unknown> {
	return {
		match_id: tick.match_id,
		captured_at: toClickhouseDateTime64(tick.captured_at),
		league_id: tick.league_id,
		duration: tick.duration,
		radiant_score: tick.radiant_score,
		dire_score: tick.dire_score,
		spectators: tick.spectators,
		tower_state_radiant: tick.tower_state_radiant,
		tower_state_dire: tick.tower_state_dire,
		barracks_state_radiant: tick.barracks_state_radiant,
		barracks_state_dire: tick.barracks_state_dire,
		roshan_respawn_timer: tick.roshan_respawn_timer,
		series_type: tick.series_type,
		radiant_series_wins: tick.radiant_series_wins,
		dire_series_wins: tick.dire_series_wins,
		stream_delay_s: tick.stream_delay_s,
		source: tick.source,
		lobby_id: tick.lobby_id,
		game_number: tick.game_number,
		league_series_id: tick.league_series_id,
		league_game_id: tick.league_game_id,
		league_tier: tick.league_tier,
		game_state: tick.game_state,
		server_steam_id: tick.server_steam_id,
		id,
	}
}

export function livePlayerTickRow(
	tick: LivePlayerTick,
	id = 0,
): Record<string, unknown> {
	return {
		match_id: tick.match_id,
		captured_at: toClickhouseDateTime64(tick.captured_at),
		player_slot: tick.player_slot,
		account_id: tick.account_id,
		hero_id: tick.hero_id,
		kills: tick.kills,
		deaths: tick.deaths,
		assists: tick.assists,
		last_hits: tick.last_hits,
		denies: tick.denies,
		gold: tick.gold,
		net_worth: tick.net_worth,
		level: tick.level,
		gold_per_min: tick.gold_per_min,
		xp_per_min: tick.xp_per_min,
		x: tick.x,
		y: tick.y,
		source: tick.source,
		item0: tick.item0,
		item1: tick.item1,
		item2: tick.item2,
		item3: tick.item3,
		item4: tick.item4,
		item5: tick.item5,
		item6: tick.item6,
		item7: tick.item7,
		item8: tick.item8,
		ultimate_state: tick.ultimate_state,
		ultimate_cooldown: tick.ultimate_cooldown,
		respawn_timer: tick.respawn_timer,
		id,
	}
}

export async function insertLiveTicks(
	matchTicks: readonly LiveMatchTick[],
	playerTicks: readonly LivePlayerTick[],
): Promise<void> {
	await insertJsonEachRow(
		'live_match_ticks',
		matchTicks.map((tick) => liveMatchTickRow(tick)),
	)
	await insertJsonEachRow(
		'live_player_ticks',
		playerTicks.map((tick) => livePlayerTickRow(tick)),
	)
}
