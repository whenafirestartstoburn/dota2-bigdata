// biome-ignore-all assist/source/organizeImports: регион <template:imports> собирает генератор
import { seedSteamResources } from '@app/shared/src/components/seed'
import { db, sql } from '@app/shared/src/utils/db'
import { logger } from '@app/shared/src/utils/logger'
import { corsPreflight, json, notFound, tracedRoutes } from '#src/http'
import { routes } from '#src/routes'
import env from '#src/utils/env'

await seedSteamResources()

// <template:imports>
// </template:imports>

// <template:init>
// </template:init>

const server = Bun.serve({
	idleTimeout: 0,
	routes: tracedRoutes({
		'/': () => new Response(null, { status: 200 }),
		'/healthz': () => Response.json({ status: 'ok' }),
		'/readyz': async (request) => {
			try {
				await db.execute(sql`SELECT 1`)
				return json(request, { status: 'ready' })
			} catch {
				return json(request, { error: 'not ready' }, 503)
			}
		},
		...routes,

		// <template:routes>
		// </template:routes>
	}),
	fetch(request) {
		if (request.method === 'OPTIONS') return corsPreflight(request)
		return notFound(request)
	},
	port: env.SERVER_PORT,
})

logger.info({ port: server.port }, 'api listening')

async function shutdown(): Promise<void> {
	await server.stop()
	await db.$client.end({ timeout: 5 })
	// <template:shutdown>
	// </template:shutdown>
	process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
