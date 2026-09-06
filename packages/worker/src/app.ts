// biome-ignore-all assist/source/organizeImports: регион <template:imports> собирает генератор — сортировка biome вынесла бы из него чужие импорты и утащила бы внутрь свои
import { parseCrontab, run } from 'graphile-worker'
import { seedSteamResources } from '@app/shared/src/components/seed'
import { runSyncCatalogsOnBoot } from '@app/shared/src/jobs/sync-catalogs'
import { PRIORITY } from '@app/shared/src/components/jobs'
import { pingClickhouse } from '@app/shared/src/components/clickhouse'
import { metricsResponse } from '@app/shared/src/metrics/http'
import { db, sql } from '@app/shared/src/utils/db'
import { logger } from '@app/shared/src/utils/logger'
import env from '#src/utils/env'
import { closeGcSession } from '#src/gc/session'
import { graphileLogger } from '#src/graphile-logger'
import { taskList } from '#src/tasks'

// <template:imports>
// </template:imports>

logger.info({ env: env.NODE_ENV }, 'worker starting')

await seedSteamResources()
await runSyncCatalogsOnBoot()

const runner = await run({
	connectionString: env.PGURI,
	concurrency: 35,
	noHandleSignals: true,
	logger: graphileLogger,
	parsedCronItems: parseCrontab(
		'0 * * * * fetch_leagues ?max=3\n*/5 * * * * walk_league_history ?jobKey=walk_league_history&jobKeyMode=preserve_run_at&max=3\n0 5 * * * sync_catalogs ?max=3',
	),
	taskList,
})

await runner.addJob(
	'poll_live_games',
	{},
	{ jobKey: 'poll_live_games', maxAttempts: 1 },
)
await runner.addJob(
	'poll_top_live',
	{},
	{ jobKey: 'poll_top_live', maxAttempts: 1 },
)
await runner.addJob(
	'poll_realtime_stats',
	{},
	{ jobKey: 'poll_realtime_stats', maxAttempts: 1 },
)
await runner.addJob(
	'poll_finished_history',
	{},
	{ jobKey: 'poll_finished_history', maxAttempts: 1 },
)
await runner.addJob('fetch_leagues', {}, { jobKey: 'fetch_leagues_startup' })
await runner.addJob(
	'walk_league_history',
	{},
	{ jobKey: 'walk_league_history' },
)
await runner.addJob(
	'replenish_accounts',
	{},
	{
		jobKey: 'replenish_accounts',
		priority: PRIORITY.replenish,
		maxAttempts: 1,
	},
)
await runner.addJob(
	'retest_disabled_resources',
	{},
	{
		jobKey: 'retest_disabled_resources',
		priority: PRIORITY.retest,
		maxAttempts: 1,
	},
)

const health = Bun.serve({
	port: env.WORKER_PORT,
	routes: {
		'/healthz': () => Response.json({ status: 'ok' }),
		'/metrics': () => metricsResponse(),
		'/readyz': async () => {
			try {
				await db.execute(sql`SELECT 1`)
				const ch = await pingClickhouse()
				if (!ch) return new Response('clickhouse', { status: 503 })
				return Response.json({ status: 'ready' })
			} catch {
				return new Response('not ready', { status: 503 })
			}
		},
	},
})

logger.info(
	{ port: health.port },
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
