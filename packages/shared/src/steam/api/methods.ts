import { getAppSettings } from '#src/components/settings'
import {
	callSteamApi,
	PublicMatchError,
	STEAM_API,
	SteamApiError,
	type SteamRequestContext,
	withQuery,
} from '#src/steam/api/client'
import {
	type HistoryMatch,
	historyMatchSchema,
	type LeagueInfo,
	type LiveLeagueGame,
	leagueInfoListSchema,
	leagueInfoSchema,
	liveLeagueGameSchema,
	liveLeagueGamesResponseSchema,
	matchHistoryResponseSchema,
	type RealtimeStatsResponse,
	realtimeStatsResponseSchema,
	seqMatchSchema,
	seqResponseSchema,
	type TopLiveGameEntry,
	topLiveGameEntrySchema,
	topLiveGamesResponseSchema,
} from '#src/steam/api/schemas'
import { asNumber } from '#src/store/coerce'
import { logger } from '#src/utils/logger'

const LEAGUE_INFO_URL =
	'https://www.dota2.com/webapi/IDOTA2League/GetLeagueInfoList/v001'

export type SeqMatchRow = {
	match_id: number
	match_seq_num: number
} & Record<string, unknown>

export function parseLeagueInfoList(body: unknown): LeagueInfo[] {
	const parsed = leagueInfoListSchema.safeParse(body)
	if (!parsed.success) {
		throw new SteamApiError({
			message: 'GetLeagueInfoList: unexpected shape',
		})
	}
	const infos: LeagueInfo[] = []
	for (const raw of parsed.data.infos) {
		const row = leagueInfoSchema.safeParse(raw)
		if (row.success) infos.push(row.data)
	}
	return infos
}

export function parseLiveLeagueGames(body: unknown): {
	games: LiveLeagueGame[]
	raw: unknown[]
} {
	const parsed = liveLeagueGamesResponseSchema.safeParse(body)
	if (!parsed.success) {
		throw new SteamApiError({
			message: 'GetLiveLeagueGames: unexpected shape',
		})
	}
	const games: LiveLeagueGame[] = []
	const raw: unknown[] = []
	for (const item of parsed.data.result.games ?? []) {
		const row = liveLeagueGameSchema.safeParse(item)
		if (!row.success || row.data.match_id === 0) continue
		games.push(row.data)
		raw.push(item)
	}
	return { games, raw }
}

export function parseMatchHistoryPage(body: unknown): {
	matches: HistoryMatch[]
	raw: unknown[]
	resultsRemaining: number
	totalResults: number
} {
	const parsed = matchHistoryResponseSchema.safeParse(body)
	if (!parsed.success || parsed.data.result.status !== 1) {
		throw new SteamApiError({
			message: `GetMatchHistory status=${
				parsed.success ? parsed.data.result.status : 'invalid'
			} ${parsed.success ? (parsed.data.result.statusDetail ?? '') : ''}`,
		})
	}
	const matches: HistoryMatch[] = []
	const raw: unknown[] = []
	for (const item of parsed.data.result.matches) {
		const row = historyMatchSchema.safeParse(item)
		if (!row.success) continue
		matches.push(row.data)
		raw.push(item)
	}
	return {
		matches,
		raw,
		resultsRemaining: parsed.data.result.results_remaining ?? 0,
		totalResults: parsed.data.result.total_results ?? matches.length,
	}
}

export function parseMatchHistoryBySequenceNum(body: unknown): {
	matches: SeqMatchRow[]
	raw: unknown[]
} {
	const parsed = seqResponseSchema.safeParse(body)
	if (!parsed.success || parsed.data.result.status !== 1) {
		throw new SteamApiError({
			message: `GetMatchHistoryBySequenceNum status=${
				parsed.success ? parsed.data.result.status : 'invalid'
			}`,
		})
	}
	const matches: SeqMatchRow[] = []
	const raw: unknown[] = []
	for (const item of parsed.data.result.matches) {
		const row = seqMatchSchema.safeParse(item)
		if (!row.success) continue
		const record =
			typeof item === 'object' && item !== null
				? (item as Record<string, unknown>)
				: {}
		matches.push({
			...record,
			match_id: row.data.match_id,
			match_seq_num: row.data.match_seq_num,
		})
		raw.push(item)
	}
	return { matches, raw }
}

