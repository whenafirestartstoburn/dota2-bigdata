import { describe, expect, test } from 'bun:test'
import { compressSync } from 'snappy'
import { BitReader } from './bitstream'
import { parseFieldType } from './fields'
import { decompressReplayFile, parseDemToNdjson } from './parse'
import { snappyDecode } from './string-table'

describe('BitReader', () => {
	test('reads varints and null-terminated strings when byte-aligned', () => {
		const r = new BitReader(Uint8Array.from([0xac, 0x02, 0x68, 0x69, 0x00]))
		expect(r.readVarUint32()).toBe(300)
		expect(r.readString()).toBe('hi')
	})

	test('reads LSB-first bits like manta', () => {
		const r = new BitReader(Uint8Array.from([0b0000_0101]))
		expect(r.readBits(1)).toBe(1)
		expect(r.readBits(1)).toBe(0)
		expect(r.readBits(1)).toBe(1)
	})
})

describe('snappyDecode', () => {
	test('round-trips raw snappy blocks', () => {
		const raw = Uint8Array.from([0x50, 0x42, 0x44, 0x45, 0x4d, 0x53, 0x32, 0])
		const packed = compressSync(raw)
		expect(snappyDecode(new Uint8Array(packed))).toEqual(raw)
	})
})

describe('parseFieldType', () => {
	test('parses CUtlVector and fixed arrays', () => {
		const vec = parseFieldType('CUtlVector< int32 >')
		expect(vec.baseType).toBe('CUtlVector')
		expect(vec.genericType?.baseType).toBe('int32')
		const arr = parseFieldType('int32[4]')
		expect(arr.baseType).toBe('int32')
		expect(arr.count).toBe(4)
	})
})

describe('decompressReplayFile', () => {
	test('decompresses zstd and passes through PBDEMS2', async () => {
		const raw = new Uint8Array(19)
		raw.set(new TextEncoder().encode('PBDEMS2'))
		const zstd = Bun.zstdCompressSync(raw)
		const out = await decompressReplayFile(new Uint8Array(zstd))
		expect(out[0]).toBe(80)
		expect(await decompressReplayFile(raw)).toBe(raw)
	})
})

describe('parseDemToNdjson', () => {
	test('accepts an empty PBDEMS2 demo', () => {
		const dem = new Uint8Array(19)
		dem.set(new TextEncoder().encode('PBDEMS2'))
		expect(parseDemToNdjson(dem)).toBe('')
	})
})
