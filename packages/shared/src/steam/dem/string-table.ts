import { uncompressSync } from 'snappy'
import { BitReader } from './bitstream'

export type StringTableItem = {
	index: number
	key: string
	value: Uint8Array
}

export type StringTable = {
	index: number
	name: string
	items: Map<number, StringTableItem>
	userDataFixedSize: boolean
	userDataSizeBits: number
	flags: number
	varintBitCounts: boolean
}

const KEY_HISTORY = 32

export function snappyDecode(buf: Uint8Array): Uint8Array {
	const out = uncompressSync(buf, { asBuffer: true })
	if (typeof out === 'string') {
		return new TextEncoder().encode(out)
	}
	const copy = new Uint8Array(out.byteLength)
	copy.set(out)
	return copy
}

export function maybeSnappyStringData(buf: Uint8Array): Uint8Array {
	if (buf.length < 4) return buf
	const magic = new TextDecoder().decode(buf.subarray(0, 4))
	if (magic === 'LZSS') {
		throw new Error('LZSS string tables are not supported')
	}
	try {
		return snappyDecode(buf)
	} catch {
		return buf
	}
}

export function parseStringTable(
	buf: Uint8Array,
	numUpdates: number,
	userDataFixed: boolean,
	userDataSizeBits: number,
	flags: number,
	varintBitCounts: boolean,
): StringTableItem[] {
	if (buf.length === 0 || numUpdates <= 0) return []
	const r = new BitReader(buf)
	const items: StringTableItem[] = []
	let index = -1
	const keys: string[] = []
	for (let i = 0; i < numUpdates; i++) {
		let key = ''
		let value = new Uint8Array(0)
		if (r.readBoolean()) index += 1
		else index += r.readVarUint32() + 2
		if (r.readBoolean()) {
			if (r.readBoolean()) {
				const pos = r.readBits(5)
				const size = r.readBits(5)
				if (pos >= keys.length) key += r.readString()
				else {
					const s = keys[pos] ?? ''
					key +=
						size > s.length
							? s + r.readString()
							: s.slice(0, size) + r.readString()
				}
			} else {
				key = r.readString()
			}
			if (keys.length >= KEY_HISTORY) keys.shift()
			keys.push(key)
		}
		if (r.readBoolean()) {
			let bitSize = 0
			let compressed = false
			if (userDataFixed) bitSize = userDataSizeBits
			else {
				if ((flags & 0x1) !== 0) compressed = r.readBoolean()
				bitSize = varintBitCounts ? r.readUBitVar() * 8 : r.readBits(17) * 8
			}
			value = new Uint8Array(r.readBitsAsBytes(bitSize))
			if (compressed) value = new Uint8Array(snappyDecode(value))
		}
		items.push({ index, key, value })
	}
	return items
}
