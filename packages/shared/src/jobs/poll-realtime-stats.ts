import { insertJsonEachRow } from '#src/components/clickhouse'
import { pickApiCredential, steamCtx } from '#src/components/resources'
import { getAppSettings } from '#src/components/settings'
import { getRealtimeStats, PublicMatchError } from '#src/steam/web-api'
import {
	asComplete,
	asItemId,
	asNumber,
	asPgInt8,
	asSteamId64,
	asUInt32,
	errorMessage,
} from '#src/store/coerce'
import { partialPlayerFacts } from '#src/store/match-details'
import { INGEST } from '#src/store/match-phase'
import {
	clearServerSteamId,
	listLiveRealtimeTargets,
	noteLiveClock,
	replaceMatchDraft,
	touchMatchLive,
	touchRealtimeSeen,
	upsertMatchPlayers,
	upsertPlayer,
	upsertTeam,
} from '#src/store/matches'
import { db } from '#src/utils/db'
import { logger } from '#src/utils/logger'
import { chNow } from './time'

export async function runPollRealtimeStats(): Promise<{
	scanned: number
	wrote: number
}> {
	const settings = await getAppSettings()
	const deadline = Date.now() + settings.livePollIntervalMs
	const targets = await listLiveRealtimeTargets(200)
	if (targets.length === 0) return { scanned: 0, wrote: 0 }

	const cred = await pickApiCredential()
	const ctx = steamCtx(cred, 'live')
	const capturedAt = chNow()
	const tickRows: Array<Record<string, unknown>> = []
	const playerTickRows: Array<Record<string, unknown>> = []
	let wrote = 0
	let scanned = 0

	for (const target of targets) {
		if (Date.now() >= deadline) break
		scanned += 1
		try {
			const stats = await getRealtimeStats(ctx, target.serverSteamId)
			const matchId = asPgInt8(stats.match.match_id) ?? target.matchId
			const leagueId = stats.match.league_id
			if (leagueId <= 0) {
				await clearServerSteamId(target.matchId)
				continue
			}
			await db.transaction(async (tx) => {
				const sides = parseRealtimeTeams(stats.teams)
				await upsertTeam(tx, sides.radiant.teamId, sides.radiant.name)
				await upsertTeam(tx, sides.dire.teamId, sides.dire.name)
				await touchMatchLive(tx, {
					matchId,
					leagueId,
					leagueNodeId: stats.match.league_node_id ?? 0,
					seriesId: null,
					seriesType: 0,
					radiantSeriesWins: 0,
					direSeriesWins: 0,
					streamDelayS: 0,
					radiantTeamId: sides.radiant.teamId,
					direTeamId: sides.dire.teamId,
					radiantTeamName: sides.radiant.name,
					direTeamName: sides.dire.name,
					radiantTeamComplete: asComplete(null),
					ingest: INGEST.topLive,
					serverSteamId: asSteamId64(
						stats.match.server_steam_id ?? target.serverSteamId,
					),
				})
				await touchRealtimeSeen(tx, matchId)
				await noteLiveClock(tx, matchId, asNumber(stats.match.game_time) ?? 0)
				const players = [...sides.radiant.players, ...sides.dire.players]
				await upsertMatchPlayers(tx, matchId, players)
				for (const player of players) {
					await upsertPlayer(tx, {
						accountId: player.accountId,
						personaName: player.playerName,
						isPro: true,
						teamId:
							player.side === 'radiant'
								? sides.radiant.teamId
								: sides.dire.teamId,
						matchId,
					})
				}
				const draft = collectRealtimeDraft(stats.match.picks, stats.match.bans)
				if (draft.length > 0) {
					await replaceMatchDraft(tx, matchId, draft)
				}
			})
			tickRows.push({
				match_id: String(matchId),
				captured_at: capturedAt,
				league_id: leagueId,
				duration: stats.match.game_time ?? 0,
				radiant_score: parseTeamScore(stats.teams, 2),
				dire_score: parseTeamScore(stats.teams, 3),
				spectators: 0,
				tower_state_radiant: 0,
				tower_state_dire: 0,
				barracks_state_radiant: 0,
				barracks_state_dire: 0,
				roshan_respawn_timer: 0,
				series_type: 0,
				radiant_series_wins: 0,
				dire_series_wins: 0,
				stream_delay_s: 0,
				source: 'GetRealtimeStats',
				lobby_id: '0',
				game_number: 0,
				league_series_id: 0,
				league_game_id: 0,
				league_tier: 0,
				game_state: asUInt32(stats.match.game_state),
				server_steam_id: target.serverSteamId,
			})
			appendRealtimePlayerTicks(
				matchId,
				capturedAt,
				stats.teams,
				playerTickRows,
			)
			wrote += 1
		} catch (error) {
			if (error instanceof PublicMatchError) {
				await clearServerSteamId(target.matchId)
				continue
			}
			logger.warn(
				{ matchId: target.matchId, err: errorMessage(error) },
				'realtime stats failed',
			)
		}
	}

	await insertJsonEachRow('live_match_ticks', tickRows)
	await insertJsonEachRow('live_player_ticks', playerTickRows)
	logger.info({ scanned, wrote }, 'realtime stats poll')
	return { scanned, wrote }
}

