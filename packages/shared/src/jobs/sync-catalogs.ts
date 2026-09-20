import { pickReadyProxy } from '#src/components/proxies'
import {
	fetchDatafeedJson,
	missingPatches,
	parseDatafeedAbilities,
	parseDatafeedHeroes,
	parseDatafeedItems,
	parseDatafeedPatches,
} from '#src/jobs/catalog-datafeed'
import { runWithProxy } from '#src/steam/http'
import type { CatalogSnapshot } from '#src/store/catalogs'
import {
	countHeroes,
	listPatchNames,
	persistCatalogs,
} from '#src/store/catalogs'
import { errorMessage } from '#src/store/coerce'
import { logger } from '#src/utils/logger'

export type SyncCatalogsResult = {
	skipped: boolean
	newPatches: string[]
	heroes: number
	items: number
	abilities: number
	patches: number
}

const EMPTY_LISTS = {
	heroAbilities: [],
	heroFacets: [],
	gameModes: [],
	lobbyTypes: [],
	regions: [],
	clusters: [],
	permanentBuffs: [],
	xpLevels: [],
} satisfies Partial<CatalogSnapshot>

export async function runSyncCatalogs(): Promise<SyncCatalogsResult> {
	const proxy = await pickReadyProxy('api')
	const patches = await runWithProxy(proxy.url, async () =>
		parseDatafeedPatches(await fetchDatafeedJson('patchnoteslist')),
	)
	const newPatches = missingPatches(patches, await listPatchNames())
	const heroes = await countHeroes()
	if (newPatches.length === 0 && heroes > 0) {
		logger.info(
			{ patches: patches.length, heroes },
			'catalog datafeed unchanged; skip dictionary refresh',
		)
		return {
			skipped: true,
			newPatches: [],
			heroes: 0,
			items: 0,
			abilities: 0,
			patches: 0,
		}
	}

	const snapshot = await runWithProxy(proxy.url, async () => {
		const [heroesRaw, itemsRaw, abilitiesRaw] = await Promise.all([
			fetchDatafeedJson('herolist'),
			fetchDatafeedJson('itemlist'),
			fetchDatafeedJson('abilitylist'),
		])
		return {
			heroes: parseDatafeedHeroes(heroesRaw),
			items: parseDatafeedItems(itemsRaw),
			abilities: parseDatafeedAbilities(abilitiesRaw),
			patches,
			...EMPTY_LISTS,
		} satisfies CatalogSnapshot
	})

	await persistCatalogs(snapshot, { preserveMissingFields: true })
	logger.info(
		{
			newPatches,
			heroes: snapshot.heroes.length,
			items: snapshot.items.length,
			abilities: snapshot.abilities.length,
			patches: snapshot.patches.length,
		},
		'synced official game catalogs',
	)
	return {
		skipped: false,
		newPatches,
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
