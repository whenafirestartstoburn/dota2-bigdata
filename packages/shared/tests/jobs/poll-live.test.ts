import { describe, expect, test } from 'bun:test'
import {
	resolveLivePlayerTick,
	rosterFromLivePlayers,
} from '#src/jobs/poll-live'

describe('rosterFromLivePlayers', () => {
	test('assigns per-team Valve slots, ignores team 4, mixed order', () => {
		const roster = rosterFromLivePlayers([
			{ account_id: 99, hero_id: 0, name: 'coach', team: 4 },
			{ account_id: 2, hero_id: 75, name: 'dire0', team: 1 },
			{ account_id: 1, hero_id: 126, name: 'rad0', team: 0 },
			{ account_id: 3, hero_id: 26, name: 'rad1', team: 0 },
			{ account_id: 4, hero_id: 38, name: 'dire1', team: 1 },
		])
		expect(roster.map((row) => row.playerSlot)).toEqual([0, 1, 128, 129])
		expect(roster.map((row) => row.accountId)).toEqual([1, 3, 2, 4])
		expect(roster.map((row) => row.teamSlot)).toEqual([0, 1, 0, 1])
	})
})

describe('resolveLivePlayerTick', () => {
	const roster: Parameters<typeof resolveLivePlayerTick>[0] = [
		{ account_id: 11, hero_id: 1, name: 'rad0', team: 0 },
		{ account_id: 12, hero_id: 2, name: 'rad1', team: 0 },
		{ account_id: 21, hero_id: 10, name: 'dire0', team: 1 },
		{ account_id: 22, hero_id: 11, name: 'dire1', team: 1 },
	]

	test('fills account_id from roster by hero when scoreboard has 0', () => {
		const ident = resolveLivePlayerTick(roster, 'dire', 0, {
			player_slot: 0,
			account_id: 0,
			hero_id: 10,
		})
		expect(ident).toEqual({ playerSlot: 128, accountId: 21 })
	})

	test('keeps a Valve dire slot and a present account_id', () => {
		const ident = resolveLivePlayerTick(roster, 'dire', 1, {
			player_slot: 129,
			account_id: 22,
			hero_id: 11,
		})
		expect(ident).toEqual({ playerSlot: 129, accountId: 22 })
	})

	test('maps linear 5–9 onto dire Valve slots', () => {
		const ident = resolveLivePlayerTick(roster, 'dire', 0, {
			player_slot: 5,
			account_id: 0,
			hero_id: 10,
		})
		expect(ident.playerSlot).toBe(128)
	})
})
