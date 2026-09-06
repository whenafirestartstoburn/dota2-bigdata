import { describe, expect, test } from 'bun:test'
import {
	imapProbeHosts,
	isOutlookMailer,
	knownImapHost,
	OutlookImapError,
	resolveImapHost,
} from '#src/marketplace/imap-host'

describe('IMAP host classification', () => {
	test('rejects Outlook/Hotmail without probing', () => {
		expect(isOutlookMailer('uhqujreszs240@hotmail.com')).toBe(true)
		expect(isOutlookMailer('user@outlook.com')).toBe(true)
		expect(isOutlookMailer('user@smakmail.com')).toBe(false)
	})

	test('maps smakmail and firstmail without guessing', () => {
		expect(knownImapHost('a@smakmail.com')).toBe('imap.smakmail.com')
		expect(knownImapHost('a@firstmail.ltd')).toBe('imap.firstmail.ltd')
		expect(knownImapHost('a@shevamail.com')).toBe(null)
	})

	test('shevamail-style domains include firstmail and smakmail as probe targets', () => {
		const hosts = imapProbeHosts('rachael@shevamail.com')
		expect(hosts).toContain('imap.shevamail.com')
		expect(hosts).toContain('mail.shevamail.com')
		expect(hosts).toContain('imap.firstmail.ltd')
		expect(hosts).toContain('imap.smakmail.com')
	})

	test('explicit host still refuses Outlook/Hotmail', async () => {
		await expect(
			resolveImapHost({
				email: 'uhqujreszs240@hotmail.com',
				password: 'x',
				host: 'imap.firstmail.ltd',
			}),
		).rejects.toBeInstanceOf(OutlookImapError)
	})
})
