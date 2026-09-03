/** Signed int64 exclusive bound; `2**63` is exact in IEEE-754. */
const INT8_ABS_LIMIT = 2 ** 63

export function asNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value
	if (typeof value === 'bigint') {
		const n = Number(value)
		return Number.isFinite(n) ? n : null
	}
	if (typeof value === 'string' && value !== '') {
		const n = Number(value)
		return Number.isFinite(n) ? n : null
	}
	return null
}

/** Like `asNumber`, plus booleans (entity fields, team-complete flags). */
export function asNumeric(value: unknown): number | null {
	const n = asNumber(value)
	if (n !== null) return n
	if (typeof value === 'boolean') return value ? 1 : 0
	return null
}

export function asComplete(value: unknown): number | null {
	if (value == null) return null
	return asNumeric(value)
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

export function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error))
}

/** Drop Steam uint64 values that overflow Postgres `bigint`. */
export function asPgInt8(value: unknown): number | null {
	const n = asNumber(value)
	if (n === null) return null
	if (n >= INT8_ABS_LIMIT || n < -INT8_ABS_LIMIT) return null
	return Math.trunc(n)
}

/** ClickHouse unsigned columns: Valve uses -1 for “empty”. */
export function asUInt32(value: unknown, fallback = 0): number {
	const n = asNumber(value)
	if (n === null || n < 0 || !Number.isFinite(n)) return fallback
	return Math.trunc(n)
}

export function asString(value: unknown): string | null {
	if (typeof value !== 'string') return null
	return value === '' ? null : value
}

/** Coerce via `String()` (driver UUIDs, numeric ids in JSON). Empty → null. */
export function asText(value: unknown): string | null {
	if (value == null) return null
	const text = String(value)
	return text === '' ? null : text
}

export function asRecord(value: unknown): Record<string, unknown> | null {
	if (typeof value !== 'object' || value === null) return null
	return value as Record<string, unknown>
}

export function asDate(value: unknown): Date | null {
	if (value == null) return null
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : value
	}
	const parsed = new Date(String(value))
	return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function asIso(value: unknown): string | null {
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : value.toISOString()
	}
	return asString(value)
}

export function asTrimmedString(value: unknown): string | null {
	return typeof value === 'string' ? asString(value.trim()) : null
}

export function asBool(value: unknown): boolean | null {
	if (typeof value === 'boolean') return value
	return null
}

export function asIntArray(value: unknown): number[] | null {
	if (!Array.isArray(value)) return null
	const out: number[] = []
	for (const item of value) {
		if (typeof item === 'number' && Number.isFinite(item)) {
			out.push(item)
			continue
		}
		if (typeof item === 'object' && item !== null) {
			const row = item as Record<string, unknown>
			const ability = asNumber(row.ability)
			if (ability !== null) out.push(ability)
		}
	}
	return out
}
