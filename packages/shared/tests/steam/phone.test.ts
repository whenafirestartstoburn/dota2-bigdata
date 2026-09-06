import { describe, expect, test } from 'bun:test'
import {
	inferPhoneCountry,
	maskPhone,
	normalizePhoneNumber,
	parseAccountPhoneStatus,
	parseEmailConfirmationWait,
	parseSetPhoneResponse,
	SteamPhoneError,
} from '#src/steam/phone'

describe('normalizePhoneNumber', () => {
	test('keeps E.164 and strips separators', () => {
		expect(normalizePhoneNumber('+7 (916) 123-45-67')).toBe('+79161234567')
		expect(normalizePhoneNumber('+14155550123')).toBe('+14155550123')
	})

	test('rejects numbers without a leading +', () => {
		expect(() => normalizePhoneNumber('79161234567')).toThrow(SteamPhoneError)
	})
})

describe('inferPhoneCountry', () => {
	test('uses the longest matching prefix', () => {
		expect(inferPhoneCountry('+79161234567')).toBe('RU')
		expect(inferPhoneCountry('+14155550123')).toBe('US')
		expect(inferPhoneCountry('+380501234567')).toBe('UA')
		expect(inferPhoneCountry('+442071838750')).toBe('GB')
		expect(inferPhoneCountry('+995591036416')).toBe('GE')
		expect(inferPhoneCountry('+972501234567')).toBe('IL')
	})
})

describe('maskPhone', () => {
	test('keeps prefix and last four digits', () => {
		expect(maskPhone('+79161234567')).toBe('+79***4567')
	})
})

describe('phone JSON parsers', () => {
	test('AccountPhoneStatus', () => {
		expect(
			parseAccountPhoneStatus({ response: { verified_phone: true } }),
		).toEqual({ verified: true })
		expect(parseAccountPhoneStatus({ response: {} })).toEqual({
			verified: false,
		})
	})

	test('SetAccountPhoneNumber', () => {
		expect(
			parseSetPhoneResponse({
				response: {
					confirmation_email_address: 'j***@gmail.com',
					phone_number_formatted: '+7 916 *** **67',
				},
			}),
		).toEqual({
			confirmationEmail: 'j***@gmail.com',
			phoneFormatted: '+7 916 *** **67',
		})
	})

	test('IsAccountWaitingForEmailConfirmation', () => {
		expect(
			parseEmailConfirmationWait({
				response: {
					awaiting_email_confirmation: true,
					seconds_to_wait: 4,
				},
			}),
		).toEqual({ awaiting: true, secondsToWait: 4 })
	})
})
