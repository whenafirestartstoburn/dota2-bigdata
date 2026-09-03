import {
	isProxyTransportError,
	NoUsableProxyError,
	proxyHostPort,
	rotateDeadApiKeyProxy,
} from '#src/components/proxies'
import {
	type ApiCallPurpose,
	acquireSteamApiSlot,
	markApiKeyRateLimited,
} from '#src/components/rate-limit'
import {
	disableResource,
	recordResourceAttempt,
} from '#src/components/resource-health'
import { getAppSettings } from '#src/components/settings'
import { MissingProxyError, steamFetch } from '#src/steam/http'
import { errorMessage } from '#src/store/coerce'
import { logger } from '#src/utils/logger'
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
	seqMatchSchema,
	seqResponseSchema,
} from './schemas'

export class SteamApiError extends Error {
	readonly status?: number
	readonly url?: string

	constructor(opts: { message: string; status?: number; url?: string }) {
		super(opts.message)
		this.name = 'SteamApiError'
		this.status = opts.status
		this.url = opts.url
	}
}

export type SteamRequestContext = {
	apiKey: string
	keyId: number
	proxyId: number
	proxyUrl: string
	purpose: ApiCallPurpose
}

const LEAGUE_INFO_URL =
	'https://www.dota2.com/webapi/IDOTA2League/GetLeagueInfoList/v001'
const STEAM_API = 'https://api.steampowered.com'

function withQuery(
	base: string,
	params: Record<string, string | number | undefined>,
): string {
	const url = new URL(base)
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined) url.searchParams.set(key, String(value))
	}
	return url.toString()
}

function toSteamApiError(error: unknown, url?: string): SteamApiError {
	if (error instanceof SteamApiError) return error
	return new SteamApiError({
		message: errorMessage(error),
		url,
	})
}

async function getJsonOnce(
	url: string,
	ctx: SteamRequestContext,
): Promise<unknown> {
	await acquireSteamApiSlot(ctx.keyId, ctx.purpose)
	const response = await steamFetch(url, {
		proxy: ctx.proxyUrl,
		signal: AbortSignal.timeout(45_000),
	})
	if (response.status === 407) {
		throw new Error(`proxy HTTP 407 for ${proxyHostPort(ctx.proxyUrl)}`)
	}
	if (response.status === 429) {
		await recordResourceAttempt({
			kind: 'proxy',
			resourceId: ctx.proxyId,
			ok: true,
		})
		await markApiKeyRateLimited(ctx.keyId, `steam HTTP 429 ${url}`)
	}
	if (!response.ok) {
		throw new SteamApiError({
			message: `steam HTTP ${response.status}`,
			status: response.status,
			url,
		})
	}
	try {
		const body = await response.json()
		await recordResourceAttempt({
			kind: 'proxy',
			resourceId: ctx.proxyId,
			ok: true,
		})
		await recordResourceAttempt({
			kind: 'api_key',
			resourceId: ctx.keyId,
			ok: true,
		})
		return body
	} catch (error) {
		throw toSteamApiError(error, url)
	}
}

async function getJson(
	url: string,
	ctx: SteamRequestContext,
	attempts = 4,
): Promise<unknown> {
	let lastError: SteamApiError | undefined
	for (let attempt = 0; attempt < attempts; attempt++) {
		try {
			return await getJsonOnce(url, ctx)
		} catch (error) {
			if (error instanceof SteamApiError && error.status === 403) {
				await disableResource({
					kind: 'api_key',
					resourceId: ctx.keyId,
					error: error.message,
					giveUp: true,
				})
				throw error
			}
			if (
				error instanceof MissingProxyError ||
				error instanceof NoUsableProxyError
			) {
				throw toSteamApiError(error, url)
			}
			if (isProxyTransportError(error)) {
				const message = errorMessage(error)
				const next = await rotateDeadApiKeyProxy(
					ctx.keyId,
					ctx.proxyId,
					message,
				)
				ctx.proxyId = next.id
				ctx.proxyUrl = next.url
			} else if (!(error instanceof SteamApiError && error.status === 429)) {
				await recordResourceAttempt({
					kind: 'api_key',
					resourceId: ctx.keyId,
					ok: false,
					error: errorMessage(error),
				})
			}
			lastError = toSteamApiError(error, url)
			const retryableHttp =
				error instanceof SteamApiError &&
				(error.status === 429 || (error.status != null && error.status >= 500))
			await Bun.sleep((retryableHttp ? 1000 : 500) * 2 ** attempt)
		}
	}
	throw lastError ?? new SteamApiError({ message: 'steam request failed', url })
}

export async function getLeagueInfoList(
	ctx: SteamRequestContext,
): Promise<LeagueInfo[]> {
	const body = await getJson(LEAGUE_INFO_URL, ctx)
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
	logger.info({ count: infos.length }, 'fetched league info list')
	return infos
}

export async function getLiveLeagueGames(
	ctx: SteamRequestContext,
): Promise<{ games: LiveLeagueGame[]; raw: unknown[] }> {
	const url = withQuery(`${STEAM_API}/IDOTA2Match_570/GetLiveLeagueGames/v1/`, {
		key: ctx.apiKey,
	})
	const body = await getJson(url, ctx)
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
	const url = withQuery(`${STEAM_API}/IDOTA2Match_570/GetMatchHistory/v1/`, {
		key: ctx.apiKey,
		league_id: input.leagueId,
		matches_requested: settings.historyPageSize,
		start_at_match_id: input.startAtMatchId,
	})
	const body = await getJson(url, ctx)
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

export async function getMatchHistoryBySequenceNum(
	ctx: SteamRequestContext,
	input: { startAtMatchSeqNum: number; matchesRequested: number },
): Promise<{
	matches: Array<
		{ match_id: number; match_seq_num: number } & Record<string, unknown>
	>
	raw: unknown[]
}> {
	const url = withQuery(
		`${STEAM_API}/IDOTA2Match_570/GetMatchHistoryBySequenceNum/v1/`,
		{
			key: ctx.apiKey,
			start_at_match_seq_num: input.startAtMatchSeqNum,
			matches_requested: input.matchesRequested,
		},
	)
	const body = await getJson(url, ctx)
	const parsed = seqResponseSchema.safeParse(body)
	if (!parsed.success || parsed.data.result.status !== 1) {
		throw new SteamApiError({
			message: `GetMatchHistoryBySequenceNum status=${
				parsed.success ? parsed.data.result.status : 'invalid'
			}`,
		})
	}
	const matches: Array<
		{ match_id: number; match_seq_num: number } & Record<string, unknown>
	> = []
	const raw: unknown[] = []
	for (const item of parsed.data.result.matches) {
		const row = seqMatchSchema.safeParse(item)
		if (!row.success) continue
		matches.push({
			...(item as Record<string, unknown>),
			match_id: row.data.match_id,
			match_seq_num: row.data.match_seq_num,
		})
		raw.push(item)
	}
	return { matches, raw }
}

export function replayUrl(
	cluster: number,
	matchId: number,
	salt: number,
): string {
	return `http://replay${cluster}.valve.net/570/${matchId}_${salt}.dem.bz2`
}
