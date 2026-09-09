import { describe, expect, test } from 'bun:test'
import {
	collectRealtimeDraft,
	parseRealtimeTeams,
	parseTeamScore,
} from '#src/jobs/poll-realtime-stats'

const teams = [
	{
		team_number: 2,
		team_id: 36,
		team_name: 'Natus Vincere',
		score: 12,
		players: [
			{
				accountid: 111,
				heroid: 1,
				name: 'rad0',
				team_slot: 0,
				kill_count: 3,
				items: [1, 2, 3, 4, 5, 6, 7, 8, 9],
			},
		],
	},
	{
		team_number: 3,
		team_id: 15,
		team_name: 'PSG.LGD',
		score: 8,
		players: [
			{
				account_id: 222,
				hero_id: 2,
				name: 'dire0',
				team_slot: 0,
				kills: 1,
				items: [10],
			},
		],
	},
]

describe('parseRealtimeTeams', () => {
	test('maps team 2/3 to radiant/dire and Valve slots', () => {
		const parsed = parseRealtimeTeams(teams)
		expect(parsed.radiant.teamId).toBe(36)
		expect(parsed.dire.teamId).toBe(15)
		expect(parsed.radiant.players[0]?.playerSlot).toBe(0)
		expect(parsed.dire.players[0]?.playerSlot).toBe(128)
		expect(parsed.radiant.players[0]?.item0).toBe(1)
		expect(parsed.radiant.players[0]?.item8).toBe(9)
		expect(parsed.dire.players[0]?.accountId).toBe(222)
	})
})

describe('parseTeamScore / collectRealtimeDraft', () => {
	test('reads score by team_number', () => {
		expect(parseTeamScore(teams, 2)).toBe(12)
		expect(parseTeamScore(teams, 3)).toBe(8)
		expect(parseTeamScore(teams, 4)).toBe(0)
	})

	test('writes bans then picks and skips hero 0', () => {
		const draft = collectRealtimeDraft(
			[
				{ team: 2, hero: 1 },
				{ team: 3, hero: 0 },
			],
			[{ team: 3, hero: 9 }],
		)
		expect(draft).toEqual([
			{
				ord: 0,
				isPick: false,
				heroId: 9,
				team: 1,
				playerSlot: null,
				clock: null,
			},
			{
				ord: 1,
				isPick: true,
				heroId: 1,
				team: 0,
				playerSlot: null,
				clock: null,
			},
		])
	})
})
