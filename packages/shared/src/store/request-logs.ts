import { getAppSettings } from '#src/components/settings'
import { asNumber, errorMessage } from '#src/store/coerce'
import { db, sql } from '#src/utils/db'
import { logger } from '#src/utils/logger'

export const REQUEST_LOG_TABLES = [
	'steam_api_requests',
	'steam_gc_requests',
	'replay_requests',
] as const

export type RequestLogTable = (typeof REQUEST_LOG_TABLES)[number]

export const ERROR_RESPONSE_MAX = 1000
const SETTINGS_TTL_MS = 10_000

export type RequestLogId = { table: RequestLogTable; id: number }

export type RequestLogActor = {
	steamApiKeyId?: number | null
	steamAccountId?: number | null
}

export type RequestLogStart = RequestLogActor & {
	matchId?: number | null
	methodName: string
}

export type RequestLogFinish = {
	responseTimeMs: number
	responseStatus: string
	responseSizeKb?: number | null
	errorResponse?: string | null
}

let settingsCache: { enabled: boolean; at: number } | null = null

export function resetRequestLogSettingsCache(): void {
	settingsCache = null
}

export function truncateErrorResponse(
	value: string | null | undefined,
): string | null {
	if (value == null || value === '') return null
	return value.length <= ERROR_RESPONSE_MAX
		? value
		: value.slice(0, ERROR_RESPONSE_MAX)
}

export function bytesToKb(bytes: number): number {
	return bytes / 1024
}

export function requestLogStatusFromError(error: unknown): string {
	if (typeof error === 'object' && error !== null && 'status' in error) {
		const status = error.status
		if (typeof status === 'number') return String(status)
	}
	const message = errorMessage(error)
	if (/timeout|timed out|aborted|AbortError/i.test(message)) return 'timeout'
	return 'error'
}

async function loggingEnabled(): Promise<boolean> {
	if (
		settingsCache != null &&
		Date.now() - settingsCache.at < SETTINGS_TTL_MS
	) {
		return settingsCache.enabled
	}
	try {
		const settings = await getAppSettings()
		settingsCache = {
			enabled: settings.logValveRequests,
			at: Date.now(),
		}
		return settingsCache.enabled
	} catch (error) {
		logger.warn(
			{ err: errorMessage(error) },
			'request log settings unavailable',
		)
		return false
	}
}

export async function beginRequest(
	table: RequestLogTable,
	input: RequestLogStart,
): Promise<RequestLogId | null> {
	if (!(await loggingEnabled())) return null
	try {
		const rows =
			table === 'replay_requests'
				? await db.execute(sql`
					INSERT INTO ${sql.identifier(table)} (match_id, method_name)
					VALUES (${input.matchId ?? null}, ${input.methodName})
					RETURNING id
				`)
				: await db.execute(sql`
					INSERT INTO ${sql.identifier(table)} (
						match_id, method_name, steam_api_key_id, steam_account_id
					)
					VALUES (
						${input.matchId ?? null},
						${input.methodName},
						${input.steamApiKeyId ?? null},
						${input.steamAccountId ?? null}
					)
					RETURNING id
				`)
		const id = asNumber(rows[0]?.id)
		if (id == null) return null
		return { table, id }
	} catch (error) {
		logger.warn(
			{ err: errorMessage(error), table, method: input.methodName },
			'request log insert failed',
		)
		return null
	}
}

export async function finishRequest(
	row: RequestLogId | null,
	finish: RequestLogFinish,
): Promise<void> {
	if (row == null) return
	try {
		await db.execute(sql`
			UPDATE ${sql.identifier(row.table)}
			SET
				response_time = ${finish.responseTimeMs},
				response_status = ${finish.responseStatus},
				response_size_kb = ${finish.responseSizeKb ?? null},
				error_response = ${truncateErrorResponse(finish.errorResponse)}
			WHERE id = ${row.id}
		`)
	} catch (error) {
		logger.warn(
			{ err: errorMessage(error), table: row.table, id: row.id },
			'request log update failed',
		)
	}
}

export async function withRequestLog<T>(
	table: RequestLogTable,
	input: RequestLogStart,
	fn: () => Promise<
		{ value: T } & Omit<RequestLogFinish, 'responseTimeMs'> & {
				responseTimeMs?: number
			}
	>,
): Promise<T> {
	const started = performance.now()
	const row = await beginRequest(table, input)
	try {
		const result = await fn()
		await finishRequest(row, {
			responseTimeMs: result.responseTimeMs ?? performance.now() - started,
			responseStatus: result.responseStatus,
			responseSizeKb: result.responseSizeKb,
			errorResponse: result.errorResponse,
		})
		return result.value
	} catch (error) {
		await finishRequest(row, {
			responseTimeMs: performance.now() - started,
			responseStatus: requestLogStatusFromError(error),
			errorResponse: truncateErrorResponse(errorMessage(error)),
		})
		throw error
	}
}

export async function runMaintainRequestLogs(): Promise<void> {
	await db.execute(sql`SELECT public.maintain_request_logs()`)
}
