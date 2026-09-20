import { afterAll, describe, expect, test } from 'bun:test'
import { asNumber } from '#src/store/coerce'
import { partialPlayerFacts } from '#src/store/match-details'
import {
	fillMatchPlayerLinks,
	upsertMatchPlayers,
	upsertPlayer,
	upsertTeam,
} from '#src/store/matches'
import { persistMatchRecord } from '#src/store/persist-match'
import { db, sql } from '#src/utils/db'

const MATCH_ID = 9_900_070_001
const LATE_ID = 9_900_070_002
const LEAGUE_ID = 9_900_071
const RADIANT_TEAM = 9_900_072
const DIRE_TEAM = 9_900_073
const ACCOUNT_A = 9_900_074
const ACCOUNT_B = 9_900_075
const ACCOUNT_LATE = 9_900_076

async function cleanup(): Promise<void> {
	await db.execute(sql`
		DELETE FROM matches
		WHERE match_id IN (${MATCH_ID}, ${LATE_ID})
	`)
	await db.execute(sql`DELETE FROM leagues WHERE league_id = ${LEAGUE_ID}`)
	await db.execute(sql`
		DELETE FROM players
		WHERE account_id IN (${ACCOUNT_A}, ${ACCOUNT_B}, ${ACCOUNT_LATE})
	`)
	await db.execute(sql`
		DELETE FROM teams
		WHERE team_id IN (${RADIANT_TEAM}, ${DIRE_TEAM})
	`)
}

afterAll(cleanup)

describe('player / team FKs', () => {
	test('persist sets player_id and team_id on match_players and buffs', async () => {
		await cleanup()
		await db.execute(sql`
			INSERT INTO leagues (league_id, name, status)
			VALUES (${LEAGUE_ID}, 'player team links', 'LIVE')
			ON CONFLICT (league_id) DO NOTHING
		`)
		await db.transaction(async (tx) => {
			await persistMatchRecord(
				tx,
				{
					match_id: MATCH_ID,
					match_seq_num: 1,
					leagueid: LEAGUE_ID,
					radiant_team_id: RADIANT_TEAM,
					dire_team_id: DIRE_TEAM,
					radiant_team_name: 'Radiant',
					dire_team_name: 'Dire',
					radiant_captain: ACCOUNT_A,
					dire_captain: ACCOUNT_B,
					start_time: 1_700_000_000,
					picks_bans: [
						{ is_pick: true, hero_id: 1, team: 0, order: 0 },
						{ is_pick: true, hero_id: 2, team: 1, order: 1 },
					],
					players: [
						{
							account_id: ACCOUNT_A,
							player_slot: 0,
							hero_id: 1,
							kills: 1,
							permanent_buffs: [{ permanent_buff: 12, stack_count: 2 }],
						},
						{
							account_id: ACCOUNT_B,
							player_slot: 128,
							hero_id: 2,
							kills: 0,
						},
					],
				},
				{ mustExist: false, skipStoryObjectives: true, fetched: 'seq' },
			)
		})

		const [radiant] = await db.execute(sql`
			SELECT account_id, player_id, team_id
			FROM match_players
			WHERE match_id = ${MATCH_ID} AND player_slot = 0
		`)
		const [dire] = await db.execute(sql`
			SELECT account_id, player_id, team_id
			FROM match_players
			WHERE match_id = ${MATCH_ID} AND player_slot = 128
		`)
		const [playerA] = await db.execute(sql`
			SELECT id FROM players WHERE account_id = ${ACCOUNT_A}
		`)
		const [playerB] = await db.execute(sql`
			SELECT id FROM players WHERE account_id = ${ACCOUNT_B}
		`)
		expect(asNumber(radiant?.account_id)).toBe(ACCOUNT_A)
		expect(asNumber(radiant?.player_id)).toBe(asNumber(playerA?.id))
		expect(asNumber(radiant?.team_id)).toBe(RADIANT_TEAM)
		expect(asNumber(dire?.account_id)).toBe(ACCOUNT_B)
		expect(asNumber(dire?.player_id)).toBe(asNumber(playerB?.id))
		expect(asNumber(dire?.team_id)).toBe(DIRE_TEAM)

		const [buff] = await db.execute(sql`
			SELECT account_id, player_id, team_id, stacks
			FROM match_player_buffs
			WHERE match_id = ${MATCH_ID} AND player_slot = 0 AND buff_id = 12
		`)
		expect(asNumber(buff?.account_id)).toBe(ACCOUNT_A)
		expect(asNumber(buff?.player_id)).toBe(asNumber(playerA?.id))
		expect(asNumber(buff?.team_id)).toBe(RADIANT_TEAM)
		expect(asNumber(buff?.stacks)).toBe(2)

		const draft = await db.execute(sql`
			SELECT hero_id, team_id, player_id, account_id
			FROM match_draft
			WHERE match_id = ${MATCH_ID}
			ORDER BY ord
		`)
		expect(asNumber(draft[0]?.team_id)).toBe(RADIANT_TEAM)
		expect(asNumber(draft[0]?.player_id)).toBe(asNumber(playerA?.id))
		expect(asNumber(draft[0]?.account_id)).toBe(ACCOUNT_A)
		expect(asNumber(draft[1]?.team_id)).toBe(DIRE_TEAM)
		expect(asNumber(draft[1]?.player_id)).toBe(asNumber(playerB?.id))

		const [match] = await db.execute(sql`
			SELECT radiant_captain_player_id, dire_captain_player_id
			FROM matches
			WHERE match_id = ${MATCH_ID}
		`)
		expect(asNumber(match?.radiant_captain_player_id)).toBe(
			asNumber(playerA?.id),
		)
		expect(asNumber(match?.dire_captain_player_id)).toBe(asNumber(playerB?.id))
	})

	test('player_id stays null until the players row exists', async () => {
		await cleanup()
		await db.execute(sql`
			INSERT INTO leagues (league_id, name, status)
			VALUES (${LEAGUE_ID}, 'player team links', 'LIVE')
			ON CONFLICT (league_id) DO NOTHING
		`)
		await db.transaction(async (tx) => {
			await upsertTeam(tx, RADIANT_TEAM, 'Radiant')
			await tx.execute(sql`
				INSERT INTO matches (
					match_id, league_id, status, start_time, radiant_team_id
				)
				VALUES (
					${LATE_ID}, ${LEAGUE_ID}, 'discovered', 1_700_000_000,
					${RADIANT_TEAM}
				)
			`)
			await upsertMatchPlayers(tx, LATE_ID, [
				partialPlayerFacts({
					accountId: ACCOUNT_LATE,
					playerSlot: 0,
					heroId: 1,
				}),
			])
		})
		const [before] = await db.execute(sql`
			SELECT account_id, player_id, team_id
			FROM match_players
			WHERE match_id = ${LATE_ID} AND player_slot = 0
		`)
		expect(asNumber(before?.account_id)).toBe(ACCOUNT_LATE)
		expect(before?.player_id).toBeNull()
		expect(asNumber(before?.team_id)).toBe(RADIANT_TEAM)

		await db.transaction(async (tx) => {
			await upsertPlayer(tx, { accountId: ACCOUNT_LATE, isPro: true })
			await fillMatchPlayerLinks(tx, LATE_ID)
		})
		const [after] = await db.execute(sql`
			SELECT player_id
			FROM match_players
			WHERE match_id = ${LATE_ID} AND player_slot = 0
		`)
		const [player] = await db.execute(sql`
			SELECT id FROM players WHERE account_id = ${ACCOUNT_LATE}
		`)
		expect(asNumber(after?.player_id)).toBe(asNumber(player?.id))
	})
})
