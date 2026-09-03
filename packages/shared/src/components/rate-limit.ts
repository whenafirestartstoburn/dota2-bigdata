import { getAppSettings } from '#src/components/settings'
import { db, sql } from '#src/utils/db'

export type ApiCallPurpose = 'live' | 'historical'

export async function setCursor(key: string, value: string): Promise<void> {
	await db.execute(sql`
		INSERT INTO ingest_cursors (key, value, updated_at)
		VALUES (${key}, ${value}, now())
		ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()
	`)
}

export async function getCursor(key: string): Promise<string | null> {
	const rows = await db.execute(sql`
		SELECT value FROM ingest_cursors WHERE key = ${key}
	`)
	const value = rows[0]?.value
	return typeof value === 'string' ? value : null
}

export async function acquireSteamApiSlot(
	keyId: number,
	purpose: ApiCallPurpose,
): Promise<void> {
	const settings = await getAppSettings()
	const minInterval = settings.steamApiMinIntervalMs
	for (;;) {
		const waitMs = await db.transaction(async (tx) => {
			await tx.execute(sql`
				SELECT id FROM steam_api_keys WHERE id = ${keyId} FOR UPDATE
			`)
			const [key] = await tx.execute(sql`
				SELECT last_called_at FROM steam_api_keys WHERE id = ${keyId}
			`)
			const now = Date.now()
			let readyAt = now
			const last = key?.last_called_at
			if (last instanceof Date) {
				readyAt = Math.max(readyAt, last.getTime() + minInterval)
			}
			if (purpose !== 'live') {
				const [cursor] = await tx.execute(sql`
					SELECT value FROM ingest_cursors WHERE key = 'next_live_poll_at'
				`)
				const nextLive =
					typeof cursor?.value === 'string'
						? Date.parse(cursor.value)
						: Number.NaN
				if (
					Number.isFinite(nextLive) &&
					now < nextLive &&
					readyAt < nextLive &&
					nextLive - readyAt < minInterval
				) {
					readyAt = nextLive + 50
				}
			}
			if (readyAt > now) return readyAt - now
			await tx.execute(sql`
				UPDATE steam_api_keys
				SET last_called_at = now(), last_used_at = now(), updated_at = now()
				WHERE id = ${keyId}
			`)
			return 0
		})
		if (waitMs <= 0) return
		await Bun.sleep(Math.min(waitMs, 5_000))
	}
}

export async function markApiKeyRateLimited(
	keyId: number,
	error: string,
	ms?: number,
): Promise<void> {
	const delay = ms ?? (await getAppSettings()).apiKeyRateLimitMs
	await db.execute(sql`
		UPDATE steam_api_keys
		SET
			status = 'rate_limited',
			rate_limited_until = now() + ${delay} * interval '1 millisecond',
			last_error = ${error},
			updated_at = now()
		WHERE id = ${keyId}
	`)
}

export async function bumpGlobalMatchSeq(seq: number): Promise<void> {
	if (seq <= 0) return
	const current = await getCursor('global_max_match_seq_num')
	const max = Math.max(seq, current == null ? 0 : Number(current) || 0)
	await setCursor('global_max_match_seq_num', String(max))
}
