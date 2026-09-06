import { describe, expect, test } from 'bun:test'
import {
	accountHasGuardSecret,
	accountHasUsableTotp,
	accountIsGcEligible,
	selectGcPool,
} from '#src/components/account-role'

const base = {
	sharedSecret: null as string | null,
	sharedSecretBroken: false,
}

describe('GC vs API account split', () => {
	test('an account with an API key is not for GC, even without a shared_secret', () => {
		expect(accountIsGcEligible({ sharedSecret: null, hasApiKey: true })).toBe(
			false,
		)
		expect(
			accountIsGcEligible({
				sharedSecret: 'cnOgv/KdpLoP6Nbh0GMkXkPXALQ=',
				hasApiKey: true,
			}),
		).toBe(false)
	})

	test('a stored shared_secret without an API key is leftover, not GC', () => {
		const leftover = { ...base, sharedSecret: 'cnOgv/KdpLoP6Nbh0GMkXkPXALQ=' }
		expect(accountHasGuardSecret(leftover)).toBe(true)
		expect(
			accountHasUsableTotp({ ...leftover, sharedSecretBroken: false }),
		).toBe(true)
		expect(accountIsGcEligible(leftover)).toBe(false)
	})

	test('broken TOTP is still leftover — still not for GC', () => {
		const broken = {
			sharedSecret: 'cnOgv/KdpLoP6Nbh0GMkXkPXALQ=',
			sharedSecretBroken: true,
		}
		expect(accountHasUsableTotp(broken)).toBe(false)
		expect(accountHasGuardSecret(broken)).toBe(true)
		expect(accountIsGcEligible(broken)).toBe(false)
	})

	test('no shared_secret and no API key is the GC pool', () => {
		const gc = { ...base, sharedSecret: null }
		expect(accountHasGuardSecret(gc)).toBe(false)
		expect(accountIsGcEligible(gc)).toBe(true)
		expect(accountIsGcEligible({ sharedSecret: '' })).toBe(true)
		expect(accountIsGcEligible({ sharedSecret: null, hasApiKey: false })).toBe(
			true,
		)
	})

	test('bootstrap falls back to an API-key account when the GC pool is empty', () => {
		const seed = { ...base, hasApiKey: true }
		const dedicated = { ...base, hasApiKey: false }
		expect(selectGcPool([seed])).toEqual([seed])
		expect(selectGcPool([seed, dedicated])).toEqual([dedicated])
		expect(selectGcPool([{ ...base, sharedSecret: 'x' }])).toEqual([])
	})
})
