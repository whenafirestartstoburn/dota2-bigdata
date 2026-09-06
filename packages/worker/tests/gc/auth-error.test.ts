import { describe, expect, test } from 'bun:test'
import {
	isGcWelcomeTimeout,
	isImapBasicAuthDisabled,
	isNoUsableGcAccount,
	SharedSecretBrokenError,
	steamGuardMeansBrokenSecret,
} from '#src/gc/auth-error'

describe('steamGuardMeansBrokenSecret', () => {
	test('wrong mobile TOTP means the stored secret does not match Steam', () => {
		expect(
			steamGuardMeansBrokenSecret({
				domain: null,
				lastCodeWrong: true,
				hasUsableTotp: true,
			}),
		).toBe(true)
	})

	test('email Guard is not a broken TOTP by itself (IMAP may supply the code)', () => {
		expect(
			steamGuardMeansBrokenSecret({
				domain: 'outlook.com',
				lastCodeWrong: false,
				hasUsableTotp: true,
			}),
		).toBe(false)
		expect(
			steamGuardMeansBrokenSecret({
				domain: 'outlook.com',
				lastCodeWrong: false,
				hasUsableTotp: false,
			}),
		).toBe(false)
	})

	test('mobile prompt without a wrong code is still usable TOTP', () => {
		expect(
			steamGuardMeansBrokenSecret({
				domain: null,
				lastCodeWrong: false,
				hasUsableTotp: true,
			}),
		).toBe(false)
	})
})

describe('isNoUsableGcAccount', () => {
	test('treats a broken secret and a missing GC account as terminal', () => {
		expect(
			isNoUsableGcAccount(new SharedSecretBrokenError('email Guard')),
		).toBe(true)
		expect(
			isNoUsableGcAccount(
				new Error(
					'no usable Steam account for GC — need a ready account without shared_secret',
				),
			),
		).toBe(true)
		expect(isNoUsableGcAccount(new Error('timeout waiting for Dota GC'))).toBe(
			false,
		)
	})
})

describe('isGcWelcomeTimeout', () => {
	test('matches the GC welcome timer', () => {
		expect(
			isGcWelcomeTimeout(new Error('timeout waiting for Dota GC welcome')),
		).toBe(true)
		expect(isGcWelcomeTimeout(new Error('IMAP timeout'))).toBe(false)
	})
})

describe('isImapBasicAuthDisabled', () => {
	test('matches Outlook basic-auth IMAP refusal', () => {
		expect(
			isImapBasicAuthDisabled(
				new Error(
					'IMAP login failed: A0001 NO Basic authentication is disabled.',
				),
			),
		).toBe(true)
	})
})
