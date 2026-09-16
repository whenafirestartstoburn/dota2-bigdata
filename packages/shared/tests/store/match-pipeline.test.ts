import { afterAll, describe, expect, test } from 'bun:test'
import { asNumber } from '#src/store/coerce'
import { INGEST } from '#src/store/match-phase'
import {
	finishMissingLiveMatches,
	listDueHistoryLeagueIds,
	markHistoryAvailable,
	markSeqFetched,
	noteLiveClock,
	noteLiveFeedMisses,
	noteLiveFeedSeen,
	recordHistoryPollMisses,
	touchMatchLive,
	upsertHistoryMatches,
	upsertTeam,
} from '#src/store/matches'
import { persistMatchRecord } from '#src/store/persist-match'
import { db, sql } from '#src/utils/db'

const LIVE_ID = 9_900_060_001
const BOTH_ID = 9_900_060_002
const HIST_ID = 9_900_060_003
const WAIT_ID = 9_900_060_004
const IDLE_ID = 9_900_060_005
const MERGE_ID = 9_900_060_006
const SEQ_ID = 9_900_060_007
const GC_AHEAD_ID = 9_900_060_008
const DRAFT_CLOCK_ID = 9_900_060_009
const MERGE_FACTS_ID = 9_900_060_010
const LIVE_KDA_ID = 9_900_060_011
const DRAFT_REPLACE_ID = 9_900_060_012
const LEAGUE_ID = 9_900_061
const RADIANT_TEAM = 9_900_062
const DIRE_TEAM = 9_900_063

async function cleanup(): Promise<void> {
	await db.execute(sql`
		DELETE FROM match_player_ability_upgrades
		WHERE match_id IN (
			${LIVE_ID}, ${BOTH_ID}, ${HIST_ID}, ${WAIT_ID}, ${IDLE_ID}, ${MERGE_ID},
			${SEQ_ID}, ${GC_AHEAD_ID}, ${DRAFT_CLOCK_ID}, ${MERGE_FACTS_ID},
			${LIVE_KDA_ID}, ${DRAFT_REPLACE_ID}
		)
	`)
	await db.execute(sql`
		DELETE FROM match_players
		WHERE match_id IN (
			${LIVE_ID}, ${BOTH_ID}, ${HIST_ID}, ${WAIT_ID}, ${IDLE_ID}, ${MERGE_ID},
			${SEQ_ID}, ${GC_AHEAD_ID}, ${DRAFT_CLOCK_ID}, ${MERGE_FACTS_ID},
			${LIVE_KDA_ID}, ${DRAFT_REPLACE_ID}
		)
	`)
	await db.execute(sql`
		DELETE FROM matches
		WHERE match_id IN (
			${LIVE_ID}, ${BOTH_ID}, ${HIST_ID}, ${WAIT_ID}, ${IDLE_ID}, ${MERGE_ID},
			${SEQ_ID}, ${GC_AHEAD_ID}, ${DRAFT_CLOCK_ID}, ${MERGE_FACTS_ID},
			${LIVE_KDA_ID}, ${DRAFT_REPLACE_ID}
		)
	`)
	await db.execute(sql`DELETE FROM leagues WHERE league_id = ${LEAGUE_ID}`)
	await db.execute(sql`
		DELETE FROM teams
		WHERE team_id IN (${RADIANT_TEAM}, ${DIRE_TEAM})
	`)
}

afterAll(cleanup)

async function missOnly(
	tx: Parameters<typeof noteLiveFeedMisses>[0],
	feed: typeof INGEST.liveLeague | typeof INGEST.topLive,
	matchId: number,
): Promise<void> {
	const rows = await tx.execute(sql`
		SELECT match_id FROM matches
		WHERE status = 'live' AND match_id <> ${matchId}
	`)
	const seen = rows
		.map((row) => asNumber(row.match_id))
		.filter((id): id is number => id != null)
	await noteLiveFeedMisses(tx, feed, seen)
}

