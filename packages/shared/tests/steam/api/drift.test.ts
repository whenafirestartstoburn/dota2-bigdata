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
})
