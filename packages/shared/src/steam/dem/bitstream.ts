const MASKS: Uint32Array = (() => {
	const m = new Uint32Array(33)
	for (let i = 0; i < 32; i++) m[i] = (1 << i) - 1
	m[32] = 0xffff_ffff
	return m
})()

/** Source 2 bit reader, ported from dotabuff/manta `reader.go`. */
export class BitReader {
	buf: Uint8Array
	size: number
	pos = 0
	bitVal = 0n
	bitCount = 0

	constructor(buf: Uint8Array) {
		this.buf = buf
		this.size = buf.length
	}

	reset(buf: Uint8Array): void {
		this.buf = buf
		this.size = buf.length
		this.pos = 0
		this.bitVal = 0n
		this.bitCount = 0
	}

	remBytes(): number {
		return this.size - this.pos
	}

	private nextByte(): number {
		this.pos += 1
		if (this.pos > this.size) {
			throw new Error(
				`nextByte: insufficient buffer (${this.pos} of ${this.size})`,
			)
		}
		return this.buf[this.pos - 1]!
	}

	readBits(n: number): number {
		const need = n >>> 0
		while (need > this.bitCount) {
			this.bitVal |= BigInt(this.nextByte()) << BigInt(this.bitCount)
			this.bitCount += 8
		}
		const x = Number(this.bitVal & BigInt(MASKS[need]!))
		this.bitVal >>= BigInt(need)
		this.bitCount -= need
		return x >>> 0
	}

	readByte(): number {
		if (this.bitCount === 0) return this.nextByte()
		return this.readBits(8) & 0xff
	}

	readBytes(n: number): Uint8Array {
		if (this.bitCount === 0) {
			const start = this.pos
			this.pos += n
			if (this.pos > this.size) {
				throw new Error(
					`readBytes: insufficient buffer (${this.pos} of ${this.size})`,
				)
			}
			return this.buf.subarray(start, this.pos)
		}
		const out = new Uint8Array(n)
		for (let i = 0; i < n; i++) out[i] = this.readBits(8) & 0xff
		return out
	}

	readBoolean(): boolean {
		return this.readBits(1) === 1
	}

	readVarUint32(): number {
		let x = 0
		let s = 0
		for (;;) {
			const b = this.readByte()
			x |= (b & 0x7f) << s
			s += 7
			if ((b & 0x80) === 0 || s === 35) break
		}
		return x >>> 0
	}

	readVarInt32(): number {
		const ux = this.readVarUint32()
		let x = ux >>> 1
		if (ux & 1) x = ~x
		return x | 0
	}

	readVarUint64(): bigint {
		let x = 0n
		let s = 0n
		for (let i = 0; ; i++) {
			const b = BigInt(this.readByte())
			if (b < 0x80n) {
				if (i > 9 || (i === 9 && b > 1n)) {
					throw new Error('varint overflows uint64')
				}
				return x | (b << s)
			}
			x |= (b & 0x7fn) << s
			s += 7n
		}
	}

	readVarInt64(): bigint {
		const ux = this.readVarUint64()
		let x = ux >> 1n
		if ((ux & 1n) !== 0n) x = ~x
		return x
	}

	readUBitVar(): number {
		let ret = this.readBits(6)
		switch (ret & 0x30) {
			case 16:
				ret = (ret & 15) | (this.readBits(4) << 4)
				break
			case 32:
				ret = (ret & 15) | (this.readBits(8) << 4)
				break
			case 48:
				ret = (ret & 15) | (this.readBits(28) << 4)
				break
		}
		return ret >>> 0
	}

	readUBitVarFP(): number {
		if (this.readBoolean()) return this.readBits(2)
		if (this.readBoolean()) return this.readBits(4)
		if (this.readBoolean()) return this.readBits(10)
		if (this.readBoolean()) return this.readBits(17)
		return this.readBits(31)
	}

	readString(): string {
		const bytes: number[] = []
		for (;;) {
			const b = this.readByte()
			if (b === 0) break
			bytes.push(b)
		}
		return new TextDecoder().decode(Uint8Array.from(bytes))
	}

	readStringN(n: number): string {
		return new TextDecoder().decode(this.readBytes(n))
	}

	readCoord(): number {
		const intval = this.readBits(1)
		const fractval = this.readBits(1)
		if (intval === 0 && fractval === 0) return 0
		const sign = this.readBoolean()
		const i = intval !== 0 ? this.readBits(14) + 1 : 0
		const f = fractval !== 0 ? this.readBits(5) : 0
		let value = i + f * (1 / 32)
		if (sign) value = -value
		return value
	}

	readAngle(n: number): number {
		return (this.readBits(n) * 360) / (1 << n)
	}

	readNormal(): number {
		const neg = this.readBoolean()
		const len = this.readBits(11)
		const ret = len * (1 / ((1 << 11) - 1))
		return neg ? -ret : ret
	}

	read3BitNormal(): number[] {
		const ret = [0, 0, 0]
		const hasX = this.readBoolean()
		const hasY = this.readBoolean()
		if (hasX) ret[0] = this.readNormal()
		if (hasY) ret[1] = this.readNormal()
		const negZ = this.readBoolean()
		const prod = ret[0]! * ret[0]! + ret[1]! * ret[1]!
		ret[2] = prod < 1 ? Math.sqrt(1 - prod) : 0
		if (negZ) ret[2] = -ret[2]!
		return ret
	}

	readBitsAsBytes(n: number): Uint8Array {
		const tmp: number[] = []
		let left = n
		while (left >= 8) {
			tmp.push(this.readByte())
			left -= 8
		}
		if (left > 0) tmp.push(this.readBits(left) & 0xff)
		return Uint8Array.from(tmp)
	}

	readLeUint32(): number {
		const b = this.readBytes(4)
		return (b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24)) >>> 0
	}

	readLeUint64(): bigint {
		const b = this.readBytes(8)
		const lo = (b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24)) >>> 0
		const hi = (b[4]! | (b[5]! << 8) | (b[6]! << 16) | (b[7]! << 24)) >>> 0
		return BigInt(lo) + (BigInt(hi) << 32n)
	}
}
