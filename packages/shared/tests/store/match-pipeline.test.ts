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
import { db, sql } from '#src/utils/db'

const LIVE_ID = 9_900_060_001
const BOTH_ID = 9_900_060_002
const HIST_ID = 9_900_060_003
const WAIT_ID = 9_900_060_004
const IDLE_ID = 9_900_060_005
const MERGE_ID = 9_900_060_006
const LEAGUE_ID = 9_900_061
const RADIANT_TEAM = 9_900_062
const DIRE_TEAM = 9_900_063

async function cleanup(): Promise<void> {
	await db.execute(sql`
		DELETE FROM matches
		WHERE match_id IN (
			${LIVE_ID}, ${BOTH_ID}, ${HIST_ID}, ${WAIT_ID}, ${IDLE_ID}, ${MERGE_ID}
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
		WHERE phase = 'live' AND match_id <> ${matchId}
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
			SELECT phase, waiting_for, ingest_sources, source
			FROM matches WHERE match_id = ${LIVE_ID}
		`)
		expect(row?.phase).toBe('awaiting_history')
		expect(row?.waiting_for).toBe('history')
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
			SELECT phase, waiting_for, last_error_kind, history_next_poll_at,
				finished_at
			FROM matches WHERE match_id = ${IDLE_ID}
		`)
		expect(row?.phase).toBe('not_started')
		expect(row?.waiting_for).toBeNull()
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
			SELECT phase, waiting_for, last_error_kind
			FROM matches WHERE match_id = ${IDLE_ID}
		`)
		expect(flap?.phase).toBe('live')
		expect(flap?.waiting_for).toBe('live_end')
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
			SELECT phase, finished_at FROM matches WHERE match_id = ${LIVE_ID}
		`)
		expect(finished?.phase).toBe('awaiting_history')
		expect(finished?.finished_at).not.toBeNull()

		await db.transaction(async (tx) => {
			await noteLiveFeedSeen(tx, INGEST.liveLeague, LIVE_ID)
		})
		const [flap] = await db.execute(sql`
			SELECT phase, waiting_for, finished_at, replay_available_at,
				history_next_poll_at, live_league_missed_polls
			FROM matches WHERE match_id = ${LIVE_ID}
		`)
		expect(flap?.phase).toBe('live')
		expect(flap?.waiting_for).toBe('live_end')
		expect(flap?.finished_at).toBeNull()
		expect(flap?.replay_available_at).toBeNull()
		expect(flap?.history_next_poll_at).toBeNull()
		expect(asNumber(flap?.live_league_missed_polls)).toBe(0)

		await db.transaction(async (tx) => {
			await tx.execute(sql`
				UPDATE matches
				SET phase = 'details_ready'::match_phase, waiting_for = 'replay'
				WHERE match_id = ${LIVE_ID}
			`)
			await noteLiveFeedSeen(tx, INGEST.topLive, LIVE_ID)
		})
		const [kept] = await db.execute(sql`
			SELECT phase, waiting_for FROM matches WHERE match_id = ${LIVE_ID}
		`)
		expect(kept?.phase).toBe('details_ready')
		expect(kept?.waiting_for).toBe('replay')
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
				phase, source, ingest_sources, lobby_id, server_steam_id,
				radiant_team_id, dire_team_id, radiant_team_name, dire_team_name,
				series_id, series_type, radiant_series_wins, dire_series_wins,
				league_node_id, stream_delay_s
			FROM matches WHERE match_id = ${MERGE_ID}
		`)
		expect(row?.phase).toBe('live')
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
			SELECT source, phase, ingest_sources
			FROM matches WHERE match_id = ${HIST_ID}
		`)
		expect(row?.source).toBe('live')
		expect(row?.phase).toBe('live')
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
			SELECT phase, history_poll_fast_count, history_poll_slow_count
			FROM matches WHERE match_id = ${WAIT_ID}
		`)
		expect(afterFast?.phase).toBe('awaiting_history')
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
			SELECT phase, history_poll_slow_count
			FROM matches WHERE match_id = ${WAIT_ID}
		`)
		expect(afterSlow?.phase).toBe('awaiting_history')
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
			SELECT phase, last_error_kind
			FROM matches WHERE match_id = ${WAIT_ID}
		`)
		expect(failed?.phase).toBe('failed')
		expect(failed?.last_error_kind).toBe('history_timeout')

		await db.execute(sql`
			UPDATE matches
			SET phase = 'awaiting_history', last_error_kind = NULL
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
			SELECT phase, waiting_for, match_seq_num
			FROM matches WHERE match_id = ${WAIT_ID}
		`)
		expect(ready?.phase).toBe('awaiting_details')
		expect(ready?.waiting_for).toBe('seq')
		expect(Number(ready?.match_seq_num)).toBe(42)
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
