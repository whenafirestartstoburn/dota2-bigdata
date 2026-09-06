import { describe, expect, test } from 'bun:test'
import {
	extractImapLiteral,
	imapHostname,
	imapSinceDate,
	parseInternalDate,
	parseSearchUids,
	quoteImapString,
	recentMailStartUid,
	tryParseLogicalLine,
} from '#src/steam/imap'

describe('imap parsers', () => {
	test('quoteImapString escapes quotes and backslashes', () => {
		expect(quoteImapString('a"b\\c')).toBe('"a\\"b\\\\c"')
	})

	test('imapSinceDate is IMAP date-text in UTC', () => {
		expect(imapSinceDate(new Date('2026-08-29T16:00:00Z'))).toBe('29-Aug-2026')
	})

	test('parseSearchUids reads UID SEARCH replies', () => {
		expect(parseSearchUids(['* SEARCH 12 15 20', '* OK idle'])).toEqual([
			12, 15, 20,
		])
		expect(parseSearchUids(['* SEARCH'])).toEqual([])
	})

	test('tryParseLogicalLine inlines FETCH literals', () => {
		const body = 'hello'
		const raw = `* 1 FETCH (UID 9 BODY[] {${String(body.length)}}\r\n${body})\r\nA0001 OK\r\n`
		const first = tryParseLogicalLine(Buffer.from(raw, 'latin1'))
		expect(first?.line.includes(body)).toBe(true)
		expect(extractImapLiteral(first?.line ?? '')).toBe(body)
		const second = tryParseLogicalLine(first?.rest ?? Buffer.alloc(0))
		expect(second?.line.startsWith('A0001 OK')).toBe(true)
	})

	test('imapHostname strips a numeric port', () => {
		expect(imapHostname('imap.yandex.ru')).toBe('imap.yandex.ru')
		expect(imapHostname('imap.yandex.ru:993')).toBe('imap.yandex.ru')
	})

	test('parseInternalDate reads IMAP INTERNALDATE', () => {
		const line =
			'* 1 FETCH (INTERNALDATE "29-Aug-2026 16:32:01 +0000" BODY[] {0}\r\n)'
		expect(parseInternalDate(line)?.toISOString()).toBe(
			'2026-08-29T16:32:01.000Z',
		)
	})
})

describe('recentMailStartUid', () => {
	test('starts after excluded login uid so activation is not the previous mail', () => {
		expect(recentMailStartUid(9980, [9978], 50)).toBe(9979)
	})

	test('falls back to a short tail of the mailbox when nothing is excluded', () => {
		expect(recentMailStartUid(9980, [], 50)).toBe(9930)
	})
})
