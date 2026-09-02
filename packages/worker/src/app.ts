// biome-ignore-all assist/source/organizeImports: регион <template:imports> собирает генератор — сортировка biome вынесла бы из него чужие импорты и утащила бы внутрь свои
import { parseCrontab, run } from 'graphile-worker'
import { seedSteamResources } from '@app/shared/src/components/seed'
import { pingClickhouse } from '@app/shared/src/components/clickhouse'
import { db, sql } from '@app/shared/src/utils/db'
import { logger } from '@app/shared/src/utils/logger'
import env from '#src/utils/env'
import { closeGcSession } from '#src/gc/session'
import { taskList } from '#src/tasks'

// <template:imports>
// </template:imports>

console.log(`[worker] запуск, окружение ${env.NODE_ENV}`)

await seedSteamResources()

const runner = await run({
	connectionString: env.PGURI,
	concurrency: 5,
	noHandleSignals: true,
	parsedCronItems: parseCrontab(
		'0 * * * * fetch_leagues\n*/2 * * * * walk_league_history',
	),
	taskList,
})

await runner.addJob('poll_live_games', {}, { jobKey: 'poll_live_games' })
await runner.addJob('fetch_leagues', {}, { jobKey: 'fetch_leagues_startup' })
await runner.addJob(
	'walk_league_history',
	{},
	{ jobKey: 'walk_league_history_startup' },
)

const health = Bun.serve({
	port: env.WORKER_PORT,
	routes: {
		'/healthz': () => Response.json({ status: 'ok' }),
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