describe('live finish detection', () => {
	test('finishes a GetLiveLeagueGames match after enough DB misses', async () => {
		await cleanup()
		await db.execute(sql`
			INSERT INTO leagues (league_id, name, status)
			VALUES (${LEAGUE_ID}, 'pipeline test', 'LIVE')
			ON CONFLICT (league_id) DO NOTHING
		`)
		await db.transaction(async (tx) => {
			await touchMatchLive(tx, {
				matchId: LIVE_ID,
				leagueId: LEAGUE_ID,
				leagueNodeId: 0,
				seriesId: null,
				seriesType: 0,
				radiantSeriesWins: 0,
				direSeriesWins: 0,
				streamDelayS: 0,
				radiantTeamId: null,
				direTeamId: null,
				radiantTeamName: null,
				direTeamName: null,
				ingest: INGEST.liveLeague,
			})
			await noteLiveClock(tx, LIVE_ID, 90)
			await missOnly(tx, INGEST.liveLeague, LIVE_ID)
			const early = await finishMissingLiveMatches(tx, 2, 1_800_000)
			expect(early).not.toContain(LIVE_ID)
			await missOnly(tx, INGEST.liveLeague, LIVE_ID)
			const done = await finishMissingLiveMatches(tx, 2, 1_800_000)
			expect(done.filter((id) => id === LIVE_ID)).toEqual([LIVE_ID])
		})
		const [row] = await db.execute(sql`
			SELECT status, ingest_sources, source
			FROM matches WHERE match_id = ${LIVE_ID}
		`)
		expect(row?.status).toBe('awaiting_history')
		expect(row?.source).toBe('live')
		expect(row?.ingest_sources).toContain(INGEST.liveLeague)
	})

	test('marks a listing that never started as not_started', async () => {
		await cleanup()
		await db.execute(sql`
			INSERT INTO leagues (league_id, name, status)
			VALUES (${LEAGUE_ID}, 'pipeline test', 'LIVE')
			ON CONFLICT (league_id) DO NOTHING
		`)
		await db.transaction(async (tx) => {
			await touchMatchLive(tx, {
				matchId: IDLE_ID,
				leagueId: LEAGUE_ID,
				leagueNodeId: 0,
				seriesId: null,
				seriesType: 0,
				radiantSeriesWins: 0,
				direSeriesWins: 0,
				streamDelayS: 0,
				radiantTeamId: null,
				direTeamId: null,
				radiantTeamName: null,
				direTeamName: null,
				ingest: INGEST.liveLeague,
			})
			await missOnly(tx, INGEST.liveLeague, IDLE_ID)
			await missOnly(tx, INGEST.liveLeague, IDLE_ID)
			const done = await finishMissingLiveMatches(tx, 2, 1_800_000)
			expect(done.filter((id) => id === IDLE_ID)).toEqual([IDLE_ID])
		})
		const [row] = await db.execute(sql`
			SELECT status, last_error_kind, history_next_poll_at,
				finished_at
			FROM matches WHERE match_id = ${IDLE_ID}
		`)
		expect(row?.status).toBe('not_started')
		expect(row?.last_error_kind).toBe('not_started')
		expect(row?.history_next_poll_at).toBeNull()
		expect(row?.finished_at).toBeNull()
		const due = await listDueHistoryLeagueIds()
		expect(due).not.toContain(LEAGUE_ID)

		await db.transaction(async (tx) => {
			await touchMatchLive(tx, {
				matchId: IDLE_ID,
				leagueId: LEAGUE_ID,
				leagueNodeId: 0,
				seriesId: null,
				seriesType: 0,
				radiantSeriesWins: 0,
				direSeriesWins: 0,
				streamDelayS: 0,
				radiantTeamId: null,
				direTeamId: null,
				radiantTeamName: null,
				direTeamName: null,
				ingest: INGEST.liveLeague,
			})
		})
		const [flap] = await db.execute(sql`
			SELECT status, last_error_kind
			FROM matches WHERE match_id = ${IDLE_ID}
		`)
		expect(flap?.status).toBe('live')
		expect(flap?.last_error_kind).toBeNull()
	})

	test('a later live sighting flaps awaiting_history back to live', async () => {
		await cleanup()
		await db.execute(sql`
			INSERT INTO leagues (league_id, name, status)
			VALUES (${LEAGUE_ID}, 'pipeline test', 'LIVE')
			ON CONFLICT (league_id) DO NOTHING
		`)
		await db.transaction(async (tx) => {
			await touchMatchLive(tx, {
				matchId: LIVE_ID,
				leagueId: LEAGUE_ID,
				leagueNodeId: 0,
				seriesId: null,
				seriesType: 0,
				radiantSeriesWins: 0,
				direSeriesWins: 0,
				streamDelayS: 0,
				radiantTeamId: null,
				direTeamId: null,
				radiantTeamName: null,
				direTeamName: null,
				ingest: INGEST.liveLeague,
			})
			await noteLiveClock(tx, LIVE_ID, 90)
			await missOnly(tx, INGEST.liveLeague, LIVE_ID)
			await missOnly(tx, INGEST.liveLeague, LIVE_ID)
			const done = await finishMissingLiveMatches(tx, 2, 1_800_000)
			expect(done.filter((id) => id === LIVE_ID)).toEqual([LIVE_ID])
		})
		const [finished] = await db.execute(sql`
			SELECT status, finished_at FROM matches WHERE match_id = ${LIVE_ID}
		`)
		expect(finished?.status).toBe('awaiting_history')
		expect(finished?.finished_at).not.toBeNull()

		await db.transaction(async (tx) => {
			await noteLiveFeedSeen(tx, INGEST.liveLeague, LIVE_ID)
		})
		const [flap] = await db.execute(sql`
			SELECT status, finished_at, replay_available_at,
				history_next_poll_at, live_league_missed_polls
			FROM matches WHERE match_id = ${LIVE_ID}
		`)
		expect(flap?.status).toBe('live')
		expect(flap?.finished_at).toBeNull()
		expect(flap?.replay_available_at).toBeNull()
		expect(flap?.history_next_poll_at).toBeNull()
		expect(asNumber(flap?.live_league_missed_polls)).toBe(0)

		await db.transaction(async (tx) => {
			await tx.execute(sql`
				UPDATE matches
				SET status = 'details_ready'::match_status
				WHERE match_id = ${LIVE_ID}
			`)
			await noteLiveFeedSeen(tx, INGEST.topLive, LIVE_ID)
		})
		const [kept] = await db.execute(sql`
			SELECT status FROM matches WHERE match_id = ${LIVE_ID}
		`)
		expect(kept?.status).toBe('details_ready')
	})

	test('waits for both live feeds when both listed the match', async () => {
		await cleanup()
		await db.execute(sql`
			INSERT INTO leagues (league_id, name, status)
			VALUES (${LEAGUE_ID}, 'pipeline test', 'LIVE')
			ON CONFLICT (league_id) DO NOTHING
		`)
		await db.transaction(async (tx) => {
			await touchMatchLive(tx, {
				matchId: BOTH_ID,
				leagueId: LEAGUE_ID,
				leagueNodeId: 0,
				seriesId: null,
				seriesType: 0,
				radiantSeriesWins: 0,
				direSeriesWins: 0,
				streamDelayS: 0,
				radiantTeamId: null,
				direTeamId: null,
				radiantTeamName: null,
				direTeamName: null,
				ingest: INGEST.liveLeague,
			})
			await touchMatchLive(tx, {
				matchId: BOTH_ID,
				leagueId: LEAGUE_ID,
				leagueNodeId: 0,
				seriesId: null,
				seriesType: 0,
				radiantSeriesWins: 0,
				direSeriesWins: 0,
				streamDelayS: 0,
				radiantTeamId: null,
				direTeamId: null,
				radiantTeamName: null,
				direTeamName: null,
				ingest: INGEST.topLive,
				serverSteamId: 1,
			})
			await missOnly(tx, INGEST.liveLeague, BOTH_ID)
			await missOnly(tx, INGEST.liveLeague, BOTH_ID)
			const onlyLive = await finishMissingLiveMatches(tx, 2, 1000)
			expect(onlyLive).not.toContain(BOTH_ID)
			await missOnly(tx, INGEST.topLive, BOTH_ID)
			await missOnly(tx, INGEST.topLive, BOTH_ID)
			const both = await finishMissingLiveMatches(tx, 2, 1000)
			expect(both.filter((id) => id === BOTH_ID)).toEqual([BOTH_ID])
		})
	})

	test('merges GetLiveLeagueGames and GetTopLiveGame onto one row', async () => {
		await cleanup()
		await db.execute(sql`
			INSERT INTO leagues (league_id, name, status)
			VALUES (${LEAGUE_ID}, 'pipeline test', 'LIVE')
			ON CONFLICT (league_id) DO NOTHING
		`)
		await db.transaction(async (tx) => {
			await upsertTeam(tx, RADIANT_TEAM, 'NaVi')
			await upsertTeam(tx, DIRE_TEAM, 'LGD')
			await touchMatchLive(tx, {
				matchId: MERGE_ID,
				leagueId: LEAGUE_ID,
				leagueNodeId: 44,
				seriesId: null,
				seriesType: 1,
				radiantSeriesWins: 1,
				direSeriesWins: 0,
				streamDelayS: 120,
				radiantTeamId: RADIANT_TEAM,
				direTeamId: DIRE_TEAM,
				radiantTeamName: 'NaVi',
				direTeamName: 'LGD',
				lobbyId: 7_001,
				ingest: INGEST.liveLeague,
			})
			await touchMatchLive(tx, {
				matchId: MERGE_ID,
				leagueId: LEAGUE_ID,
				leagueNodeId: null,
				seriesId: null,
				seriesType: null,
				radiantSeriesWins: null,
				direSeriesWins: null,
				streamDelayS: 90,
				radiantTeamId: null,
				direTeamId: null,
				radiantTeamName: null,
				direTeamName: null,
				ingest: INGEST.topLive,
				serverSteamId: '90123456789012345',
			})
		})
		const [row] = await db.execute(sql`
			SELECT
				status, source, ingest_sources, lobby_id, server_steam_id,
				radiant_team_id, dire_team_id, radiant_team_name, dire_team_name,
				series_id, series_type, radiant_series_wins, dire_series_wins,
				league_node_id, stream_delay_s
			FROM matches WHERE match_id = ${MERGE_ID}
		`)
		expect(row?.status).toBe('live')
		expect(row?.source).toBe('live')
		expect(row?.ingest_sources).toEqual(
			expect.arrayContaining([INGEST.liveLeague, INGEST.topLive]),
		)
		expect(Number(row?.lobby_id)).toBe(7_001)
		expect(String(row?.server_steam_id)).toBe('90123456789012345')
		expect(Number(row?.radiant_team_id)).toBe(RADIANT_TEAM)
		expect(Number(row?.dire_team_id)).toBe(DIRE_TEAM)
		expect(row?.radiant_team_name).toBe('NaVi')
		expect(row?.dire_team_name).toBe('LGD')
		expect(Number(row?.series_type)).toBe(1)
		expect(Number(row?.radiant_series_wins)).toBe(1)
		expect(Number(row?.dire_series_wins)).toBe(0)
		expect(Number(row?.league_node_id)).toBe(44)
		expect(Number(row?.stream_delay_s)).toBe(90)
	})
})