export function parseTopLiveGames(body: unknown): {
	games: TopLiveGameEntry[]
} {
	const parsed = topLiveGamesResponseSchema.safeParse(body)
	if (!parsed.success) {
		throw new SteamApiError({
			message: 'GetTopLiveGame: unexpected shape',
		})
	}
	const games: TopLiveGameEntry[] = []
	for (const item of parsed.data.game_list) {
		const record =
			typeof item === 'object' && item !== null
				? (item as Record<string, unknown>)
				: {}
		const leagueId = typeof record.league_id === 'number' ? record.league_id : 0
		if (leagueId <= 0) continue
		const row = topLiveGameEntrySchema.safeParse(item)
		if (!row.success) continue
		games.push(row.data)
	}
	return { games }
}

export function parseRealtimeStats(body: unknown): RealtimeStatsResponse {
	const rawMatch =
		typeof body === 'object' && body !== null
			? (body as { match?: Record<string, unknown> }).match
			: undefined
	const rawLeagueId = rawMatch?.league_id
	if (typeof rawLeagueId === 'number' && rawLeagueId <= 0) {
		throw new PublicMatchError(asNumber(rawMatch?.match_id))
	}
	const parsed = realtimeStatsResponseSchema.safeParse(body)
	if (!parsed.success) {
		throw new SteamApiError({
			message: 'GetRealtimeStats: unexpected shape',
		})
	}
	return parsed.data
}

export async function getLeagueInfoList(
	ctx: SteamRequestContext,
): Promise<LeagueInfo[]> {
	return callSteamApi(ctx, {
		source: 'dota2',
		method: 'GetLeagueInfoList',
		url: LEAGUE_INFO_URL,
		parse: (body) => {
			const infos = parseLeagueInfoList(body)
			logger.info({ count: infos.length }, 'fetched league info list')
			return infos
		},
	})
}

export async function getLiveLeagueGames(
	ctx: SteamRequestContext,
): Promise<{ games: LiveLeagueGame[]; raw: unknown[] }> {
	return callSteamApi(ctx, {
		source: 'steam',
		method: 'GetLiveLeagueGames',
		url: withQuery(`${STEAM_API}/IDOTA2Match_570/GetLiveLeagueGames/v1/`, {
			key: ctx.apiKey,
		}),
		parse: parseLiveLeagueGames,
	})
}

export async function getMatchHistoryPage(
	ctx: SteamRequestContext,
	input: { leagueId: number; startAtMatchId?: number },
): Promise<{
	matches: HistoryMatch[]
	raw: unknown[]
	resultsRemaining: number
	totalResults: number
}> {
	const settings = await getAppSettings()
	return callSteamApi(ctx, {
		source: 'steam',
		method: 'GetMatchHistory',
		url: withQuery(`${STEAM_API}/IDOTA2Match_570/GetMatchHistory/v1/`, {
			key: ctx.apiKey,
			league_id: input.leagueId,
			matches_requested: settings.historyPageSize,
			start_at_match_id: input.startAtMatchId,
		}),
		parse: parseMatchHistoryPage,
	})
}

export async function getMatchHistoryBySequenceNum(
	ctx: SteamRequestContext,
	input: { startAtMatchSeqNum: number; matchesRequested: number },
): Promise<{ matches: SeqMatchRow[]; raw: unknown[] }> {
	return callSteamApi(ctx, {
		source: 'steam',
		method: 'GetMatchHistoryBySequenceNum',
		url: withQuery(
			`${STEAM_API}/IDOTA2Match_570/GetMatchHistoryBySequenceNum/v1/`,
			{
				key: ctx.apiKey,
				start_at_match_seq_num: input.startAtMatchSeqNum,
				matches_requested: input.matchesRequested,
			},
		),
		parse: parseMatchHistoryBySequenceNum,
	})
}

export async function getTopLiveGames(
	ctx: SteamRequestContext,
): Promise<{ games: TopLiveGameEntry[] }> {
	return callSteamApi(ctx, {
		source: 'steam',
		method: 'GetTopLiveGame',
		url: withQuery(`${STEAM_API}/IDOTA2Match_570/GetTopLiveGame/v1/`, {
			key: ctx.apiKey,
			partner: 0,
		}),
		parse: parseTopLiveGames,
	})
}

export async function getRealtimeStats(
	ctx: SteamRequestContext,
	serverSteamId: string,
): Promise<RealtimeStatsResponse> {
	return callSteamApi(ctx, {
		source: 'steam',
		method: 'GetRealtimeStats',
		url: withQuery(`${STEAM_API}/IDOTA2MatchStats_570/GetRealtimeStats/v1/`, {
			key: ctx.apiKey,
			server_steam_id: serverSteamId,
		}),
		parse: parseRealtimeStats,
	})
}

export { PublicMatchError }
