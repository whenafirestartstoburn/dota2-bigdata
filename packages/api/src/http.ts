import { errorMessage } from '@app/shared/src/store/coerce'
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
