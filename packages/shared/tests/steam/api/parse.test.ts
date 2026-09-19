import { describe, expect, test } from 'bun:test'
import { PublicMatchError, SteamApiError } from '#src/steam/api/client'
import {
	parseLeagueInfoList,
	parseLiveLeagueGames,
	parseMatchHistoryBySequenceNum,
	parseMatchHistoryPage,
	parseRealtimeStats,
	parseTopLiveGames,
} from '#src/steam/api/methods'

describe('parseLeagueInfoList', () => {
	test('keeps typed infos and skips a broken row', () => {
		const infos = parseLeagueInfoList({
			infos: [
				{
					league_id: 17,
					name: 'G-1',
					tier: 2,
					region: 0,
					most_recent_activity: 1,
					total_prize_pool: 0,
					start_timestamp: 2,
					end_timestamp: 3,
					status: 5,
				},
				{ name: 'no id' },
			],
		})
		expect(infos).toEqual([
			{
				league_id: 17,
				name: 'G-1',
				tier: 2,
				region: 0,
				most_recent_activity: 1,
				total_prize_pool: 0,
				start_timestamp: 2,
				end_timestamp: 3,
				status: 5,
			},
		])
	})

	test('empty infos is valid', () => {
		expect(parseLeagueInfoList({ infos: [] })).toEqual([])
	})

	test('rejects a missing envelope', () => {
		expect(() => parseLeagueInfoList([])).toThrow(SteamApiError)
	})
})

describe('parseLiveLeagueGames', () => {
	test('parses a live game and skips match_id 0', () => {
		const { games } = parseLiveLeagueGames({
			result: {
				games: [
					{
						match_id: 1,
						league_id: 10,
						players: [{ account_id: 9, hero_id: 1, name: 'a', team: 0 }],
						scoreboard: {
							duration: 12,
							radiant: {
								score: 2,
								players: [{ account_id: 9, hero_id: 1, kills: 1 }],
							},
						},
					},
					{ match_id: 0, league_id: 10 },
				],
			},
		})
		expect(games).toHaveLength(1)
		expect(games[0]?.match_id).toBe(1)
		expect(games[0]?.players[0]?.account_id).toBe(9)
		expect(games[0]?.scoreboard?.duration).toBe(12)
	})

	test('empty games is valid', () => {
		expect(parseLiveLeagueGames({ result: { games: [] } }).games).toEqual([])
	})
})

describe('parseMatchHistoryPage', () => {
	test('reads matches and remaining count', () => {
		const page = parseMatchHistoryPage({
			result: {
				status: 1,
				results_remaining: 40,
				total_results: 41,
				matches: [
					{
						match_id: 5,
						match_seq_num: 9,
						start_time: 1,
						lobby_type: 1,
						players: [{ account_id: 1, player_slot: 0, hero_id: 8 }],
					},
				],
			},
		})
		expect(page.matches[0]?.match_id).toBe(5)
		expect(page.resultsRemaining).toBe(40)
		expect(page.totalResults).toBe(41)
	})

	test('empty matches with status 1 is valid', () => {
		const page = parseMatchHistoryPage({
			result: { status: 1, matches: [] },
		})
		expect(page.matches).toEqual([])
	})

	test('rejects non-1 status', () => {
		expect(() =>
			parseMatchHistoryPage({ result: { status: 15, matches: [] } }),
		).toThrow(/GetMatchHistory status=15/)
	})
})

describe('parseMatchHistoryBySequenceNum', () => {
	test('keeps raw fields used by persist', () => {
		const { matches } = parseMatchHistoryBySequenceNum({
			result: {
				status: 1,
				matches: [
					{
						match_id: 8,
						match_seq_num: 80,
						leagueid: 18322,
						radiant_win: true,
						start_time: 100,
					},
				],
			},
		})
		expect(matches[0]?.match_id).toBe(8)
		expect(matches[0]?.leagueid).toBe(18322)
		expect(matches[0]?.radiant_win).toBe(true)
	})

	test('empty window is valid', () => {
		expect(
			parseMatchHistoryBySequenceNum({ result: { status: 1, matches: [] } })
				.matches,
		).toEqual([])
	})
})

describe('parseTopLiveGames', () => {
	test('keeps league_id > 0 and drops pubs', () => {
		const { games } = parseTopLiveGames({
			game_list: [
				{ match_id: '1', server_steam_id: '9', league_id: 10, delay: 30 },
				{ match_id: 2, server_steam_id: 8, league_id: 0, delay: 0 },
			],
		})
		expect(games).toHaveLength(1)
		expect(games[0]?.league_id).toBe(10)
		expect(games[0]?.delay).toBe(30)
	})
})

describe('parseRealtimeStats', () => {
	test('parses match + teams', () => {
		const stats = parseRealtimeStats({
			match: {
				match_id: '11',
				league_id: 7,
				game_time: 40,
				picks: [{ team: 2, hero: 1 }],
			},
			teams: [{ team_number: 2, team_id: 36, score: 3, players: [] }],
		})
		expect(stats.match.league_id).toBe(7)
		expect(stats.teams).toHaveLength(1)
	})

	test('public league_id throws PublicMatchError', () => {
		expect(() =>
			parseRealtimeStats({
				match: { match_id: 3, league_id: 0 },
				teams: [],
			}),
		).toThrow(PublicMatchError)
	})
})
