// biome-ignore-all assist/source/organizeImports: регион <template:imports> собирает генератор — сортировка biome вынесла бы из него чужие импорты и утащила бы внутрь свои
import { parseCrontab, run } from 'graphile-worker'
import { seedSteamResources } from '@app/shared/src/components/seed'
import { runSyncCatalogsOnBoot } from '@app/shared/src/jobs/sync-catalogs'
import { pingClickhouse } from '@app/shared/src/components/clickhouse'
import { metricsResponse } from '@app/shared/src/metrics/http'
import { db, sql } from '@app/shared/src/utils/db'
import { logger } from '@app/shared/src/utils/logger'
import env from '#src/utils/env'
import { closeGcSession } from '#src/gc/session'
import { graphileLogger } from '#src/graphile-logger'
import {
	concurrencyFor,
	cronFor,
	startupJobsFor,
	syncsCatalogsOnBoot,
	taskNamesFor,
} from '#src/roles'
import { taskListFor } from '#src/tasks'

// <template:imports>
// </template:imports>

const role = env.WORKER_ROLE
const taskNames = taskNamesFor(role)
const taskList = taskListFor(taskNames)
const crontab = cronFor(role)

logger.info({ env: env.NODE_ENV, role, tasks: taskNames }, 'worker starting')

await seedSteamResources()
if (syncsCatalogsOnBoot(role)) {
	await runSyncCatalogsOnBoot()
}

const runner = await run({
	connectionString: env.PGURI,
	concurrency: concurrencyFor(role),
	noHandleSignals: true,
	logger: graphileLogger,
	parsedCronItems: crontab === '' ? [] : parseCrontab(crontab),
	taskList,
})

for (const job of startupJobsFor(role)) {
	await runner.addJob(
		job.identifier,
		{},
		{
			jobKey: job.jobKey,
			priority: job.priority,
			maxAttempts: job.maxAttempts,
		},
	)
}

const health = Bun.serve({
	port: env.WORKER_PORT,
	routes: {
		'/healthz': () => Response.json({ status: 'ok', role }),
		'/metrics': () => metricsResponse(),
		'/readyz': async () => {
			try {
				await db.execute(sql`SELECT 1`)
				const ch = await pingClickhouse()
				if (!ch) return new Response('clickhouse', { status: 503 })
				return Response.json({ status: 'ready', role })
			} catch {
				return new Response('not ready', { status: 503 })
			}
		},
	},
})

logger.info(
	{ port: health.port, role },
	'graphile-worker listening for jobs, health on /healthz',
)

// <template:init>
// </template:init>

async function shutdown(): Promise<void> {
	await health.stop()
	await runner.stop()
	await closeGcSession()
	await db.$client.end({ timeout: 5 })
	// <template:shutdown>
	// </template:shutdown>
	process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
