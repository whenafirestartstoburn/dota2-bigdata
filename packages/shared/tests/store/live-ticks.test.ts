import { describe, expect, test } from 'bun:test'
import {
	liveMatchTickRow,
	livePlayerTickRow,
	toClickhouseDateTime64,
} from '#src/store/live-ticks'

describe('toClickhouseDateTime64', () => {
	test('formats UTC milliseconds without the T/Z markers', () => {
		expect(toClickhouseDateTime64(new Date('2026-09-16T00:19:38.006Z'))).toBe(
			'2026-09-16 00:19:38.006',
		)
	})
})

describe('live tick rows', () => {
	test('live inserts stamp id 0 so the drain script can key on Postgres serials', () => {
		const captured = new Date('2026-09-16T00:19:38.006Z')
		const match = liveMatchTickRow({
			match_id: 1,
			captured_at: captured,
			league_id: 2,
			duration: 1.5,
			radiant_score: 0,
			dire_score: 0,
			spectators: 0,
			tower_state_radiant: 0,
			tower_state_dire: 0,
			barracks_state_radiant: 0,
			barracks_state_dire: 0,
			roshan_respawn_timer: 0,
			series_type: 0,
			radiant_series_wins: 0,
			dire_series_wins: 0,
			stream_delay_s: 0,
			source: 'GetLiveLeagueGames',
			lobby_id: 0,
			game_number: 0,
			league_series_id: 0,
			league_game_id: 0,
			league_tier: 0,
			game_state: 0,
			server_steam_id: 0,
		})
		expect(match.id).toBe(0)
		expect(match.captured_at).toBe('2026-09-16 00:19:38.006')
		expect(
			livePlayerTickRow({
				match_id: 1,
				captured_at: captured,
				player_slot: 128,
				account_id: 9,
				hero_id: 1,
				kills: 0,
				deaths: 0,
				assists: 0,
				last_hits: 0,
				denies: 0,
				gold: 0,
				net_worth: 0,
				level: 0,
				gold_per_min: 0,
				xp_per_min: 0,
				x: 0,
				y: 0,
				source: 'GetRealtimeStats',
				item0: 0,
				item1: 0,
				item2: 0,
				item3: 0,
				item4: 0,
				item5: 0,
				item6: 0,
				item7: 0,
				item8: 0,
				ultimate_state: 0,
				ultimate_cooldown: 0,
				respawn_timer: 0,
			}).id,
		).toBe(0)
	})
})
