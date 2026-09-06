import { AsyncLocalStorage } from 'node:async_hooks'

export type TraceContext = {
	trace_id: string
	job?: string
	job_id?: string
	match_id?: number
}

const store = new AsyncLocalStorage<TraceContext>()

export function newTraceId(): string {
	return crypto.randomUUID()
}

export function currentTrace(): TraceContext | undefined {
	return store.getStore()
}

export function runWithTrace<T>(ctx: TraceContext, fn: () => T): T {
	return store.run(ctx, fn)
}

export function traceIdFromRequest(request: Request): string {
	return (
		request.headers.get('x-trace-id') ??
		request.headers.get('x-request-id') ??
		newTraceId()
	)
}
