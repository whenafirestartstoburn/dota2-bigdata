import { describe, expect, test } from 'bun:test'
import { chDateTime, chNow } from '#src/jobs/time'

describe('chNow', () => {
	test('formats UTC as ClickHouse DateTime64 text without a T or Z', () => {
		expect(chNow(new Date('2020-02-13T12:01:05.250Z'))).toBe(
			'2020-02-13 12:01:05.250',
		)
	})
})

describe('chDateTime', () => {
	test('formats unix seconds as ClickHouse DateTime without millis', () => {
		expect(chDateTime(1581595265)).toBe('2020-02-13 12:01:05')
		expect(chDateTime(null)).toBe('1970-01-01 00:00:00')
		expect(chDateTime(0)).toBe('1970-01-01 00:00:00')
	})
})
