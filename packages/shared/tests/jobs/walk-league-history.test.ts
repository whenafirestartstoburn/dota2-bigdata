import { describe, expect, test } from 'bun:test'
import { walkHasOlderPages } from '#src/jobs/walk-league-history'

describe('walkHasOlderPages', () => {
	test('continues only when this league still has a non-empty older page', () => {
		expect(walkHasOlderPages(false, false)).toBe(true)
		expect(walkHasOlderPages(true, true)).toBe(false)
		expect(walkHasOlderPages(true, false)).toBe(false)
		expect(walkHasOlderPages(false, true)).toBe(false)
	})
})
