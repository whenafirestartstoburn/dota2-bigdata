import { insertJsonEachRow } from '#src/components/clickhouse'
import { setCursor } from '#src/components/rate-limit'
import { pickApiCredential, steamCtx } from '#src/components/resources'
import { enqueueFetchMatchDetails } from '#src/jobs/fetch-match-details'
import type { LiveLeagueGame } from '#src/steam/schemas'
import { getLiveLeagueGames } from '#src/steam/web-api'
import { asComplete, asNumber, asPgInt8, asUInt32 } from '#src/store/coerce'
import { ensureLeagueStub } from '#src/store/leagues'
import { partialPlayerFacts } from '#src/store/match-details'
import {
	markMatchesFinishedLive,
	replaceMatchDraft,
	touchMatchLive,
	upsertMatchPlayers,
	upsertPlayer,
	upsertSeriesForMatch,
	upsertTeam,
} from '#src/store/matches'
import { db } from '#src/utils/db'
import env from '#src/utils/env'
import { logger } from '#src/utils/logger'
import { chNow } from './time'

const hashes = new Map<number, string>()
const missingTicks = new Map<number, number>()

function hashOf(value: unknown): string {
	return new Bun.CryptoHasher('sha1')
		.update(JSON.stringify(value))
		.digest('hex')
}