function parseTeamScore(teams: readonly unknown[], teamNumber: number): number {
	for (const item of teams) {
		const row = asRecord(item)
		if (row == null) continue
		if (asNumber(row.team_number) !== teamNumber) continue
		return asUInt32(row.score)
	}
	return 0
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (typeof value !== 'object' || value === null) return null
	return value as Record<string, unknown>
}

function parseRealtimeTeams(teams: readonly unknown[]): {
	radiant: {
		teamId: number | null
		name: string | null
		players: ReturnType<typeof partialPlayerFacts>[]
	}
	dire: {
		teamId: number | null
		name: string | null
		players: ReturnType<typeof partialPlayerFacts>[]
	}
} {
	const empty = {
		teamId: null as number | null,
		name: null as string | null,
		players: [] as ReturnType<typeof partialPlayerFacts>[],
	}
	const out = {
		radiant: { ...empty, players: empty.players.slice() },
		dire: { ...empty, players: empty.players.slice() },
	}
	for (const item of teams) {
		const row = asRecord(item)
		if (row == null) continue
		const teamNumber = asNumber(row.team_number)
		const side = teamNumber === 2 ? 'radiant' : teamNumber === 3 ? 'dire' : null
		if (side == null) continue
		out[side].teamId = asNumber(row.team_id) || null
		out[side].name = typeof row.team_name === 'string' ? row.team_name : null
		const players = Array.isArray(row.players) ? row.players : []
		out[side].players = players.flatMap((player, index) => {
			const rec = asRecord(player)
			if (rec == null) return []
			const accountId = asNumber(rec.accountid) ?? asNumber(rec.account_id)
			if (accountId == null) return []
			const teamSlot = asNumber(rec.team_slot) ?? index
			const slot = side === 'radiant' ? teamSlot : 128 + teamSlot
			const items = Array.isArray(rec.items) ? rec.items : []
			return [
				partialPlayerFacts({
					accountId,
					playerSlot: slot,
					heroId: asNumber(rec.heroid) ?? asNumber(rec.hero_id) ?? 0,
					playerName: typeof rec.name === 'string' ? rec.name : null,
					teamNumber: side === 'radiant' ? 0 : 1,
					teamSlot,
					side,
					kills: asNumber(rec.kill_count) ?? asNumber(rec.kills),
					deaths: asNumber(rec.death_count) ?? asNumber(rec.deaths),
					assists: asNumber(rec.assists_count) ?? asNumber(rec.assists),
					lastHits: asNumber(rec.lh_count) ?? asNumber(rec.last_hits),
					denies: asNumber(rec.denies_count) ?? asNumber(rec.denies),
					gold: asNumber(rec.gold),
					level: asNumber(rec.level),
					netWorth: asNumber(rec.net_worth),
					item0: asItemId(items[0]),
					item1: asItemId(items[1]),
					item2: asItemId(items[2]),
					item3: asItemId(items[3]),
					item4: asItemId(items[4]),
					item5: asItemId(items[5]),
					item6: asItemId(items[6]),
					item7: asItemId(items[7]),
					item8: asItemId(items[8]),
				}),
			]
		})
	}
	return out
}

