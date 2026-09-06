import { describe, expect, test } from 'bun:test'
import { parseCsvLine, parseG2gAccountsCsv } from '#src/g2g-csv'

describe('parseG2gAccountsCsv', () => {
	test('strips the Excel text-prefix apostrophe and quoted IMAP host', () => {
		const csv = [
			'G2G Code ID,Account ID,Password,Character ID,Secret Question,Secret Answer,First Name,Last Name,Account Country,Date of Birth (eg. 01 Jan 2020),Account Email,Email Password,Additional Note',
			`id1,'2828562303,secret,,,,,,,,user@outlook.com,mailpass,"outlook.live.com"`,
			`id2,'pqub30458,other,,,,,,,,two@outlook.com,mail2,"outlook.live.com"`,
		].join('\n')
		const rows = parseG2gAccountsCsv(csv)
		expect(rows).toHaveLength(2)
		expect(rows[0]).toEqual({
			login: '2828562303',
			password: 'secret',
			email: 'user@outlook.com',
			emailPassword: 'mailpass',
			emailImapHost: 'outlook.live.com',
		})
		expect(rows[1]?.login).toBe('pqub30458')
	})

	test('parseCsvLine keeps commas inside quotes', () => {
		expect(parseCsvLine('a,"b,c",d')).toEqual(['a', 'b,c', 'd'])
	})
})
