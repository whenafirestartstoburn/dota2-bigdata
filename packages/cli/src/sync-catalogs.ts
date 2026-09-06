import { runSyncCatalogs } from '@app/shared/src/jobs/sync-catalogs'
import { db } from '@app/shared/src/utils/db'

const counts = await runSyncCatalogs()
console.log(
	`catalogs: heroes=${counts.heroes} items=${counts.items} abilities=${counts.abilities} patches=${counts.patches}`,
)
await db.$client.end({ timeout: 5 })
