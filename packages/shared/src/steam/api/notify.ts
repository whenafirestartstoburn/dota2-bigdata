import type { SchemaDrift } from '#src/steam/api/drift'
import { SCHEMA_DRIFT_COOLDOWN_MS } from '#src/steam/api/drift'
import { errorMessage } from '#src/store/coerce'
import { db, sql } from '#src/utils/db'
import env from '#src/utils/env'
import { logger } from '#src/utils/logger'

export const TELEGRAM_NOTIFY_TIMEOUT_MS = 2_000
const LIST_LIMIT = 20

export type TelegramNotifyDeps = {
	url?: string
	chatType?: string
	chatId?: string | number
	fetchImpl?: typeof fetch
	timeoutMs?: number
}

export async function claimAlert(
	key: string,
	cooldownMs: number,
): Promise<boolean> {
	const rows = await db.execute(sql`
		INSERT INTO steam_api_schema_alerts (method_name, last_notified_at)
		VALUES (${key}, now())
		ON CONFLICT (method_name) DO UPDATE
		SET last_notified_at = now()
		WHERE steam_api_schema_alerts.last_notified_at
			< now() - (${cooldownMs} * interval '1 millisecond')
		RETURNING method_name
	`)
	return rows.length > 0
}

export async function claimSchemaAlert(
	method: string,
	cooldownMs = SCHEMA_DRIFT_COOLDOWN_MS,
): Promise<boolean> {
	return claimAlert(method, cooldownMs)
}

export function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
}

function formatList(items: string[]): string {
	if (items.length === 0) return '—'
	const shown = items.slice(0, LIST_LIMIT)
	const more =
		items.length > LIST_LIMIT ? ` (+${items.length - LIST_LIMIT})` : ''
	return `${shown.map(escapeHtml).join(', ')}${more}`
}

export function formatSchemaDriftMessage(
	method: string,
	drift: SchemaDrift,
): string {
	return [
		'<b>Steam API schema drift</b>',
		`method: <code>${escapeHtml(method)}</code>`,
		`unexpected: <code>${formatList(drift.extra)}</code>`,
		`missing: <code>${formatList(drift.missing)}</code>`,
	].join('\n')
}

export async function postTelegramNotification(
	text: string,
	deps: TelegramNotifyDeps = {},
): Promise<void> {
	const url = deps.url ?? env.TELEGRAM_NOTIFICATIONS_URL
	if (url == null || url === '') return
	const chatId = deps.chatId ?? env.TELEGRAM_NOTIFICATIONS_CHAT_ID
	const chatType = deps.chatType ?? env.TELEGRAM_NOTIFICATIONS_CHAT_TYPE
	if (
		(chatId == null || chatId === '') &&
		(chatType == null || chatType === '')
	) {
		return
	}
	const body =
		chatId != null && chatId !== ''
			? { chatId, text, parseMode: 'HTML' as const }
			: { chatType, text, parseMode: 'HTML' as const }
	const timeoutMs = deps.timeoutMs ?? TELEGRAM_NOTIFY_TIMEOUT_MS
	const fetchImpl = deps.fetchImpl ?? fetch
	const response = await fetchImpl(new URL('/send', url), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(timeoutMs),
	})
	if (!response.ok) {
		throw new Error(`telegram-notifications HTTP ${response.status}`)
	}
}

export async function notifySchemaDrift(
	method: string,
	drift: SchemaDrift,
	deps: TelegramNotifyDeps = {},
): Promise<void> {
	const url = deps.url ?? env.TELEGRAM_NOTIFICATIONS_URL
	const chatId = deps.chatId ?? env.TELEGRAM_NOTIFICATIONS_CHAT_ID
	const chatType = deps.chatType ?? env.TELEGRAM_NOTIFICATIONS_CHAT_TYPE
	if (url == null || url === '') {
		logger.warn({ method, ...drift }, 'steam api schema drift')
		return
	}
	if (
		(chatId == null || chatId === '') &&
		(chatType == null || chatType === '')
	) {
		logger.warn({ method, ...drift }, 'steam api schema drift')
		return
	}
	try {
		const claimed = await claimSchemaAlert(method)
		if (!claimed) return
		await postTelegramNotification(formatSchemaDriftMessage(method, drift), {
			...deps,
			url,
		})
	} catch (error) {
		logger.warn(
			{ err: errorMessage(error), method },
			'schema drift telegram failed',
		)
	}
}

export function scheduleSchemaDriftNotify(
	method: string,
	drift: SchemaDrift,
	deps?: TelegramNotifyDeps,
): void {
	void notifySchemaDrift(method, drift, deps).catch((error) => {
		logger.warn(
			{ err: errorMessage(error), method },
			'schema drift notify failed',
		)
	})
}
