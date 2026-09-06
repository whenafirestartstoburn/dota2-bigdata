import { errorMessage } from '@app/shared/src/store/coerce'
import { logger } from '@app/shared/src/utils/logger'
import { runWithTrace, traceIdFromRequest } from '@app/shared/src/utils/trace'
import env from '#src/utils/env'

const origins = env.CORS_ORIGINS.split(',')
	.map((origin) => origin.trim())
	.filter((origin) => origin !== '')

export class HttpError extends Error {
	readonly status: number

	constructor(status: number, message: string) {
		super(message)
		this.name = 'HttpError'
		this.status = status
	}
}

function corsHeaders(request: Request): Record<string, string> {
	const origin = request.headers.get('Origin')
	if (origin === null || !origins.includes(origin)) return {}
	return {
		'access-control-allow-origin': origin,
		'access-control-allow-credentials': 'true',
		vary: 'Origin',
	}
}

export type RoutedRequest = Request & {
	params: Record<string, string>
}

export function json(request: Request, body: unknown, status = 200): Response {
	return Response.json(body, {
		status,
		headers: corsHeaders(request),
	})
}

export function corsPreflight(request: Request): Response {
	const headers = new Headers(corsHeaders(request))
	headers.set(
		'access-control-allow-methods',
		'GET,POST,PUT,PATCH,DELETE,OPTIONS',
	)
	headers.set(
		'access-control-allow-headers',
		request.headers.get('access-control-request-headers') ?? 'content-type',
	)
	return new Response(null, { status: 204, headers })
}

export function notFound(request: Request): Response {
	return json(request, { error: 'not found' }, 404)
}

export function handleError(request: Request, error: unknown): Response {
	if (error instanceof HttpError) {
		return json(request, { error: error.message }, error.status)
	}
	const message = errorMessage(error)
	const body =
		env.NODE_ENV === 'production'
			? { error: 'internal error' }
			: { error: message }
	return json(request, body, 500)
}

export async function readJson(request: Request): Promise<unknown> {
	try {
		return await request.json()
	} catch {
		throw new HttpError(400, 'invalid json')
	}
}

export function methods<
	T extends Record<string, (request: Request) => Response | Promise<Response>>,
>(handlers: T): T & { OPTIONS: (request: Request) => Response } {
	return { OPTIONS: corsPreflight, ...handlers }
}

type RouteHandler = (request: Request) => Response | Promise<Response>

function withTraceHeader(response: Response, traceId: string): Response {
	const headers = new Headers(response.headers)
	headers.set('x-trace-id', traceId)
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	})
}

export function tracedHandler(handler: RouteHandler): RouteHandler {
	return (request) => {
		const trace_id = traceIdFromRequest(request)
		return runWithTrace({ trace_id }, async () => {
			const started = Date.now()
			const path = new URL(request.url).pathname
			try {
				const response = withTraceHeader(await handler(request), trace_id)
				if (path !== '/healthz' && path !== '/readyz') {
					logger.info(
						{
							method: request.method,
							path,
							status: response.status,
							duration_ms: Date.now() - started,
						},
						'http',
					)
				}
				return response
			} catch (error) {
				logger.error(
					{
						method: request.method,
						path,
						err: errorMessage(error),
						duration_ms: Date.now() - started,
					},
					'http',
				)
				throw error
			}
		})
	}
}

export function tracedRoutes<T extends Record<string, unknown>>(routes: T): T {
	const out: Record<string, unknown> = {}
	for (const [path, value] of Object.entries(routes)) {
		if (typeof value === 'function') {
			out[path] = tracedHandler(value as RouteHandler)
			continue
		}
		if (value != null && typeof value === 'object') {
			const methodsOut: Record<string, unknown> = {}
			for (const [method, handler] of Object.entries(
				value as Record<string, unknown>,
			)) {
				methodsOut[method] =
					typeof handler === 'function'
						? tracedHandler(handler as RouteHandler)
						: handler
			}
			out[path] = methodsOut
			continue
		}
		out[path] = value
	}
	return out as T
}
