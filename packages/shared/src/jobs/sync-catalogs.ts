import { fetchCatalogRaw } from '#src/jobs/catalog-constants'
import {
	countHeroes,
	parseCatalogs,
	persistCatalogs,
} from '#src/store/catalogs'
import { errorMessage } from '#src/store/coerce'
import { logger } from '#src/utils/logger'

export { fetchCatalogRaw } from '#src/jobs/catalog-constants'

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
