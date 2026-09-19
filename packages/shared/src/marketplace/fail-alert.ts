import {
	type AccountPurchaseKind,
	listRecentFailedErrorMessages,
	type MarketplaceStore,
} from '#src/marketplace/orders'
import {
	claimAlert,
	escapeHtml,
	postTelegramNotification,
	type TelegramNotifyDeps,
} from '#src/steam/api/notify'
import { errorMessage } from '#src/store/coerce'
import env from '#src/utils/env'
import { logger } from '#src/utils/logger'

export const MARKETPLACE_FAIL_RETRIES = 3
export const MARKETPLACE_FAIL_ALERT_AFTER = MARKETPLACE_FAIL_RETRIES + 1
export const MARKETPLACE_FAIL_COOLDOWN_MS = 10 * 60 * 1000
export const MARKETPLACE_FAIL_STREAK_WINDOW_MS = 60 * 60 * 1000

const UUID_RE =
	/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const LONG_NUMBER_RE = /\d{5,}/g

export type MarketplaceFailAlertInput = {
	store: MarketplaceStore
	kind: AccountPurchaseKind
	productId: number
	orderId: number
	errorMessage: string
}

export type MarketplaceFailAlertDeps = TelegramNotifyDeps & {
	listRecentErrors?: (input: MarketplaceFailAlertInput) => Promise<string[]>
	claim?: (key: string, cooldownMs: number) => Promise<boolean>
}

export function marketplaceErrorSignature(message: string): string {
	return message
		.replace(UUID_RE, '<id>')
		.replace(LONG_NUMBER_RE, '<n>')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 200)
}

export function isStableMarketplaceError(
	signatures: readonly string[],
	retries = MARKETPLACE_FAIL_RETRIES,
): boolean {
	const need = retries + 1
	if (signatures.length < need) return false
	const recent = signatures.slice(0, need)
	const first = recent[0]
	if (first == null || first === '') return false
	return recent.every((signature) => signature === first)
}

export function marketplaceFailAlertKey(
	store: MarketplaceStore,
	kind: AccountPurchaseKind,
	signature: string,
): string {
	return `marketplace:${store}:${kind}:${signature}`
}

export function formatMarketplaceFailMessage(
	input: MarketplaceFailAlertInput,
): string {
	return [
		'<b>Marketplace order failed</b>',
		`store: <code>${escapeHtml(input.store)}</code>`,
		`kind: <code>${escapeHtml(input.kind)}</code>`,
		`product: <code>${escapeHtml(String(input.productId))}</code>`,
		`order: <code>${escapeHtml(String(input.orderId))}</code>`,
		`error: <code>${escapeHtml(input.errorMessage)}</code>`,
		`stable after ${String(MARKETPLACE_FAIL_RETRIES)} retries`,
	].join('\n')
}

async function recentSignatures(
	input: MarketplaceFailAlertInput,
	deps: MarketplaceFailAlertDeps,
): Promise<string[]> {
	const messages =
		deps.listRecentErrors != null
			? await deps.listRecentErrors(input)
			: await listRecentFailedErrorMessages({
					store: input.store,
					kind: input.kind,
					limit: MARKETPLACE_FAIL_ALERT_AFTER,
					windowMs: MARKETPLACE_FAIL_STREAK_WINDOW_MS,
				})
	return messages.map((message) => marketplaceErrorSignature(message))
}

export async function notifyMarketplaceFail(
	input: MarketplaceFailAlertInput,
	deps: MarketplaceFailAlertDeps = {},
): Promise<void> {
	const signatures = await recentSignatures(input, deps)
	if (!isStableMarketplaceError(signatures)) return
	const signature = signatures[0]
	if (signature == null) return
	const url = deps.url ?? env.TELEGRAM_NOTIFICATIONS_URL
	const chatId = deps.chatId ?? env.TELEGRAM_NOTIFICATIONS_CHAT_ID
	const chatType = deps.chatType ?? env.TELEGRAM_NOTIFICATIONS_CHAT_TYPE
	if (url == null || url === '') {
		logger.warn(input, 'marketplace order failed (stable)')
		return
	}
	if (
		(chatId == null || chatId === '') &&
		(chatType == null || chatType === '')
	) {
		logger.warn(input, 'marketplace order failed (stable)')
		return
	}
	const key = marketplaceFailAlertKey(input.store, input.kind, signature)
	try {
		const claimed =
			deps.claim != null
				? await deps.claim(key, MARKETPLACE_FAIL_COOLDOWN_MS)
				: await claimAlert(key, MARKETPLACE_FAIL_COOLDOWN_MS)
		if (!claimed) return
		await postTelegramNotification(formatMarketplaceFailMessage(input), {
			...deps,
			url,
		})
	} catch (error) {
		logger.warn(
			{ err: errorMessage(error), orderId: input.orderId },
			'marketplace fail telegram failed',
		)
	}
}

export function scheduleMarketplaceFailNotify(
	input: MarketplaceFailAlertInput,
	deps?: MarketplaceFailAlertDeps,
): void {
	void notifyMarketplaceFail(input, deps).catch((error) => {
		logger.warn(
			{ err: errorMessage(error), orderId: input.orderId },
			'marketplace fail notify failed',
		)
	})
}
