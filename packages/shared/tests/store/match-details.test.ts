import { describe, expect, test } from 'bun:test'
import {
	extractDraft,
	extractMatchFacts,
	extractPlayers,
	normalizeValvePlayerSlot,
	partialPlayerFacts,
	valvePlayerSlot,
} from '#src/store/match-details'
import { syntheticSeriesId } from '#src/store/series-id'

describe('extractMatchFacts', () => {
	test('maps Valve seq-num / details scalars', () => {
		const facts = extractMatchFacts({
			match_id: 1,
			match_seq_num: 99,
			leagueid: 19719,
			radiant_win: true,
			duration: 1800,
			tower_status_radiant: 2047,
			cluster: 1,
			replay_salt: 42,
			radiant_name: 'Team A',
		})
		expect(facts.leagueId).toBe(19719)
		expect(facts.radiantWin).toBe(true)
		expect(facts.replaySalt).toBe(42)
		expect(facts.radiantTeamName).toBe('Team A')
	})

	test('maps GC packed tower status, match_outcome, and logos', () => {
		const facts = extractMatchFacts({
			match_id: 9,
			tower_status: [2047, 36],
			barracks_status: [63, 0],
			match_outcome: 2,
			radiant_team_logo: 123,
			lobby_id: 99,
			coaches: [{ account_id: 5, coach_name: 'coach' }],
		})
		expect(facts.towerStatusRadiant).toBe(2047)
		expect(facts.towerStatusDire).toBe(36)
		expect(facts.radiantWin).toBe(true)
		expect(facts.radiantTeamLogo).toBe(123)
		expect(facts.lobbyId).toBe(99)
		expect(facts.coaches).toEqual([
			{
				accountId: 5,
				coachName: 'coach',
				coachRating: null,
				coachTeam: null,
				coachPartyId: null,
				isPrivateCoach: null,
			},
		])
	})

	test('treats league 0 as unknown and accepts league_id alias', () => {
		expect(extractMatchFacts({ match_id: 2, leagueid: 0 }).leagueId).toBeNull()
		expect(extractMatchFacts({ match_id: 3, league_id: 11629 }).leagueId).toBe(
			11629,
		)
	})

	test('throws when match_id is missing', () => {
		expect(() => extractMatchFacts({ duration: 1 })).toThrow('match_id')
	})
})

describe('valve player slots', () => {
	test('maps team index to Valve 0-4 / 128-132', () => {
		expect(valvePlayerSlot(0, 0)).toBe(0)
		expect(valvePlayerSlot(0, 4)).toBe(4)
		expect(valvePlayerSlot(1, 0)).toBe(128)
		expect(valvePlayerSlot(1, 4)).toBe(132)
	})

	test('accepts Valve slots and linear 0-9, rejects extras', () => {
		expect(normalizeValvePlayerSlot(3)).toBe(3)
		expect(normalizeValvePlayerSlot(130)).toBe(130)
		expect(normalizeValvePlayerSlot(5)).toBe(128)
		expect(normalizeValvePlayerSlot(9)).toBe(132)
		expect(normalizeValvePlayerSlot(133)).toBeNull()
		expect(normalizeValvePlayerSlot(-1)).toBeNull()
	})

	test('extractPlayers stores Valve empty item -1 as 0', () => {
		const players = extractPlayers({
			players: [{ account_id: 1, player_slot: 128, hero_id: 2, item_5: -1 }],
		})
		expect(players[0]?.playerSlot).toBe(128)
		expect(players[0]?.item5).toBe(0)
	})
})

describe('extractPlayers', () => {
	test('expands box score, items, and buffs', () => {
		const players = extractPlayers({
			players: [
				{
					account_id: 10,
					player_slot: 0,
					hero_id: 1,
					item_0: 5,
					kills: 3,
					permanent_buffs: [{ permanent_buff: 12, stack_count: 2 }],
					additional_units: [{ unitname: 'spirit_bear', item_0: 9 }],
				},
			],
		})
		expect(players[0]?.item0).toBe(5)
		expect(players[0]?.buffs).toEqual([
			{ buffId: 12, stacks: 2, grantTime: null },
		])
		expect(players[0]?.units[0]?.unitName).toBe('spirit_bear')
	})

	test('keeps second neutral, facet, and timed ability upgrades', () => {
		const players = extractPlayers({
			players: [
				{
					account_id: 1,
					player_slot: 0,
					hero_id: 1,
					item_neutral2: 1593,
					selected_facet: 2,
					aghanims_scepter: 1,
					ability_upgrades: [
						{ ability: 5002, time: 90, level: 1 },
						{ ability: 5003, time: 120, level: 2 },
					],
					hero_damage_received: [
						{ pre_reduction: 100, post_reduction: 80, damage_type: 0 },
					],
				},
			],
		})
		expect(players[0]?.itemNeutral2).toBe(1593)
		expect(players[0]?.selectedFacet).toBe(2)
		expect(players[0]?.aghanimsScepter).toBe(1)
		expect(players[0]?.abilityUpgradeRows).toEqual([
			{ seq: 0, abilityId: 5002, time: 90, level: 1 },
			{ seq: 1, abilityId: 5003, time: 120, level: 2 },
		])
		expect(players[0]?.damageBreakdown).toEqual([
			{
				direction: 'received',
				damageType: 0,
				preReduction: 100,
				postReduction: 80,
			},
		])
	})
})

describe('extractDraft', () => {
	test('keeps pick/ban order', () => {
		const draft = extractDraft({
			picks_bans: [
				{ is_pick: false, hero_id: 2, team: 0, order: 0 },
				{ is_pick: true, hero_id: 1, team: 1, order: 1 },
			],
		})
		expect(draft).toEqual([
			{
				ord: 0,
				isPick: false,
				heroId: 2,
				team: 0,
				playerSlot: null,
				clock: null,
			},
			{
				ord: 1,
				isPick: true,
				heroId: 1,
				team: 1,
				playerSlot: null,
				clock: null,
			},
		])
	})

	test('treats is_pick 1/0 as booleans', () => {
		const draft = extractDraft({
			picks_bans: [
				{ is_pick: 1, hero_id: 65, team: 0, ord: 0 },
				{ is_pick: 0, hero_id: 41, team: 1, ord: 1 },
			],
		})
		expect(draft).toEqual([
			{
				ord: 0,
				isPick: true,
				heroId: 65,
				team: 0,
				playerSlot: null,
				clock: null,
			},
			{
				ord: 1,
				isPick: false,
				heroId: 41,
				team: 1,
				playerSlot: null,
				clock: null,
			},
		])
	})
})

describe('syntheticSeriesId', () => {
	test('is stable and outside Valve id range', () => {
		const a = syntheticSeriesId({
			leagueId: 1,
			teamA: 10,
			teamB: 20,
			firstMatchId: 5,
		})
		const b = syntheticSeriesId({
			leagueId: 1,
			teamA: 20,
			teamB: 10,
			firstMatchId: 5,
		})
		expect(a).toBe(b)
		expect(a).toBeGreaterThan(2 ** 48)
	})
})

describe('partialPlayerFacts', () => {
	test('dire slots are 128+', () => {
		expect(partialPlayerFacts({ accountId: 1, playerSlot: 0 }).side).toBe(
			'radiant',
		)
		expect(partialPlayerFacts({ accountId: 1, playerSlot: 128 }).side).toBe(
			'dire',
		)
	})
})
