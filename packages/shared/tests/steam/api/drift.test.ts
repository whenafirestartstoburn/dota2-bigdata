import { describe, expect, test } from 'bun:test'
import { findSchemaDrift, STEAM_API_DRIFT } from '#src/steam/api/drift'

describe('findSchemaDrift', () => {
	test('empty arrays are not drift', () => {
		expect(
			findSchemaDrift(
				{ result: { games: [] } },
				STEAM_API_DRIFT.GetLiveLeagueGames ?? { required: [] },
			),
		).toBeNull()
		expect(
			findSchemaDrift(
				{ result: { status: 1, matches: [] } },
				STEAM_API_DRIFT.GetMatchHistory ?? { required: [] },
			),
		).toBeNull()
		expect(
			findSchemaDrift(
				{ infos: [] },
				STEAM_API_DRIFT.GetLeagueInfoList ?? { required: [] },
			),
		).toBeNull()
	})

	test('unexpected field on the envelope', () => {
		const drift = findSchemaDrift(
			{ result: { games: [] }, extra_flag: true },
			STEAM_API_DRIFT.GetLiveLeagueGames ?? { required: [] },
		)
		expect(drift?.extra).toEqual(['extra_flag'])
		expect(drift?.missing).toEqual([])
	})

	test('required field disappeared', () => {
		const drift = findSchemaDrift(
			{ infos: [{ name: 'x' }] },
			STEAM_API_DRIFT.GetLeagueInfoList ?? { required: [] },
		)
		expect(drift?.missing).toEqual(['infos[0].league_id'])
	})

	test('unexpected field on a present array item', () => {
		const drift = findSchemaDrift(
			{
				result: {
					games: [{ match_id: 1, brand_new: 9 }],
				},
			},
			STEAM_API_DRIFT.GetLiveLeagueGames ?? { required: [] },
		)
		expect(drift?.extra).toEqual(['result.games[0].brand_new'])
	})

	test('optional keys omitted on a present object are not missing', () => {
		expect(
			findSchemaDrift(
				{ result: { games: [{ match_id: 1 }] } },
				STEAM_API_DRIFT.GetLiveLeagueGames ?? { required: [] },
			),
		).toBeNull()
	})

	test('missing required envelope key', () => {
		const drift = findSchemaDrift(
			{},
			STEAM_API_DRIFT.GetLiveLeagueGames ?? { required: [] },
		)
		expect(drift?.missing).toEqual(['result'])
	})

	test('current Valve fields are not drift', () => {
		expect(
			findSchemaDrift(
				{
					result: {
						status: 200,
						games: [
							{
								match_id: 1,
								scoreboard: {
									radiant: {
										abilities: [{ ability_id: 5008, ability_level: 4 }],
									},
									dire: { abilities: [] },
								},
							},
						],
					},
				},
				STEAM_API_DRIFT.GetLiveLeagueGames ?? { required: [] },
			),
		).toBeNull()
		expect(
			findSchemaDrift(
				{
					search_key: '',
					league_id: 0,
					hero_id: 0,
					start_game: 0,
					num_games: 1,
					game_list_index: 0,
					specific_games: 0,
					bot_game: 0,
					game_list: [
						{
							match_id: 1,
							server_steam_id: '9',
							league_id: 10,
							is_player_draft: false,
							is_watch_eligible: true,
						},
					],
				},
				STEAM_API_DRIFT.GetTopLiveGame ?? { required: [] },
			),
		).toBeNull()
		expect(
			findSchemaDrift(
				{
					result: {
						status: 1,
						matches: [
							{
								match_id: 1,
								match_seq_num: 2,
								players: [
									{
										account_id: 1,
										player_slot: 0,
										hero_id: 8,
										hero_variant: 1,
									},
									{ player_slot: 1, hero_id: 2 },
								],
							},
						],
					},
				},
				STEAM_API_DRIFT.GetMatchHistory ?? { required: [] },
			),
		).toBeNull()
		expect(
			findSchemaDrift(
				{
					match: {
						match_id: '1',
						league_id: 7,
						lobby_type: 1,
						start_timestamp: 10,
						is_player_draft: false,
					},
					teams: [
						{
							team_number: 2,
							team_tag: 'T',
							team_logo_url: 'https://example.test/logo.png',
						},
					],
					delta_frame: true,
				},
				STEAM_API_DRIFT.GetRealtimeStats ?? { required: [] },
			),
		).toBeNull()
	})
})