export async function runPollLiveGames(): Promise<{
	games: number
	wrote: number
}> {
	const cred = await pickApiCredential()
	const ctx = steamCtx(cred, 'live')
	const { games } = await getLiveLeagueGames(ctx)

	await setCursor(
		'next_live_poll_at',
		new Date(Date.now() + env.LIVE_POLL_INTERVAL_MS).toISOString(),
	)

	const byId = new Map(games.map((game) => [game.match_id, game]))
	const leagueIds = new Set(
		[...byId.values()].map((game) => game.league_id).filter((id) => id > 0),
	)
	for (const leagueId of leagueIds) {
		await ensureLeagueStub(leagueId)
	}

	const capturedAt = chNow()
	const tickRows: Array<Record<string, unknown>> = []
	const playerTickRows: Array<Record<string, unknown>> = []
	let wrote = 0
	const finished: number[] = []

	await db.transaction(async (tx) => {
		const currentIds = new Set(byId.keys())

		for (const game of byId.values()) {
			await upsertTeam(
				tx,
				game.radiant_team?.team_id,
				game.radiant_team?.team_name,
			)
			await upsertTeam(tx, game.dire_team?.team_id, game.dire_team?.team_name)

			const seriesId = await upsertSeriesForMatch(tx, {
				valveSeriesId: game.series_id ?? null,
				leagueId: game.league_id || null,
				radiantTeamId: game.radiant_team?.team_id || null,
				direTeamId: game.dire_team?.team_id || null,
				seriesType: game.series_type,
				radiantWins: game.radiant_series_wins,
				direWins: game.dire_series_wins,
				matchId: game.match_id,
				startTime: null,
			})

			const digest = hashOf({
				score: game.scoreboard,
				series: [game.radiant_series_wins, game.dire_series_wins],
				players: game.players,
			})
			const changed = hashes.get(game.match_id) !== digest
			if (changed) {
				await touchMatchLive(tx, {
					matchId: game.match_id,
					leagueId: game.league_id,
					leagueNodeId: game.league_node_id,
					seriesId,
					seriesType: game.series_type,
					radiantSeriesWins: game.radiant_series_wins,
					direSeriesWins: game.dire_series_wins,
					streamDelayS: game.stream_delay_s,
					radiantTeamId: game.radiant_team?.team_id || null,
					direTeamId: game.dire_team?.team_id || null,
					radiantTeamName: game.radiant_team?.team_name ?? null,
					direTeamName: game.dire_team?.team_name ?? null,
					lobbyId: asPgInt8(game.lobby_id),
					gameNumber: game.game_number ?? null,
					leagueSeriesId: game.league_series_id ?? null,
					leagueGameId: game.league_game_id ?? null,
					stageName: game.stage_name ?? null,
					leagueTier: game.league_tier ?? null,
					radiantTeamLogo: asPgInt8(game.radiant_team?.team_logo),
					direTeamLogo: asPgInt8(game.dire_team?.team_logo),
					radiantTeamComplete: asComplete(game.radiant_team?.complete),
					direTeamComplete: asComplete(game.dire_team?.complete),
				})

				const roster = game.players
					.filter((player) => player.team === 0 || player.team === 1)
					.map((player, index) => {
						const slot = player.team === 0 ? index : 128 + index
						return partialPlayerFacts({
							accountId: player.account_id,
							playerSlot: slot,
							heroId: player.hero_id,
							playerName: player.name,
							teamNumber: player.team,
							teamSlot: index,
							side: player.team === 0 ? 'radiant' : 'dire',
						})
					})
				await upsertMatchPlayers(tx, game.match_id, roster)
				for (const player of roster) {
					await upsertPlayer(tx, {
						accountId: player.accountId,
						personaName: player.playerName,
						isPro: true,
						teamId:
							player.side === 'radiant'
								? game.radiant_team?.team_id || null
								: game.dire_team?.team_id || null,
						matchId: game.match_id,
					})
				}
				await replaceMatchDraft(tx, game.match_id, collectDraft(game))
				hashes.set(game.match_id, digest)
				wrote += 1
			}

			missingTicks.delete(game.match_id)
			appendTicks(game, capturedAt, tickRows, playerTickRows)

			const board = game.scoreboard
			if (changed && board) {
				const liveStats = (['radiant', 'dire'] as const).flatMap((side) => {
					const players = board[side]?.players ?? []
					return players.flatMap((item) => {
						if (typeof item !== 'object' || item === null) return []
						const row = item as Record<string, unknown>
						const slot = asNumber(row.player_slot)
						if (slot === null) return []
						return [
							partialPlayerFacts({
								accountId: asNumber(row.account_id) ?? 0,
								playerSlot: slot,
								heroId: asNumber(row.hero_id) ?? 0,
								playerName: typeof row.name === 'string' ? row.name : null,
								teamNumber: side === 'radiant' ? 0 : 1,
								side,
								kills: asNumber(row.kills),
								deaths: asNumber(row.death) ?? asNumber(row.deaths),
								assists: asNumber(row.assists),
								lastHits: asNumber(row.last_hits),
								denies: asNumber(row.denies),
								gold: asNumber(row.gold),
								level: asNumber(row.level),
								goldPerMin: asNumber(row.gold_per_min),
								xpPerMin: asNumber(row.xp_per_min),
								netWorth: asNumber(row.net_worth),
								item0: asNumber(row.item0) ?? asNumber(row.item_0),
								item1: asNumber(row.item1) ?? asNumber(row.item_1),
								item2: asNumber(row.item2) ?? asNumber(row.item_2),
								item3: asNumber(row.item3) ?? asNumber(row.item_3),
								item4: asNumber(row.item4) ?? asNumber(row.item_4),
								item5: asNumber(row.item5) ?? asNumber(row.item_5),
							}),
						]
					})
				})
				if (liveStats.length > 0) {
					await upsertMatchPlayers(tx, game.match_id, liveStats)
				}
			}
		}

		const suspectEmptyTick = currentIds.size === 0 && hashes.size > 0
		if (!suspectEmptyTick) {
			for (const matchId of hashes.keys()) {
				if (currentIds.has(matchId)) continue
				const count = (missingTicks.get(matchId) ?? 0) + 1
				missingTicks.set(matchId, count)
				if (count >= env.LIVE_MISSING_THRESHOLD) finished.push(matchId)
			}
		}
		if (finished.length > 0) {
			await markMatchesFinishedLive(tx, finished, env.REPLAY_LIVE_DELAY_MS)
			for (const matchId of finished) {
				hashes.delete(matchId)
				missingTicks.delete(matchId)
			}
		}
	})

	await insertJsonEachRow('live_match_ticks', tickRows)
	await insertJsonEachRow('live_player_ticks', playerTickRows)

	const detailsAt = new Date(Date.now() + env.REPLAY_LIVE_DELAY_MS)
	for (const matchId of finished) {
		await enqueueFetchMatchDetails(matchId, 'live', detailsAt)
	}

	logger.info(
		{
			games: games.length,
			wrote,
			ticks: tickRows.length,
			finished: finished.length,
		},
		'live league poll',
	)
	return { games: games.length, wrote }
}