function collectRealtimeDraft(
	picks: Array<{ team: number; hero: number }> | undefined,
	bans: Array<{ team: number; hero: number }> | undefined,
) {
	const rows: Array<{
		ord: number
		isPick: boolean
		heroId: number
		team: number
		playerSlot: number | null
		clock: number | null
	}> = []
	let ord = 0
	for (const ban of bans ?? []) {
		if (ban.hero === 0) continue
		rows.push({
			ord,
			isPick: false,
			heroId: ban.hero,
			team: ban.team === 3 ? 1 : 0,
			playerSlot: null,
			clock: null,
		})
		ord += 1
	}
	for (const pick of picks ?? []) {
		if (pick.hero === 0) continue
		rows.push({
			ord,
			isPick: true,
			heroId: pick.hero,
			team: pick.team === 3 ? 1 : 0,
			playerSlot: null,
			clock: null,
		})
		ord += 1
	}
	return rows
}

function appendRealtimePlayerTicks(
	matchId: number,
	capturedAt: string,
	teams: readonly unknown[],
	playerTickRows: Array<Record<string, unknown>>,
): void {
	for (const item of teams) {
		const row = asRecord(item)
		if (row == null) continue
		const teamNumber = asNumber(row.team_number)
		const side = teamNumber === 2 ? 'radiant' : teamNumber === 3 ? 'dire' : null
		if (side == null) continue
		const players = Array.isArray(row.players) ? row.players : []
		for (const [index, player] of players.entries()) {
			const rec = asRecord(player)
			if (rec == null) continue
			const teamSlot = asNumber(rec.team_slot) ?? index
			const slot = side === 'radiant' ? teamSlot : 128 + teamSlot
			const items = Array.isArray(rec.items) ? rec.items : []
			playerTickRows.push({
				match_id: String(matchId),
				captured_at: capturedAt,
				player_slot: asUInt32(slot),
				account_id: String(asUInt32(rec.accountid ?? rec.account_id)),
				hero_id: asNumber(rec.heroid) ?? asNumber(rec.hero_id) ?? 0,
				kills: asUInt32(rec.kill_count ?? rec.kills),
				deaths: asUInt32(rec.death_count ?? rec.deaths),
				assists: asUInt32(rec.assists_count ?? rec.assists),
				last_hits: asUInt32(rec.lh_count ?? rec.last_hits),
				denies: asUInt32(rec.denies_count ?? rec.denies),
				gold: asUInt32(rec.gold),
				net_worth: asUInt32(rec.net_worth),
				level: asUInt32(rec.level),
				gold_per_min: 0,
				xp_per_min: 0,
				x: asNumber(rec.x) ?? 0,
				y: asNumber(rec.y) ?? 0,
				item0: asUInt32(items[0]),
				item1: asUInt32(items[1]),
				item2: asUInt32(items[2]),
				item3: asUInt32(items[3]),
				item4: asUInt32(items[4]),
				item5: asUInt32(items[5]),
				item6: asUInt32(items[6]),
				item7: asUInt32(items[7]),
				item8: asUInt32(items[8]),
				ultimate_state: 0,
				ultimate_cooldown: 0,
				respawn_timer: 0,
				source: 'GetRealtimeStats',
			})
		}
	}
}
