import { describe, expect, test } from 'bun:test'
import {
	asBool,
	asComplete,
	asIntArray,
	asNumber,
	asNumeric,
	asPgInt8,
	asString,
	asUInt32,
	errorMessage,
} from './coerce'

describe('asNumber', () => {
	test('accepts finite numbers, numeric strings, and bigint', () => {
		expect(asNumber(3)).toBe(3)
		expect(asNumber(0)).toBe(0)
		expect(asNumber('42')).toBe(42)
		expect(asNumber(10n)).toBe(10)
	})

	test('rejects empty string, NaN, and non-numeric values', () => {
		expect(asNumber('')).toBeNull()
		expect(asNumber(Number.NaN)).toBeNull()
		expect(asNumber(undefined)).toBeNull()
		expect(asNumber(null)).toBeNull()
		expect(asNumber({})).toBeNull()
		expect(asNumber(true)).toBeNull()
	})
})

describe('asNumeric', () => {
	test('accepts booleans as 0/1 and otherwise matches asNumber', () => {
		expect(asNumeric(true)).toBe(1)
		expect(asNumeric(false)).toBe(0)
		expect(asNumeric('7')).toBe(7)
		expect(asNumeric(null)).toBeNull()
	})
})

describe('asComplete', () => {
	test('maps flags and numbers, null for missing', () => {
		expect(asComplete(true)).toBe(1)
		expect(asComplete(false)).toBe(0)
		expect(asComplete(1)).toBe(1)
		expect(asComplete(undefined)).toBeNull()
	})
})

describe('errorMessage', () => {
	test('reads Error.message and stringifies the rest', () => {
		expect(errorMessage(new Error('boom'))).toBe('boom')
		expect(errorMessage('plain')).toBe('plain')
	})
})

describe('asPgInt8', () => {
	test('keeps values that fit signed int64 and drops Steam uint64 logos', () => {
		expect(asPgInt8(99)).toBe(99)
		expect(asPgInt8(29996980048346770)).toBe(29996980048346770)
		expect(asPgInt8(13052751837648703000)).toBeNull()
		expect(asPgInt8(-(2 ** 63))).toBe(-(2 ** 63))
	})
})

describe('asUInt32', () => {
	test('maps Valve empty-slot -1 to 0', () => {
		expect(asUInt32(-1)).toBe(0)
		expect(asUInt32(42)).toBe(42)
		expect(asUInt32(null)).toBe(0)
	})
})

describe('asString', () => {
	test('keeps non-empty strings and drops the rest', () => {
		expect(asString('axe')).toBe('axe')
		expect(asString('')).toBeNull()
		expect(asString(1)).toBeNull()
	})
})

describe('asBool', () => {
	test('only booleans, not 0/1', () => {
		expect(asBool(true)).toBe(true)
		expect(asBool(false)).toBe(false)
		expect(asBool(1)).toBeNull()
		expect(asBool(0)).toBeNull()
	})
})

describe('asIntArray', () => {
	test('keeps number lists and ability objects from Valve upgrades', () => {
		expect(asIntArray([1, 2, 3])).toEqual([1, 2, 3])
		expect(asIntArray([{ ability: 12 }, { ability: 8 }])).toEqual([12, 8])
		expect(asIntArray('nope')).toBeNull()
	})
})
