import { asNumber, asString } from '#src/store/coerce'
import { db, type Executor, sql } from '#src/utils/db'

export const WALK_SEQ_JOB = 'walk_seq_history'
export const SEQ_WINDOW_JOB = 'fetch_seq_window'
export const WALK_SEQ_JOB_KEY = 'walk_seq_history'

export const SEQ_WALK_CURSOR_KEY = 'seq_walk_cursor'
export const SEQ_WALK_START_TIME_KEY = 'seq_walk_latest_start_time'
export const SEQ_WALK_COOLDOWN_KEY = 'seq_walk_cooldown_until'

export const SEQ_WALK_REWIND = 2000
export const SEQ_WALK_CAUGHT_UP_MS = 60_000

export function seqWindowJobKey(startAt: number): string {
	return `seq_window:${startAt}`
}

export function claimAdvance(cursor: number, batchSize: number): number {
	return cursor + batchSize
}

export function nextSeqWalkCursor(cursor: number, highestSeq: number): number {
	return Math.max(cursor, highestSeq)
}

export function rewindSeqWalkCursor(
	startAt: number,
	rewind = SEQ_WALK_REWIND,
): number {
	return Math.max(1, startAt - rewind)
}

export function formatSeqWalkStartTime(unixSeconds: number): string {
	if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return ''
	const at = new Date(unixSeconds * 1000)
	if (Number.isNaN(at.getTime())) return ''
	const pad = (n: number) => String(n).padStart(2, '0')
	return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())} ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())} UTC`
}

export function leagueIdOf(raw: Record<string, unknown>): number {
	return asNumber(raw.leagueid) ?? asNumber(raw.league_id) ?? 0
}

export function isProfessionalSeqMatch(raw: Record<string, unknown>): boolean {
	return leagueIdOf(raw) > 0
}

export function professionalSeqMatches<
	T extends Record<string, unknown> & {
		match_id: number
		match_seq_num: number
	},
>(matches: readonly T[]): T[] {
	return matches.filter((match) => isProfessionalSeqMatch(match))
}

export function highestSeqNum(
	matches: ReadonlyArray<{ match_seq_num: number }>,
): number | null {
	let max: number | null = null
	for (const match of matches) {
		const seq = asNumber(match.match_seq_num)
		if (seq == null) continue
		if (max == null || seq > max) max = seq
	}
	return max
}

export function highestStartTime(
	matches: ReadonlyArray<Record<string, unknown>>,
): number | null {
	let max: number | null = null
	for (const match of matches) {
		const start = asNumber(match.start_time) ?? asNumber(match.starttime)
		if (start == null || start <= 0) continue
		if (max == null || start > max) max = start
	}
	return max
}

async function settingValue(
	key: string,
	exec: Executor = db,
): Promise<string | null> {
	const rows = await exec.execute(sql`
		SELECT value FROM settings WHERE key = ${key} LIMIT 1
	`)
	return asString(rows[0]?.value)
}

export async function readSeqWalkCursor(exec: Executor = db): Promise<number> {
	const raw = await settingValue(SEQ_WALK_CURSOR_KEY, exec)
	const cursor = asNumber(raw)
	if (cursor == null || cursor < 1) {
		throw new Error('settings.seq_walk_cursor is missing or not a number')
	}
	return cursor
}

export async function casAdvanceSeqWalkCursor(
	expected: number,
	next: number,
	exec: Executor = db,
): Promise<boolean> {
	const rows = await exec.execute(sql`
		UPDATE settings
		SET value = ${String(next)}
		WHERE key = ${SEQ_WALK_CURSOR_KEY}
			AND value = ${String(expected)}
		RETURNING value
	`)
	return rows[0] != null
}

export async function bumpSeqWalkCursor(
	highestSeq: number,
	exec: Executor = db,
): Promise<void> {
	if (highestSeq < 1) return
	await exec.execute(sql`
		UPDATE settings
		SET value = GREATEST(value::bigint, ${highestSeq})::text
		WHERE key = ${SEQ_WALK_CURSOR_KEY}
	`)
}

export async function setSeqWalkCursor(
	cursor: number,
	exec: Executor = db,
): Promise<void> {
	await exec.execute(sql`
		UPDATE settings
		SET value = ${String(cursor)}
		WHERE key = ${SEQ_WALK_CURSOR_KEY}
	`)
}

export async function writeSeqWalkStartTime(
	formatted: string,
	exec: Executor = db,
): Promise<void> {
	if (formatted === '') return
	await exec.execute(sql`
		UPDATE settings
		SET value = GREATEST(value, ${formatted})
		WHERE key = ${SEQ_WALK_START_TIME_KEY}
	`)
}

export async function readSeqWalkCooldown(
	exec: Executor = db,
): Promise<Date | null> {
	const raw = await settingValue(SEQ_WALK_COOLDOWN_KEY, exec)
	if (raw == null || raw === '') return null
	const at = Date.parse(raw)
	if (!Number.isFinite(at)) return null
	return new Date(at)
}

export async function setSeqWalkCooldown(
	delayMs: number,
	exec: Executor = db,
): Promise<void> {
	const until = new Date(Date.now() + delayMs).toISOString()
	await exec.execute(sql`
		UPDATE settings
		SET value = ${until}
		WHERE key = ${SEQ_WALK_COOLDOWN_KEY}
	`)
}
