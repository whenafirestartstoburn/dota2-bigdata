import { enqueueJob, PRIORITY, QUEUE } from '@app/shared/src/components/jobs'
import { buyAccounts } from '@app/shared/src/marketplace/buy-account'
import { DarkShoppingError } from '@app/shared/src/marketplace/store'
import { asIso } from '@app/shared/src/store/coerce'
import { createIngestRun, getIngestRun } from '@app/shared/src/store/ingest'
import {
	ensureLeagueStub,
	resetLeagueHistory,
} from '@app/shared/src/store/leagues'
import { z } from 'zod'
import {
	HttpError,
	handleError,
	json,
	methods,
	type RoutedRequest,
	readJson,
} from '#src/http'

const processFinishedBody = z.object({
	league_id: z.number().int().positive(),
	matches_limit: z.number().int().positive().max(10_000).optional(),
})

const ingestRunId = z.string().uuid()

const buyAccountBody = z.object({
	productId: z.number().int().positive(),
	store: z.literal('dark_shopping'),
	type: z.enum(['api_key', 'gc']),
	count: z.number().int().min(1).max(10).default(1),
	testOnMatchId: z.number().int().positive().optional(),
	imapHost: z.string().trim().min(1).optional(),
})

export const routes = {
	'/api/health': methods({
		GET: (request) =>
			json(request, {
				status: 'ok',
				uptime: Math.round(process.uptime()),
			}),
	}),

	'/api/leagues/process-finished': methods({
		POST: async (request) => {
			try {
				const parsed = processFinishedBody.safeParse(await readJson(request))
				if (!parsed.success) {
					return json(request, { error: z.prettifyError(parsed.error) }, 400)
				}
				const input = parsed.data
				await ensureLeagueStub(input.league_id)
				await resetLeagueHistory(input.league_id)
				const run = await createIngestRun({
					leagueId: input.league_id,
					matchesLimit: input.matches_limit ?? null,
				})
				const jobId = await enqueueJob({
					identifier: 'walk_league_history',
					payload: {
						league_id: input.league_id,
						matches_limit: input.matches_limit ?? null,
						reset: true,
					},
					queueName: QUEUE.historical,
					priority: PRIORITY.walkHistory,
					jobKey: `walk:${input.league_id}`,
				})
				return json(request, {
					run_id: run.id,
					job_id: jobId,
					league_id: input.league_id,
					matches_limit: input.matches_limit ?? null,
				})
			} catch (error) {
				return handleError(request, error)
			}
		},
	}),

	'/api/leagues/ingest-runs/:id': methods({
		GET: async (request) => {
			try {
				const id = ingestRunId.safeParse((request as RoutedRequest).params.id)
				if (!id.success) {
					return json(request, { error: z.prettifyError(id.error) }, 400)
				}
				const row = await getIngestRun(id.data)
				if (row === undefined || row === null) {
					throw new HttpError(404, 'not found')
				}
				const created = asIso(row.created_at)
				if (created === null) throw new HttpError(404, 'not found')
				return json(request, {
					id: String(row.id),
					league_id: Number(row.league_id),
					matches_limit:
						row.matches_limit === null ? null : Number(row.matches_limit),
					status: String(row.status),
					matches_listed: Number(row.matches_listed),
					matches_detailed: Number(row.matches_detailed),
					replays_enqueued: Number(row.replays_enqueued),
					error: row.error === null ? null : String(row.error),
					created_at: created,
					started_at: asIso(row.started_at),
					finished_at: asIso(row.finished_at),
				})
			} catch (error) {
				return handleError(request, error)
			}
		},
	}),

	'/api/buy-account': methods({
		POST: async (request) => {
			try {
				const parsed = buyAccountBody.safeParse(await readJson(request))
				if (!parsed.success) {
					return json(request, { error: z.prettifyError(parsed.error) }, 400)
				}
				const result = await buyAccounts(parsed.data)
				return json(request, {
					orders: result.orders.map((order) => ({
						status: order.status,
						productId: order.productId,
						store: order.store,
						errorMessage: order.errorMessage,
						testResult: order.testResult,
					})),
				})
			} catch (error) {
				if (error instanceof DarkShoppingError && error.status === 503) {
					return handleError(request, new HttpError(503, error.message))
				}
				return handleError(request, error)
			}
		},
	}),
}
