import { countJobs, enqueueJob, PRIORITY, QUEUE } from '#src/components/jobs'
import { pickApiCredential, steamCtx } from '#src/components/resources'
import { getAppSettings } from '#src/components/settings'
import {
	enqueueFetchMatchDetails,
	matchOrigin,
} from '#src/jobs/fetch-match-details'
import { observeHistoryWalk } from '#src/metrics/observe'
import type { HistoryMatch } from '#src/steam/schemas'
import { getMatchHistoryPage } from '#src/steam/web-api'
import { asNumber } from '#src/store/coerce'
import {
	ensureLeagueStub,
	getLeague,
	pickNextHistoryLeague,
	resetLeagueHistory,
	updateLeagueHistoryCursor,
} from '#src/store/leagues'
import { partialPlayerFacts } from '#src/store/match-details'
import {
	upsertHistoryMatches,
	upsertMatchPlayers,
	upsertPlayer,
	upsertSeriesForMatch,
	upsertTeam,
} from '#src/store/matches'
import { db, sql } from '#src/utils/db'
import { logger } from '#src/utils/logger'

export type WalkLeagueInput = {
	leagueId?: number
	matchesLimit?: number | null
	reset?: boolean
}

export const WALK_JOB_KEY = 'walk_league_history'

/** Older pages of this league remain. Empty/newest-only must not pin the walker. */
export function walkHasOlderPages(empty: boolean, noMore: boolean): boolean {
	return !empty && !noMore
}

function newestRefreshDue(
	checkedAt: unknown,
	exhausted: boolean,
	newestMs: number,
	exhaustedMs: number,
): boolean {
	if (checkedAt == null) return true
	const at =
		checkedAt instanceof Date
			? checkedAt.getTime()
			: Date.parse(String(checkedAt))
	if (!Number.isFinite(at)) return true
	const window = exhausted ? exhaustedMs : newestMs
	return Date.now() - at >= window
}

export async function runWalkLeagueHistory(
	input: WalkLeagueInput = {},
): Promise<{ leagueId: number; listed: number } | { skipped: true }> {
	if (input.leagueId != null && input.reset === true) {
		await resetLeagueHistory(input.leagueId)
	}

	const settings = await getAppSettings()
	const detailsLimit = Math.min(
		input.matchesLimit ?? settings.historyDetailsEnqueueLimit,
		settings.historyDetailsEnqueueLimit,
	)
	const league =
		input.leagueId != null
			? await getLeague(input.leagueId)
			: await pickNextHistoryLeague(settings.historyExhaustedRefreshMs)
	if (league == null) {
		observeHistoryWalk({ listed: 0, result: 'skipped' })
		await scheduleNextWalk({
			detailsLimit,
			delayMs: settings.steamApiMinIntervalMs,
		})
		return { skipped: true }
	}

	const leagueId = Number(league.league_id)
	await ensureLeagueStub(leagueId)

	const exhausted = league.history_exhausted === true
	const head = asNumber(league.history_head_match_id)
	const tail = asNumber(league.history_tail_match_id)
	const refreshNewest = newestRefreshDue(
		league.history_checked_at,
		exhausted,
		settings.historyNewestRefreshMs,
		settings.historyExhaustedRefreshMs,
	)

	const cred = await pickApiCredential()
	const ctx = steamCtx(cred, 'historical')

	const fetchNewest = refreshNewest || head == null
	const page = await getMatchHistoryPage(ctx, {
		leagueId,
		startAtMatchId: fetchNewest ? undefined : (tail ?? undefined),
	})

	const listed = page.matches
	await persistListed(leagueId, listed)

	const newest = listed[0]?.match_id ?? head
	const oldest = listed.at(-1)?.match_id ?? tail
	const empty = listed.length === 0
	const noMore = page.resultsRemaining <= 0 || empty || oldest === tail

	if (fetchNewest) {
		await updateLeagueHistoryCursor(leagueId, {
			headMatchId: newest ?? null,
			tailMatchId: oldest ?? tail,
			// Empty newest page: Valve has nothing for this league (or hides it).
			// Leave exhausted=false and we spin forever — head stays null, so
			// every visit is fetchNewest again and self-requeues the same id.
			exhausted: empty,
		})
	} else {
		await updateLeagueHistoryCursor(leagueId, {
			tailMatchId: oldest ?? tail,
			exhausted: empty || noMore,
		})
	}

	const inflightDetails = await countJobs(
		'fetch_match_details',
		PRIORITY.detailsHistorical,
	)
	const room = detailsLimit - inflightDetails
	const pending =
		room <= 0
			? []
			: await db.execute(sql`
					SELECT match_id, source
					FROM matches
					WHERE (seq_fetched_at IS NULL OR details_fetched_at IS NULL)
						AND phase IN (
							'discovered',
							'awaiting_details',
							'details_ready'
						)
					ORDER BY
						CASE WHEN source = 'live' THEN 0 ELSE 1 END,
						start_time DESC NULLS LAST
					LIMIT ${room}
				`)

	for (const row of pending) {
		const matchId = Number(row.match_id)
		await enqueueFetchMatchDetails(matchId, matchOrigin(row.source))
	}

	const detailsQueued = pending.length
	observeHistoryWalk({
		listed: listed.length,
		result: empty ? 'empty' : 'hits',
	})
	await scheduleNextWalk({
		leagueId: walkHasOlderPages(empty, noMore) ? leagueId : undefined,
		detailsLimit,
		delayMs: settings.steamApiMinIntervalMs,
	})

	logger.info(
		{
			leagueId,
			listed: listed.length,
			fetchNewest,
			detailsQueued,
			inflightDetails,
			detailsLimit,
			exhausted: fetchNewest ? false : noMore,
		},
		'walked league history page',
	)
	return { leagueId, listed: listed.length }
}