function appendTicks(
	game: LiveLeagueGame,
	capturedAt: string,
	tickRows: Array<Record<string, unknown>>,
	playerTickRows: Array<Record<string, unknown>>,
): void {
	const board = game.scoreboard
	tickRows.push({
		match_id: String(game.match_id),
		captured_at: capturedAt,
		league_id: game.league_id,
		duration: board?.duration ?? 0,
		radiant_score: board?.radiant?.score ?? 0,
		dire_score: board?.dire?.score ?? 0,
		spectators: game.spectators ?? 0,
		tower_state_radiant: board?.radiant?.tower_state ?? 0,
		tower_state_dire: board?.dire?.tower_state ?? 0,
		barracks_state_radiant: board?.radiant?.barracks_state ?? 0,
		barracks_state_dire: board?.dire?.barracks_state ?? 0,
		roshan_respawn_timer: board?.roshan_respawn_timer ?? 0,
		series_type: game.series_type,
		radiant_series_wins: game.radiant_series_wins,
		dire_series_wins: game.dire_series_wins,
		stream_delay_s: game.stream_delay_s,
		lobby_id: String(game.lobby_id ?? 0),
		game_number: game.game_number ?? 0,
		league_series_id: game.league_series_id ?? 0,
		league_game_id: game.league_game_id ?? 0,
		league_tier: game.league_tier ?? 0,
		source: 'GetLiveLeagueGames',
	})

	for (const side of ['radiant', 'dire'] as const) {
		const players = board?.[side]?.players ?? []
		for (const item of players) {
			if (typeof item !== 'object' || item === null) continue
			const row = item as Record<string, unknown>
			playerTickRows.push({
				match_id: String(game.match_id),
				captured_at: capturedAt,
				player_slot: asUInt32(row.player_slot),
				account_id: String(asUInt32(row.account_id)),
				hero_id: asNumber(row.hero_id) ?? 0,
				kills: asUInt32(row.kills),
				deaths: asUInt32(row.death ?? row.deaths),
				assists: asUInt32(row.assists),
				last_hits: asUInt32(row.last_hits),
				denies: asUInt32(row.denies),
				gold: asUInt32(row.gold),
				net_worth: asUInt32(row.net_worth),
				level: asUInt32(row.level),
				gold_per_min: asUInt32(row.gold_per_min),
				xp_per_min: asUInt32(row.xp_per_min),
				x: asNumber(row.position_x) ?? asNumber(row.x) ?? 0,
				y: asNumber(row.position_y) ?? asNumber(row.y) ?? 0,
				item0: asUInt32(row.item0 ?? row.item_0),
				item1: asUInt32(row.item1 ?? row.item_1),
				item2: asUInt32(row.item2 ?? row.item_2),
				item3: asUInt32(row.item3 ?? row.item_3),
				item4: asUInt32(row.item4 ?? row.item_4),
				item5: asUInt32(row.item5 ?? row.item_5),
				ultimate_state: asUInt32(row.ultimate_state),
				ultimate_cooldown: asUInt32(row.ultimate_cooldown),
				respawn_timer: asUInt32(row.respawn_timer),
				source: 'GetLiveLeagueGames',
			})
		}
	}
}

function collectDraft(game: LiveLeagueGame) {
	const rows: Array<{
		ord: number
		isPick: boolean
		heroId: number
		team: number
		playerSlot: number | null
		clock: number | null
	}> = []
	let ord = 0
	for (const side of ['radiant', 'dire'] as const) {
		const team = side === 'radiant' ? 0 : 1
		const board = game.scoreboard?.[side]
		for (const pick of board?.picks ?? []) {
			if (pick.hero_id !== 0) {
				rows.push({
					ord,
					isPick: true,
					heroId: pick.hero_id,
					team,
					playerSlot: null,
					clock: null,
				})
				ord += 1
			}
		}
		for (const ban of board?.bans ?? []) {
			if (ban.hero_id !== 0) {
				rows.push({
					ord,
					isPick: false,
					heroId: ban.hero_id,
					team,
					playerSlot: null,
					clock: null,
				})
				ord += 1
			}
		}
	}
	return rows
}
