import {
	countReadyApiKeys,
	countReadyGcAccounts,
} from '#src/components/resource-health'
import { getAppSettings } from '#src/components/settings'
import { asNumber, asString } from '#src/store/coerce'
import { db, sql } from '#src/utils/db'
import { logger } from '#src/utils/logger'
import {
	accountsDesired,
	accountsReady,
	graphileJobs,
	leagues,
	liveMatches,
	marketplaceOrderRows,
	matchesByPhase,
	replaysByStatus,
	resources,
} from './observe'

type CountRow = {
	kind?: unknown
	status?: unknown
	phase?: unknown
	store?: unknown
	identifier?: unknown
	state?: unknown
	n?: unknown
	walkable?: unknown
	visited?: unknown
	exhausted?: unknown
	never_walked?: unknown
}

export async function collectInventory(): Promise<void> {
	resources.reset()
	accountsReady.reset()
	accountsDesired.reset()
	marketplaceOrderRows.reset()
	matchesByPhase.reset()
	liveMatches.reset()
	replaysByStatus.reset()
	graphileJobs.reset()
	leagues.reset()

	try {
		const [
			resourceRows,
			matchRows,
			replayRows,
			orderRows,
			readyKeys,
			readyGc,
			settings,
			leagueRows,
		] = await Promise.all([
			db.execute(sql`
				SELECT 'api_key'::text AS kind, status::text AS status, count(*)::int AS n
				FROM steam_api_keys
				GROUP BY status
				UNION ALL
				SELECT 'gc_account', status::text, count(*)::int
				FROM steam_accounts a
				WHERE (a.shared_secret IS NULL OR a.shared_secret = '')
					AND NOT EXISTS (
						SELECT 1 FROM steam_api_keys k WHERE k.account_id = a.id
					)
				GROUP BY status
				UNION ALL
				SELECT 'proxy', status::text, count(*)::int
				FROM proxies
				GROUP BY status
			`),
			db.execute(sql`
				SELECT phase::text AS phase, count(*)::int AS n
				FROM matches
				GROUP BY phase
			`),
			db.execute(sql`
				SELECT status::text AS status, count(*)::int AS n
				FROM match_replays
				GROUP BY status
			`),
			db.execute(sql`
				SELECT store::text AS store, kind::text AS kind,
					status::text AS status, count(*)::int AS n
				FROM marketplace_orders
				GROUP BY store, kind, status
			`),
			countReadyApiKeys(),
			countReadyGcAccounts(),
			getAppSettings(),
			db.execute(sql`
				SELECT
					count(*) FILTER (WHERE status <> 'UPCOMING')::int AS walkable,
					count(*) FILTER (WHERE history_checked_at IS NOT NULL)::int AS visited,
					count(*) FILTER (WHERE history_exhausted)::int AS exhausted,
					count(*) FILTER (
						WHERE status <> 'UPCOMING' AND history_checked_at IS NULL
					)::int AS never_walked
				FROM leagues
			`),
		])

		for (const row of resourceRows as CountRow[]) {
			const kind = asString(row.kind)
			const status = asString(row.status)
			if (kind == null || status == null) continue
			resources.set({ kind, status }, asNumber(row.n) ?? 0)
		}
		for (const row of matchRows as CountRow[]) {
			const phase = asString(row.phase)
			if (phase == null) continue
			const n = asNumber(row.n) ?? 0
			matchesByPhase.set({ phase }, n)
			if (phase === 'live') liveMatches.setValue(n)
		}
		if (liveMatches.get() === 0) liveMatches.setValue(0)
		for (const row of replayRows as CountRow[]) {
			const status = asString(row.status)
			if (status == null) continue
			replaysByStatus.set({ status }, asNumber(row.n) ?? 0)
		}
		for (const row of orderRows as CountRow[]) {
			const store = asString(row.store)
			const kind = asString(row.kind)
			const status = asString(row.status)
			if (store == null || kind == null || status == null) continue
			marketplaceOrderRows.set({ store, kind, status }, asNumber(row.n) ?? 0)
		}

		accountsReady.set({ pool: 'api_key' }, readyKeys)
		accountsReady.set({ pool: 'gc' }, readyGc)
		accountsDesired.set({ pool: 'api_key' }, settings.desiredApiKeys)
		accountsDesired.set({ pool: 'gc' }, settings.desiredGcAccounts)

		const league = (leagueRows as CountRow[])[0]
		if (league != null) {
			leagues.set({ state: 'walkable' }, asNumber(league.walkable) ?? 0)
			leagues.set({ state: 'visited' }, asNumber(league.visited) ?? 0)
			leagues.set({ state: 'exhausted' }, asNumber(league.exhausted) ?? 0)
			leagues.set({ state: 'never_walked' }, asNumber(league.never_walked) ?? 0)
		}

		await collectGraphileJobs()
	} catch (error) {
		logger.warn({ err: error }, 'metrics inventory scrape failed')
	}
}

async function collectGraphileJobs(): Promise<void> {
	try {
		const rows = await db.execute(sql`
			SELECT
				task_identifier::text AS identifier,
				CASE
					WHEN locked_at IS NOT NULL THEN 'running'
					WHEN run_at > now() THEN 'scheduled'
					ELSE 'queued'
				END AS state,
				count(*)::int AS n
			FROM graphile_worker.jobs
			WHERE attempts < max_attempts
			GROUP BY 1, 2
		`)
		for (const row of rows as CountRow[]) {
			const identifier = asString(row.identifier)
			const state = asString(row.state)
			if (identifier == null || state == null) continue
			graphileJobs.set({ identifier, state }, asNumber(row.n) ?? 0)
		}
	} catch {
		// graphile schema is created at worker runtime, not by dbmate
	}
}
