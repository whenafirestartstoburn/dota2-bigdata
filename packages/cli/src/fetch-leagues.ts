import { runFetchLeagues } from '@app/shared/src/jobs/fetch-leagues'
import { db } from '@app/shared/src/utils/db'

const { count } = await runFetchLeagues()
console.log(`leagues: upserted=${count}`)
await db.$client.end({ timeout: 5 })
