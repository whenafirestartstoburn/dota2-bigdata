import { describe, expect, test } from 'bun:test'
import { classifyPurchaseError, parseBuyAccountCliInput } from './buy-account'
import { DarkShoppingError } from './dark-shopping'
import { OutlookImapError, UnknownMailerError } from './imap-host'

describe('classifyPurchaseError', () => {
	test('maps a dark.shopping wait timeout to pending', () => {
		expect(
			classifyPurchaseError(
				new DarkShoppingError(408, 'dark.shopping order 1 still pending'),
			),
		).toEqual({
			status: 'pending',
			errorMessage: 'dark.shopping order 1 still pending',
		})
	})

	test('keeps Outlook and unknown-mailer text on failed', () => {
		const outlook = classifyPurchaseError(
			new OutlookImapError('uhqujreszs240@hotmail.com'),
		)
		expect(outlook.status).toBe('failed')
		expect(outlook.errorMessage).toContain('Outlook/Hotmail')
		expect(outlook.errorMessage).toContain('purchase already spent')

		const unknown = classifyPurchaseError(
			new UnknownMailerError('a@shevamail.com', ['imap.shevamail.com']),
		)
		expect(unknown.status).toBe('failed')
		expect(unknown.errorMessage).toContain('IMAP mailer is unknown')
	})
})

describe('parseBuyAccountCliInput', () => {
	test('parses api_key flags and defaults store/count', () => {
		expect(
			parseBuyAccountCliInput({
				productId: '80841',
				type: 'api_key',
			}),
		).toEqual({
			productId: 80841,
			store: 'dark_shopping',
			type: 'api_key',
			count: 1,
		})
	})

	test('parses gc flags with imap host and match test', () => {
		expect(
			parseBuyAccountCliInput({
				productId: '160810',
				type: 'gc',
				count: '2',
				testOnMatchId: '8979241530',
				imapHost: ' imap.firstmail.ltd ',
			}),
		).toEqual({
			productId: 160810,
			store: 'dark_shopping',
			type: 'gc',
			count: 2,
			testOnMatchId: 8979241530,
			imapHost: 'imap.firstmail.ltd',
		})
	})

	test('rejects a missing product id', () => {
		expect(() => parseBuyAccountCliInput({ type: 'gc' })).toThrow(
			'--product-id',
		)
	})
})
