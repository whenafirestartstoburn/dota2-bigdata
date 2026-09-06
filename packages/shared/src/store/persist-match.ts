import { ensureLeagueStub } from '#src/store/leagues'
import {
	extractDraft,
	extractMatchFacts,
	extractPlayers,
} from '#src/store/match-details'
import {
	insertUndiscoveredMatch,
	replaceBroadcasters,
	replaceCoaches,
	replaceMatchDraft,
	replaceObjectives,
	saveMatchFacts,
	upsertMatchPlayers,
	upsertPlayer,
	upsertSeriesForMatch,
	upsertTeam,
} from '#src/store/matches'
import { type Executor, sql } from '#src/utils/db'

export async function persistMatchRecord(
	tx: Executor,
	raw: Record<string, unknown>,
	opts: {
		apiKeyId?: number | null
		mustExist: boolean
		skipStoryObjectives?: boolean
		fetched?: 'seq' | 'gc'
	},
): Promise<number> {
	const facts = extractMatchFacts(raw)
	if (facts.leagueId != null && facts.leagueId > 0) {
		await ensureLeagueStub(facts.leagueId, tx)
	}
	await upsertTeam(tx, facts.radiantTeamId, facts.radiantTeamName, {
		tag: facts.radiantTeamTag,
		logoUrl: facts.radiantTeamLogoUrl,
	})
	await upsertTeam(tx, facts.direTeamId, facts.direTeamName, {
		tag: facts.direTeamTag,
		logoUrl: facts.direTeamLogoUrl,
	})
	if (!opts.mustExist) {
		await insertUndiscoveredMatch(tx, facts, opts.fetched ?? 'gc')
	}
	const seriesId = await upsertSeriesForMatch(tx, {
		valveSeriesId: facts.seriesId,
		leagueId: facts.leagueId,
		radiantTeamId: facts.radiantTeamId,
		direTeamId: facts.direTeamId,
		seriesType: facts.seriesType,
		radiantWins: null,
		direWins: null,
		matchId: facts.matchId,
		startTime: facts.startTime,
	})
	if (seriesId != null) {
		facts.seriesId = seriesId
		await tx.execute(sql`
			UPDATE matches SET series_id = ${seriesId}
			WHERE match_id = ${facts.matchId} AND series_id IS NULL
		`)
	}
	await saveMatchFacts(tx, facts, opts.apiKeyId ?? null, opts.fetched ?? 'gc')
	const players = extractPlayers(raw)
	await upsertMatchPlayers(tx, facts.matchId, players)
	for (const player of players) {
		await upsertPlayer(tx, {
			accountId: player.accountId,
			personaName: player.playerName ?? player.proName,
			isPro: true,
			teamId:
				player.side === 'radiant' ? facts.radiantTeamId : facts.direTeamId,
			matchId: facts.matchId,
			matchAt:
				facts.startTime != null && facts.startTime > 0
					? new Date(facts.startTime * 1000)
					: null,
		})
	}
	const draft = extractDraft(raw)
	if (draft.length > 0) {
		await replaceMatchDraft(tx, facts.matchId, draft)
	}
	await replaceCoaches(tx, facts.matchId, facts.coaches)
	await replaceBroadcasters(tx, facts.matchId, facts.broadcasters)
	if (
		!opts.skipStoryObjectives &&
		facts.firstBloodTime != null &&
		facts.firstBloodTime > 0
	) {
		await replaceObjectives(tx, facts.matchId, [
			{
				seq: 0,
				time: facts.firstBloodTime,
				kind: 'first_blood',
				team: null,
				slot: null,
				key: null,
				value: null,
			},
		])
	}
	return facts.matchId
}
