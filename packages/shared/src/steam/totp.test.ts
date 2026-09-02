import { describe, expect, test } from 'bun:test'
import { generateAuthCode, generateConfirmationKey, getDeviceId } from './totp'

const SAMPLE = 'cnOgv/KdpLoP6Nbh0GMkXkPXALQ='
const ALPHABET = /^[23456789BCDFGHJKMNPQRTVWXY]{5}$/

describe('steam totp', () => {
	test('generateAuthCode is 5 chars from Steam alphabet', () => {
		const code = generateAuthCode(SAMPLE)
		expect(code).toMatch(ALPHABET)
	})

	test('same time offset is stable within the 30s window', () => {
		const a = generateAuthCode(SAMPLE, 0)
		const b = generateAuthCode(SAMPLE, 0)
		expect(a).toBe(b)
	})

	test('getDeviceId formats as android UUID-like id', () => {
		const id = getDeviceId('76561198000000000')
		expect(id.startsWith('android:')).toBe(true)
		expect(id.split('-')).toHaveLength(5)
	})

	test('generateConfirmationKey is stable for a fixed time', () => {
		expect(generateConfirmationKey(SAMPLE, 1_700_000_000, 'conf')).toBe(
			'rg8+26IBS5hk1/7h3/YbOD175r0=',
		)
	})
})
