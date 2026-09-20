import { runSyncCatalogs } from '@app/shared/src/jobs/sync-catalogs'
import { db } from '@app/shared/src/utils/db'

const counts = await runSyncCatalogs()
const extra = counts.skipped
	? ' skipped=true'
	: ` new_patches=${counts.newPatches.join(',') || 'none'}`
console.log(
	`catalogs: heroes=${counts.heroes} items=${counts.items} abilities=${counts.abilities} patches=${counts.patches}${extra}`,
)
await db.$client.end({ timeout: 5 })