describe('history discovery and waiter', () => {
	test('keeps live source sticky and accumulates GetMatchHistory', async () => {
		await cleanup()
		await db.execute(sql`
			INSERT INTO leagues (league_id, name, status)
			VALUES (${LEAGUE_ID}, 'pipeline test', 'LIVE')
			ON CONFLICT (league_id) DO NOTHING
		`)
		await db.transaction(async (tx) => {
			await touchMatchLive(tx, {
				matchId: HIST_ID,
				leagueId: LEAGUE_ID,
				leagueNodeId: 0,
				seriesId: null,
				seriesType: 0,
				radiantSeriesWins: 0,
				direSeriesWins: 0,
				streamDelayS: 0,
				radiantTeamId: null,
				direTeamId: null,
				radiantTeamName: null,
				direTeamName: null,
				ingest: INGEST.liveLeague,
			})
			await upsertHistoryMatches(tx, [
				{
					match_id: HIST_ID,
					league_id: LEAGUE_ID,
					match_seq_num: 11,
					start_time: 1,
					lobby_type: 1,
					series_id: null,
					series_type: null,
					radiant_team_id: null,
					dire_team_id: null,
				},
			])
		})
		const [row] = await db.execute(sql`
			SELECT source, status, ingest_sources
			FROM matches WHERE match_id = ${HIST_ID}
		`)
		expect(row?.source).toBe('live')
		expect(row?.status).toBe('live')
		expect(row?.ingest_sources).toEqual(
			expect.arrayContaining([INGEST.liveLeague, INGEST.history]),
		)
	})

	test('history miss budget then timeout; hit moves to awaiting_details', async () => {
		await cleanup()
		await db.execute(sql`
			INSERT INTO leagues (league_id, name, status)
			VALUES (${LEAGUE_ID}, 'pipeline test', 'LIVE')
			ON CONFLICT (league_id) DO NOTHING
		`)
		await db.transaction(async (tx) => {
			await touchMatchLive(tx, {
				matchId: WAIT_ID,
				leagueId: LEAGUE_ID,
				leagueNodeId: 0,
				seriesId: null,
				seriesType: 0,
				radiantSeriesWins: 0,
				direSeriesWins: 0,
				streamDelayS: 0,
				radiantTeamId: null,
				direTeamId: null,
				radiantTeamName: null,
				direTeamName: null,
				ingest: INGEST.liveLeague,
			})
			await noteLiveClock(tx, WAIT_ID, 12)
			await noteLiveFeedMisses(tx, INGEST.liveLeague, [])
			await noteLiveFeedMisses(tx, INGEST.liveLeague, [])
			await finishMissingLiveMatches(tx, 2, 1000)
			await recordHistoryPollMisses(tx, [WAIT_ID], {
				fastLimit: 1,
				slowLimit: 1,
				fastMs: 5000,
				slowMs: 60_000,
			})
		})
		const [afterFast] = await db.execute(sql`
			SELECT status, history_poll_fast_count, history_poll_slow_count
			FROM matches WHERE match_id = ${WAIT_ID}
		`)
		expect(afterFast?.status).toBe('awaiting_history')
		expect(Number(afterFast?.history_poll_fast_count)).toBe(1)

		await db.transaction(async (tx) => {
			await recordHistoryPollMisses(tx, [WAIT_ID], {
				fastLimit: 1,
				slowLimit: 1,
				fastMs: 5000,
				slowMs: 60_000,
			})
		})
		const [afterSlow] = await db.execute(sql`
			SELECT status, history_poll_slow_count
			FROM matches WHERE match_id = ${WAIT_ID}
		`)
		expect(afterSlow?.status).toBe('awaiting_history')
		expect(Number(afterSlow?.history_poll_slow_count)).toBe(1)

		await db.transaction(async (tx) => {
			await recordHistoryPollMisses(tx, [WAIT_ID], {
				fastLimit: 1,
				slowLimit: 1,
				fastMs: 5000,
				slowMs: 60_000,
			})
		})
		const [failed] = await db.execute(sql`
			SELECT status, last_error_kind
			FROM matches WHERE match_id = ${WAIT_ID}
		`)
		expect(failed?.status).toBe('failed')
		expect(failed?.last_error_kind).toBe('history_timeout')

		await db.execute(sql`
			UPDATE matches
			SET status = 'awaiting_history', last_error_kind = NULL
			WHERE match_id = ${WAIT_ID}
		`)
		await db.transaction(async (tx) => {
			await markHistoryAvailable(tx, {
				matchId: WAIT_ID,
				leagueId: LEAGUE_ID,
				matchSeqNum: 42,
				startTime: 10,
				lobbyType: 1,
				seriesId: null,
				seriesType: null,
				radiantTeamId: null,
				direTeamId: null,
			})
		})
		const [ready] = await db.execute(sql`
			SELECT status, match_seq_num, history_next_poll_at,
				history_last_polled_at
			FROM matches WHERE match_id = ${WAIT_ID}
		`)
		expect(ready?.status).toBe('awaiting_details')
		expect(Number(ready?.match_seq_num)).toBe(42)
		expect(ready?.history_next_poll_at).toBeNull()
		expect(ready?.history_last_polled_at).toBeTruthy()
	})

	test('history waiter stays armed after GC advances status', async () => {
		await cleanup()
		await db.execute(sql`
			INSERT INTO leagues (league_id, name, status)
			VALUES (${LEAGUE_ID}, 'pipeline test', 'LIVE')
			ON CONFLICT (league_id) DO NOTHING
		`)
		await db.transaction(async (tx) => {
			await touchMatchLive(tx, {
				matchId: GC_AHEAD_ID,
				leagueId: LEAGUE_ID,
				leagueNodeId: 0,
				seriesId: null,
				seriesType: 0,
				radiantSeriesWins: 0,
				direSeriesWins: 0,
				streamDelayS: 0,
				radiantTeamId: null,
				direTeamId: null,
				radiantTeamName: null,
				direTeamName: null,
				ingest: INGEST.liveLeague,
			})
			await noteLiveClock(tx, GC_AHEAD_ID, 12)
			await noteLiveFeedMisses(tx, INGEST.liveLeague, [])
			await noteLiveFeedMisses(tx, INGEST.liveLeague, [])
			await finishMissingLiveMatches(tx, 2, 1000)
			await tx.execute(sql`
				UPDATE matches
				SET
					status = 'parsed'::match_status,
					details_fetched_at = now()
				WHERE match_id = ${GC_AHEAD_ID}
			`)
		})
		const due = await listDueHistoryLeagueIds()
		expect(due).toContain(LEAGUE_ID)

		await db.transaction(async (tx) => {
			await recordHistoryPollMisses(tx, [GC_AHEAD_ID], {
				fastLimit: 1,
				slowLimit: 1,
				fastMs: 5000,
				slowMs: 60_000,
			})
			await recordHistoryPollMisses(tx, [GC_AHEAD_ID], {
				fastLimit: 1,
				slowLimit: 1,
				fastMs: 5000,
				slowMs: 60_000,
			})
			await recordHistoryPollMisses(tx, [GC_AHEAD_ID], {
				fastLimit: 1,
				slowLimit: 1,
				fastMs: 5000,
				slowMs: 60_000,
			})
		})
		const [row] = await db.execute(sql`
			SELECT status, last_error_kind, history_next_poll_at, match_seq_num
			FROM matches WHERE match_id = ${GC_AHEAD_ID}
		`)
		expect(row?.status).toBe('parsed')
		expect(row?.last_error_kind).toBeNull()
		expect(row?.history_next_poll_at).toBeNull()
		expect(row?.match_seq_num).toBeNull()
		expect(await listDueHistoryLeagueIds()).not.toContain(LEAGUE_ID)
	})

	test('history hit still stamps seqnum after GC already ran', async () => {
		await cleanup()
		await db.execute(sql`
			INSERT INTO leagues (league_id, name, status)
			VALUES (${LEAGUE_ID}, 'pipeline test', 'LIVE')
			ON CONFLICT (league_id) DO NOTHING
		`)
		await db.transaction(async (tx) => {
			await upsertHistoryMatches(tx, [
				{
					match_id: SEQ_ID,
					league_id: LEAGUE_ID,
					match_seq_num: 1,
					start_time: 1,
					lobby_type: 1,
					series_id: null,
					series_type: null,
					radiant_team_id: null,
					dire_team_id: null,
				},
			])
			await tx.execute(sql`
				UPDATE matches
				SET
					status = 'details_ready'::match_status,
					history_next_poll_at = now()
				WHERE match_id = ${SEQ_ID}
			`)
			await markHistoryAvailable(tx, {
				matchId: SEQ_ID,
				leagueId: LEAGUE_ID,
				matchSeqNum: 99,
				startTime: 10,
				lobbyType: 1,
				seriesId: null,
				seriesType: null,
				radiantTeamId: null,
				direTeamId: null,
			})
		})
		const [row] = await db.execute(sql`
			SELECT status, match_seq_num, history_next_poll_at
			FROM matches WHERE match_id = ${SEQ_ID}
		`)
		expect(row?.status).toBe('details_ready')
		expect(Number(row?.match_seq_num)).toBe(99)
		expect(row?.history_next_poll_at).toBeNull()
	})

	test('seq persist writes captains and box score', async () => {
		await cleanup()
		await db.execute(sql`
			INSERT INTO leagues (league_id, name, status)
			VALUES (${LEAGUE_ID}, 'pipeline test', 'LIVE')
			ON CONFLICT (league_id) DO NOTHING
		`)
		await db.transaction(async (tx) => {
			await persistMatchRecord(
				tx,
				{
					match_id: SEQ_ID,
					match_seq_num: 55,
					leagueid: LEAGUE_ID,
					radiant_win: true,
					duration: 100,
					start_time: 1_700_000_000,
					radiant_captain: 111,
					dire_captain: 222,
					radiant_score: 13,
					dire_score: 3,
					players: [
						{
							account_id: 111,
							player_slot: 0,
							hero_id: 1,
							kills: 5,
						},
					],
				},
				{ mustExist: false, skipStoryObjectives: true, fetched: 'seq' },
			)
		})
		const [row] = await db.execute(sql`
			SELECT radiant_captain, dire_captain, radiant_score, seq_fetched_at,
				ingest_sources
			FROM matches WHERE match_id = ${SEQ_ID}
		`)
		expect(Number(row?.radiant_captain)).toBe(111)
		expect(Number(row?.dire_captain)).toBe(222)
		expect(Number(row?.radiant_score)).toBe(13)
		expect(row?.seq_fetched_at).toBeTruthy()
		expect(row?.ingest_sources).toEqual(
			expect.arrayContaining(['GetMatchHistoryBySequenceNum']),
		)
	})

	test('seq persist keeps parser-stamped draft clocks', async () => {
		await cleanup()
		await db.execute(sql`
			INSERT INTO leagues (league_id, name, status)
			VALUES (${LEAGUE_ID}, 'pipeline test', 'LIVE')
			ON CONFLICT (league_id) DO NOTHING
		`)
		await db.execute(sql`
			INSERT INTO matches (match_id, league_id, status, start_time)
			VALUES (${DRAFT_CLOCK_ID}, ${LEAGUE_ID}, 'parsed', 1_700_000_000)
		`)
		await db.execute(sql`
			INSERT INTO match_draft
				(match_id, ord, is_pick, hero_id, team, clock)
			VALUES
				(${DRAFT_CLOCK_ID}, 0, false, 63, 0, 26),
				(${DRAFT_CLOCK_ID}, 1, true, 87, 1, 63)
		`)
		await db.transaction(async (tx) => {
			await persistMatchRecord(
				tx,
				{
					match_id: DRAFT_CLOCK_ID,
					match_seq_num: 88,
					leagueid: LEAGUE_ID,
					duration: 100,
					start_time: 1_700_000_000,
					picks_bans: [
						{ is_pick: false, hero_id: 63, team: 0, order: 0 },
						{ is_pick: true, hero_id: 87, team: 1, order: 1 },
					],
				},
				{ mustExist: true, skipStoryObjectives: true, fetched: 'seq' },
			)
		})
		const rows = await db.execute(sql`
			SELECT hero_id, is_pick, clock
			FROM match_draft
			WHERE match_id = ${DRAFT_CLOCK_ID}
			ORDER BY ord
		`)
		expect(rows).toHaveLength(2)
		expect(Number(rows[0]?.clock)).toBe(26)
		expect(Number(rows[1]?.clock)).toBe(63)
	})

	test('later GC persist fills missing facts and keeps seq values', async () => {
		await cleanup()
		await db.execute(sql`
			INSERT INTO leagues (league_id, name, status)
			VALUES (${LEAGUE_ID}, 'pipeline test', 'LIVE')
			ON CONFLICT (league_id) DO NOTHING
		`)
		await db.transaction(async (tx) => {
			await persistMatchRecord(
				tx,
				{
					match_id: MERGE_FACTS_ID,
					match_seq_num: 10,
					leagueid: LEAGUE_ID,
					radiant_captain: 111,
					start_time: 1_700_000_000,
					players: [{ account_id: 111, player_slot: 0, hero_id: 1, kills: 7 }],
				},
				{ mustExist: false, skipStoryObjectives: true, fetched: 'seq' },
			)
		})
		await db.transaction(async (tx) => {
			await persistMatchRecord(
				tx,
				{
					match_id: MERGE_FACTS_ID,
					leagueid: LEAGUE_ID,
					radiant_captain: 999,
					duration: 1800,
					start_time: 1_700_000_000,
					players: [{ account_id: 111, player_slot: 0, hero_id: 2, kills: 20 }],
				},
				{ mustExist: true, skipStoryObjectives: true, fetched: 'gc' },
			)
		})
		const [match] = await db.execute(sql`
			SELECT radiant_captain, duration
			FROM matches WHERE match_id = ${MERGE_FACTS_ID}
		`)
		expect(Number(match?.radiant_captain)).toBe(111)
		expect(Number(match?.duration)).toBe(1800)
		const [player] = await db.execute(sql`
			SELECT hero_id, kills
			FROM match_players
			WHERE match_id = ${MERGE_FACTS_ID} AND player_slot = 0
		`)
		expect(Number(player?.hero_id)).toBe(1)
		expect(Number(player?.kills)).toBe(7)
	})

	test('first seq persist overwrites live KDA, later GC does not', async () => {
		await cleanup()
		await db.execute(sql`
			INSERT INTO leagues (league_id, name, status)
			VALUES (${LEAGUE_ID}, 'pipeline test', 'LIVE')
			ON CONFLICT (league_id) DO NOTHING
		`)
		await db.execute(sql`
			INSERT INTO matches (match_id, league_id, status, start_time)
			VALUES (${LIVE_KDA_ID}, ${LEAGUE_ID}, 'awaiting_history', 1_700_000_000)
		`)
		await db.execute(sql`
			INSERT INTO match_players
				(match_id, player_slot, account_id, hero_id, side, kills)
			VALUES (${LIVE_KDA_ID}, 0, 111, 1, 'radiant', 3)
		`)
		await db.transaction(async (tx) => {
			await persistMatchRecord(
				tx,
				{
					match_id: LIVE_KDA_ID,
					match_seq_num: 11,
					leagueid: LEAGUE_ID,
					start_time: 1_700_000_000,
					players: [{ account_id: 111, player_slot: 0, hero_id: 1, kills: 12 }],
				},
				{ mustExist: true, skipStoryObjectives: true, fetched: 'seq' },
			)
		})
		const [afterSeq] = await db.execute(sql`
			SELECT kills FROM match_players
			WHERE match_id = ${LIVE_KDA_ID} AND player_slot = 0
		`)
		expect(Number(afterSeq?.kills)).toBe(12)
		await db.transaction(async (tx) => {
			await persistMatchRecord(
				tx,
				{
					match_id: LIVE_KDA_ID,
					leagueid: LEAGUE_ID,
					start_time: 1_700_000_000,
					players: [{ account_id: 111, player_slot: 0, hero_id: 1, kills: 99 }],
				},
				{ mustExist: true, skipStoryObjectives: true, fetched: 'gc' },
			)
		})
		const [afterGc] = await db.execute(sql`
			SELECT kills FROM match_players
			WHERE match_id = ${LIVE_KDA_ID} AND player_slot = 0
		`)
		expect(Number(afterGc?.kills)).toBe(12)
	})

	test('complete seq draft replaces live stub, later GC keeps it', async () => {
		await cleanup()
		await db.execute(sql`
			INSERT INTO leagues (league_id, name, status)
			VALUES (${LEAGUE_ID}, 'pipeline test', 'LIVE')
			ON CONFLICT (league_id) DO NOTHING
		`)
		await db.execute(sql`
			INSERT INTO matches (match_id, league_id, status, start_time)
			VALUES (${DRAFT_REPLACE_ID}, ${LEAGUE_ID}, 'live', 1_700_000_000)
		`)
		await db.execute(sql`
			INSERT INTO match_draft (match_id, ord, is_pick, hero_id, team)
			VALUES (${DRAFT_REPLACE_ID}, 0, false, 63, 0)
		`)
		const official = Array.from({ length: 24 }, (_, i) => ({
			is_pick: i >= 14,
			hero_id: i + 1,
			team: i % 2,
			order: i,
		}))
		await db.transaction(async (tx) => {
			await persistMatchRecord(
				tx,
				{
					match_id: DRAFT_REPLACE_ID,
					match_seq_num: 12,
					leagueid: LEAGUE_ID,
					start_time: 1_700_000_000,
					picks_bans: official,
				},
				{ mustExist: true, skipStoryObjectives: true, fetched: 'seq' },
			)
		})
		const afterSeq = await db.execute(sql`
			SELECT hero_id FROM match_draft
			WHERE match_id = ${DRAFT_REPLACE_ID}
			ORDER BY ord
		`)
		expect(afterSeq).toHaveLength(24)
		expect(Number(afterSeq[0]?.hero_id)).toBe(1)
		await db.transaction(async (tx) => {
			await persistMatchRecord(
				tx,
				{
					match_id: DRAFT_REPLACE_ID,
					leagueid: LEAGUE_ID,
					start_time: 1_700_000_000,
					picks_bans: official.map((row) => ({
						...row,
						hero_id: row.hero_id + 100,
					})),
				},
				{ mustExist: true, skipStoryObjectives: true, fetched: 'gc' },
			)
		})
		const afterGc = await db.execute(sql`
			SELECT hero_id FROM match_draft
			WHERE match_id = ${DRAFT_REPLACE_ID}
			ORDER BY ord
		`)
		expect(afterGc).toHaveLength(24)
		expect(Number(afterGc[0]?.hero_id)).toBe(1)
	})

	test('seq_fetched_at is first-write-wins across a window', async () => {
		await cleanup()
		await db.execute(sql`
			INSERT INTO leagues (league_id, name, status)
			VALUES (${LEAGUE_ID}, 'pipeline test', 'LIVE')
			ON CONFLICT (league_id) DO NOTHING
		`)
		await db.transaction(async (tx) => {
			await upsertHistoryMatches(tx, [
				{
					match_id: HIST_ID,
					league_id: LEAGUE_ID,
					match_seq_num: 7,
					start_time: 1,
					lobby_type: 1,
					series_id: null,
					series_type: null,
					radiant_team_id: null,
					dire_team_id: null,
				},
			])
			await markSeqFetched(tx, [HIST_ID])
		})
		const [first] = await db.execute(sql`
			SELECT seq_fetched_at FROM matches WHERE match_id = ${HIST_ID}
		`)
		expect(first?.seq_fetched_at).toBeTruthy()
		await Bun.sleep(20)
		await db.transaction(async (tx) => {
			await markSeqFetched(tx, [HIST_ID])
		})
		const [second] = await db.execute(sql`
			SELECT seq_fetched_at FROM matches WHERE match_id = ${HIST_ID}
		`)
		expect(second?.seq_fetched_at).toEqual(first?.seq_fetched_at)
	})
})
