import { fetchCatalogRaw } from '#src/jobs/catalog-constants'
import { parseCatalogs, persistCatalogs } from '#src/store/catalogs'
import { logger } from '#src/utils/logger'

export async function runSyncCatalogsExternalProviders(): Promise<{
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
		'synced external-provider game catalogs',
	)
	return {
		heroes: snapshot.heroes.length,
		items: snapshot.items.length,
		abilities: snapshot.abilities.length,
		patches: snapshot.patches.length,
	}
}
