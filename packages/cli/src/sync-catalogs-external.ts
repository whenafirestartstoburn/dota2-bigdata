import { runSyncCatalogsExternalProviders } from '@app/shared/src/jobs/sync-catalogs-external'
import { db } from '@app/shared/src/utils/db'

const counts = await runSyncCatalogsExternalProviders()
console.log(
	`catalogs-external: heroes=${counts.heroes} items=${counts.items} abilities=${counts.abilities} patches=${counts.patches}`,
)
await db.$client.end({ timeout: 5 })
