function chIso(date: Date, end: number): string {
	return date.toISOString().slice(0, end).replace('T', ' ')
}

export function chNow(date = new Date()): string {
	return chIso(date, 23)
}

/** ClickHouse DateTime (seconds). Unix 0 / null → epoch. */
export function chDateTime(unixSec: number | null): string {
	const sec = unixSec != null && unixSec > 0 ? unixSec : 0
	return chIso(new Date(sec * 1000), 19)
}