async function scheduleNextWalk(input: {
	leagueId?: number
	detailsLimit: number
	delayMs: number
}): Promise<void> {
	await enqueueJob({
		identifier: 'walk_league_history',
		payload: {
			...(input.leagueId != null ? { league_id: input.leagueId } : {}),
			matches_limit: input.detailsLimit,
		},
		queueName: QUEUE.historical,
		priority: PRIORITY.walkHistory,
		jobKey: WALK_JOB_KEY,
		jobKeyMode: 'replace',
		runAt: new Date(Date.now() + input.delayMs),
	})
}

async function persistListed(
	leagueId: number,
	listed: readonly HistoryMatch[],
): Promise<void> {
	if (listed.length === 0) return
	await db.transaction(async (tx) => {
		const seriesIds: Array<number | null> = []
		for (const match of listed) {
			await upsertTeam(tx, match.radiant_team_id, undefined)
			await upsertTeam(tx, match.dire_team_id, undefined)
			seriesIds.push(
				await upsertSeriesForMatch(tx, {
					valveSeriesId: match.series_id ?? null,
					leagueId,
					radiantTeamId: match.radiant_team_id || null,
					direTeamId: match.dire_team_id || null,
					seriesType: match.series_type ?? null,
					radiantWins: null,
					direWins: null,
					matchId: match.match_id,
					startTime: match.start_time,
				}),
			)
		}
		await upsertHistoryMatches(
			tx,
			listed.map((match, i) => ({
				match_id: match.match_id,
				league_id: leagueId,
				match_seq_num: match.match_seq_num,
				start_time: match.start_time,
				lobby_type: match.lobby_type,
				series_id:
					seriesIds[i] != null && seriesIds[i] > 0 ? seriesIds[i] : null,
				series_type: match.series_type ?? null,
				radiant_team_id: match.radiant_team_id || null,
				dire_team_id: match.dire_team_id || null,
			})),
		)
		for (const match of listed) {
			const players = match.players.flatMap((item, index) => {
				if (typeof item !== 'object' || item === null) return []
				const row = item as Record<string, unknown>
				const accountId = asNumber(row.account_id)
				if (accountId === null) return []
				const slot = asNumber(row.player_slot) ?? index
				return [
					partialPlayerFacts({
						accountId,
						playerSlot: slot,
						heroId: asNumber(row.hero_id) ?? 0,
						teamNumber: asNumber(row.team_number),
						teamSlot: asNumber(row.team_slot),
						side: slot < 128 ? 'radiant' : 'dire',
					}),
				]
			})
			await upsertMatchPlayers(tx, match.match_id, players)
			for (const player of players) {
				await upsertPlayer(tx, {
					accountId: player.accountId,
					isPro: true,
					teamId:
						player.side === 'radiant'
							? match.radiant_team_id || null
							: match.dire_team_id || null,
					matchId: match.match_id,
					matchAt:
						match.start_time > 0 ? new Date(match.start_time * 1000) : null,
				})
			}
		}
	})
}
