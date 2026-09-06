import {
	type CatalogRaw,
	countHeroes,
	parseCatalogs,
	persistCatalogs,
} from '#src/store/catalogs'
import { errorMessage } from '#src/store/coerce'
import { logger } from '#src/utils/logger'

const RESOURCES = [
	'heroes',
	'items',
	'abilities',
	'ability_ids',
	'hero_abilities',
	'patch',
	'game_mode',
	'lobby_type',
	'region',
	'cluster',
	'permanent_buffs',
	'xp_level',
] as const

type Resource = (typeof RESOURCES)[number]

const SOURCES = [
	'https://raw.githubusercontent.com/odota/dotaconstants/master/build',
	'https://api.opendota.com/api/constants',
] as const

async function fetchJson(url: string): Promise<unknown> {
	const response = await fetch(url, { signal: AbortSignal.timeout(45_000) })
	if (!response.ok) {
		throw new Error(`catalog HTTP ${response.status} ${url}`)
	}
	return response.json()
}

async function fetchResource(
	base: string,
	resource: Resource,
): Promise<unknown> {
	const suffix = base.includes('opendota.com')
		? `/${resource}`
		: `/${resource}.json`
	return fetchJson(`${base}${suffix}`)
}

export async function fetchCatalogRaw(): Promise<CatalogRaw> {
	let lastError: unknown
	for (const base of SOURCES) {
		try {
			const raw = {} as Record<Resource, unknown>
			for (const resource of RESOURCES) {
				raw[resource] = await fetchResource(base, resource)
			}
			return raw
		} catch (error) {
			lastError = error
			logger.warn(
				{ err: errorMessage(error), base },
				'catalog source failed, trying next',
			)
		}
	}
	throw new Error(
		`catalog fetch failed: ${errorMessage(lastError ?? 'no source')}`,
	)
}

export async function runSyncCatalogs(): Promise<{
	heroes: number
	items: number
	abilities: number
	patches: number
}> {
	const snapshot = parseCatalogs(await fetchCatalogRaw())
	await persistCatalogs(snapshot)
	logger.info(
		{
			heroes: snapshot.heroes.length,
			items: snapshot.items.length,
			abilities: snapshot.abilities.length,
			talents: snapshot.abilities.filter((row) => row.kind === 'talent').length,
			spells: snapshot.abilities.filter((row) => row.kind === 'spell').length,
			heroAbilities: snapshot.heroAbilities.length,
			heroFacets: snapshot.heroFacets.length,
			patches: snapshot.patches.length,
			gameModes: snapshot.gameModes.length,
			lobbyTypes: snapshot.lobbyTypes.length,
			regions: snapshot.regions.length,
			clusters: snapshot.clusters.length,
			permanentBuffs: snapshot.permanentBuffs.length,
			xpLevels: snapshot.xpLevels.length,
		},
		'synced game catalogs',
	)
	return {
		heroes: snapshot.heroes.length,
		items: snapshot.items.length,
		abilities: snapshot.abilities.length,
		patches: snapshot.patches.length,
	}
}

export async function runSyncCatalogsOnBoot(): Promise<void> {
	try {
		await runSyncCatalogs()
	} catch (error) {
		const n = await countHeroes()
		if (n === 0) throw error
		logger.warn(
			{ err: errorMessage(error), heroes: n },
			'catalog sync failed; keeping existing rows',
		)
	}
}
