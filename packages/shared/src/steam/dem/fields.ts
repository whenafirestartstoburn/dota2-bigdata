import type { BitReader } from './bitstream'
import { type FieldPath, readFieldPaths } from './field-path'

export const FIELD_SIMPLE = 0
export const FIELD_FIXED_ARRAY = 1
export const FIELD_FIXED_TABLE = 2
export const FIELD_VAR_ARRAY = 3
export const FIELD_VAR_TABLE = 4

const TYPE_RE = /([^<[*]+)(<\s(.*)\s>)?(\*)?(\[(.*)\])?/

const ITEM_COUNTS: Record<string, number> = {
	MAX_ITEM_STOCKS: 8,
	MAX_ABILITY_DRAFT_ABILITIES: 48,
}

const POINTER_TYPES = new Set([
	'PhysicsRagdollPose_t',
	'CBodyComponent',
	'CEntityIdentity',
	'CPhysicsComponent',
	'CRenderComponent',
	'CDOTAGamerules',
	'CDOTAGameManager',
	'CDOTASpectatorGraphManager',
	'CPlayerLocalData',
	'CPlayer_CameraServices',
	'CDOTAGameRules',
])

export type FieldDecoder = (r: BitReader) => unknown

export type FieldType = {
	baseType: string
	genericType: FieldType | null
	pointer: boolean
	count: number
}

export function parseFieldType(name: string): FieldType {
	const ss = TYPE_RE.exec(name)
	if (ss == null || ss.length !== 7) {
		throw new Error(`bad field type ${name}`)
	}
	const parsed: FieldType = {
		baseType: ss[1] ?? name,
		genericType: ss[3] ? parseFieldType(ss[3]) : null,
		pointer: ss[4] === '*',
		count: 0,
	}
	const countTok = ss[6] ?? ''
	if (countTok !== '') {
		parsed.count = ITEM_COUNTS[countTok] ?? (Number(countTok) || 1024)
	}
	return parsed
}

const QFF_ROUNDDOWN = 1 << 0
const QFF_ROUNDUP = 1 << 1
const QFF_ENCODE_ZERO = 1 << 2
const QFF_ENCODE_INT = 1 << 3

class QuantizedFloat {
	low = 0
	high = 1
	decMul = 1
	bitcount = 32
	flags = 0
	noscale = true

	constructor(
		bitCount: number | null,
		flags: number | null,
		low: number | null,
		high: number | null,
	) {
		const bc = bitCount ?? 0
		if (bc === 0 || bc >= 32) {
			this.noscale = true
			this.bitcount = 32
			return
		}
		this.noscale = false
		this.bitcount = bc
		this.low = low ?? 0
		this.high = high ?? 1
		this.flags = flags ?? 0
		this.validateFlags()
		let steps = 1 << this.bitcount
		if (this.flags & QFF_ROUNDDOWN) {
			const range = this.high - this.low
			this.high -= range / steps
		} else if (this.flags & QFF_ROUNDUP) {
			const range = this.high - this.low
			this.low += range / steps
		}
		if (this.flags & QFF_ENCODE_INT) {
			let delta = this.high - this.low
			if (delta < 1) delta = 1
			const deltaLog2 = Math.ceil(Math.log2(delta))
			const range2 = 1 << deltaLog2
			let nextBc = this.bitcount
			while (1 << nextBc <= range2) nextBc += 1
			if (nextBc > this.bitcount) {
				this.bitcount = nextBc
				steps = 1 << this.bitcount
			}
			this.high = this.low + range2 - range2 / steps
		}
		this.assignMultipliers(steps)
	}

	private validateFlags(): void {
		if (this.flags === 0) return
		if (
			(this.low === 0 && this.flags & QFF_ROUNDDOWN) ||
			(this.high === 0 && this.flags & QFF_ROUNDUP)
		) {
			this.flags &= ~QFF_ENCODE_ZERO
		}
		if (this.low === 0 && this.flags & QFF_ENCODE_ZERO) {
			this.flags |= QFF_ROUNDDOWN
			this.flags &= ~QFF_ENCODE_ZERO
		}
		if (this.high === 0 && this.flags & QFF_ENCODE_ZERO) {
			this.flags |= QFF_ROUNDUP
			this.flags &= ~QFF_ENCODE_ZERO
		}
		if (this.low > 0 || this.high < 0) this.flags &= ~QFF_ENCODE_ZERO
		if (this.flags & QFF_ENCODE_INT) {
			this.flags &= ~(QFF_ROUNDUP | QFF_ROUNDDOWN | QFF_ENCODE_ZERO)
		}
	}

	private assignMultipliers(steps: number): void {
		this.decMul = 1 / (steps - 1)
	}

	decode(r: BitReader): number {
		if (this.noscale) return intBitsToFloat(r.readBits(32))
		if (this.flags & QFF_ROUNDDOWN && r.readBoolean()) return this.low
		if (this.flags & QFF_ROUNDUP && r.readBoolean()) return this.high
		if (this.flags & QFF_ENCODE_ZERO && r.readBoolean()) return 0
		return (
			this.low +
			(this.high - this.low) * r.readBits(this.bitcount) * this.decMul
		)
	}
}

function intBitsToFloat(bits: number): number {
	const buf = new ArrayBuffer(4)
	new DataView(buf).setUint32(0, bits >>> 0, true)
	return new DataView(buf).getFloat32(0, true)
}

export class FieldState {
	state: unknown[] = new Array(8).fill(undefined)

	get(fp: FieldPath): unknown {
		let x: FieldState = this
		for (let i = 0; i <= fp.last; i++) {
			const z = fp.path[i] ?? 0
			if (x.state.length < z + 2) return undefined
			if (i === fp.last) return x.state[z]
			const sub = x.state[z]
			if (!(sub instanceof FieldState)) return undefined
			x = sub
		}
		return undefined
	}

	set(fp: FieldPath, value: unknown): void {
		let x: FieldState = this
		for (let i = 0; i <= fp.last; i++) {
			const z = fp.path[i] ?? 0
			if (x.state.length < z + 2) {
				const grown = new Array(Math.max(z + 2, x.state.length * 2)).fill(
					undefined,
				)
				for (let k = 0; k < x.state.length; k++) grown[k] = x.state[k]
				x.state = grown
			}
			if (i === fp.last) {
				if (!(x.state[z] instanceof FieldState)) x.state[z] = value
				return
			}
			if (!(x.state[z] instanceof FieldState)) {
				x.state[z] = new FieldState()
			}
			x = x.state[z] as FieldState
		}
	}

	clone(): FieldState {
		const c = new FieldState()
		c.state = this.state.map((v) => {
			if (v instanceof FieldState) return v.clone()
			if (Array.isArray(v) && typeof v[0] === 'number') return v.slice()
			if (v instanceof Uint8Array) return new Uint8Array(v)
			return v
		})
		return c
	}
}

export class Field {
	varName = ''
	varType = ''
	sendNode = ''
	serializerName = ''
	serializerVersion = 0
	encoder = ''
	encodeFlags: number | null = null
	bitCount: number | null = null
	lowValue: number | null = null
	highValue: number | null = null
	parentName = ''
	fieldType: FieldType | null = null
	serializer: Serializer | null = null
	model = FIELD_SIMPLE
	decoder: FieldDecoder = unsignedDecoder
	baseDecoder: FieldDecoder = booleanDecoder
	childDecoder: FieldDecoder = unsignedDecoder

	setModel(model: number): void {
		this.model = model
		switch (model) {
			case FIELD_FIXED_ARRAY:
				this.decoder = findDecoder(this)
				break
			case FIELD_FIXED_TABLE:
				this.baseDecoder = booleanDecoder
				break
			case FIELD_VAR_ARRAY:
				this.baseDecoder = unsignedDecoder
				this.childDecoder = findDecoderByBaseType(
					this.fieldType?.genericType?.baseType ?? 'uint32',
				)
				break
			case FIELD_VAR_TABLE:
				this.baseDecoder = unsignedDecoder
				break
			default:
				this.decoder = findDecoder(this)
		}
	}

	decoderFor(fp: FieldPath, pos: number): FieldDecoder {
		switch (this.model) {
			case FIELD_FIXED_ARRAY:
				return this.decoder
			case FIELD_FIXED_TABLE:
				if (fp.last === pos - 1) return this.baseDecoder
				return this.serializer?.decoderFor(fp, pos) ?? this.decoder
			case FIELD_VAR_ARRAY:
				return fp.last === pos ? this.childDecoder : this.baseDecoder
			case FIELD_VAR_TABLE:
				if (fp.last >= pos + 1) {
					return this.serializer?.decoderFor(fp, pos + 1) ?? this.decoder
				}
				return this.baseDecoder
			default:
				return this.decoder
		}
	}

	pathForName(fp: FieldPath, name: string): boolean {
		switch (this.model) {
			case FIELD_FIXED_ARRAY:
			case FIELD_VAR_ARRAY:
				fp.path[fp.last] = Number(name)
				return true
			case FIELD_FIXED_TABLE:
				return this.serializer?.pathForName(fp, name) ?? false
			case FIELD_VAR_TABLE: {
				fp.path[fp.last] = Number(name.slice(0, 4))
				if (name.length <= 4) return true
				fp.last += 1
				return this.serializer?.pathForName(fp, name.slice(5)) ?? false
			}
			default:
				return false
		}
	}
}

export class Serializer {
	name = ''
	version = 0
	fields: Field[] = []

	decoderFor(fp: FieldPath, pos: number): FieldDecoder {
		const index = fp.path[pos] ?? 0
		const field = this.fields[index]
		if (field == null) {
			throw new Error(
				`serializer ${this.name}: no field ${index} at pos ${pos} path ${fp.path.slice(0, fp.last + 1).join('/')} (have ${this.fields.length})`,
			)
		}
		return field.decoderFor(fp, pos + 1)
	}

	pathForName(fp: FieldPath, name: string): boolean {
		for (let i = 0; i < this.fields.length; i++) {
			const field = this.fields[i]
			if (field == null) continue
			if (name === field.varName) {
				fp.path[fp.last] = i
				return true
			}
			if (name.startsWith(`${field.varName}.`)) {
				fp.path[fp.last] = i
				fp.last += 1
				return field.pathForName(fp, name.slice(field.varName.length + 1))
			}
		}
		return false
	}
}

function unsignedDecoder(r: BitReader): unknown {
	return r.readVarUint32()
}

function booleanDecoder(r: BitReader): unknown {
	return r.readBoolean()
}

function signedDecoder(r: BitReader): unknown {
	return r.readVarInt32()
}

function signed64Decoder(r: BitReader): unknown {
	return r.readVarInt64()
}

function unsigned64Decoder(r: BitReader): unknown {
	return r.readVarUint64()
}

function stringDecoder(r: BitReader): unknown {
	return r.readString()
}

function noscaleDecoder(r: BitReader): unknown {
	return intBitsToFloat(r.readBits(32))
}

function coordDecoder(r: BitReader): unknown {
	return r.readCoord()
}

function simTimeDecoder(r: BitReader): unknown {
	return r.readVarUint32() * (1 / 30)
}

function runeTimeDecoder(r: BitReader): unknown {
	return intBitsToFloat(r.readBits(4))
}

function componentDecoder(r: BitReader): unknown {
	return r.readBits(1)
}

function hSequenceDecoder(r: BitReader): unknown {
	return r.readVarUint32() - 1
}

function bloodTypeDecoder(r: BitReader): unknown {
	return r.readBits(8)
}

function binaryBlockDecoder(r: BitReader): unknown {
	const n = r.readVarUint32()
	return r.readBytes(n)
}

function quantizedDecoder(field: Field): FieldDecoder {
	const qfd = new QuantizedFloat(
		field.bitCount,
		field.encodeFlags,
		field.lowValue,
		field.highValue,
	)
	return (r) => qfd.decode(r)
}

function floatDecoder(field: Field): FieldDecoder {
	switch (field.encoder) {
		case 'coord':
			return coordDecoder
		case 'simtime':
			return simTimeDecoder
		case 'runetime':
			return runeTimeDecoder
	}
	if (field.bitCount == null || field.bitCount <= 0 || field.bitCount >= 32) {
		return noscaleDecoder
	}
	return quantizedDecoder(field)
}

function vectorDecoder(n: number, field: Field): FieldDecoder {
	if (n === 3 && field.encoder === 'normal') {
		return (r) => r.read3BitNormal()
	}
	const d = floatDecoder(field)
	return (r) => {
		const x = new Array<number>(n)
		for (let i = 0; i < n; i++) x[i] = Number(d(r))
		return x
	}
}

function qangleDecoder(field: Field): FieldDecoder {
	const bc = field.bitCount ?? 0
	if (field.encoder === 'qangle_pitch_yaw') {
		if (bc === 0 || bc === 32) {
			return (r) => [
				intBitsToFloat(r.readBits(32)),
				intBitsToFloat(r.readBits(32)),
				0,
			]
		}
		return (r) => [r.readAngle(bc), r.readAngle(bc), 0]
	}
	if (field.encoder === 'qangle_precise') {
		return (r) => {
			const ret = [0, 0, 0]
			const rX = r.readBoolean()
			const rY = r.readBoolean()
			const rZ = r.readBoolean()
			if (rX) ret[0] = r.readAngle(20)
			if (rY) ret[1] = r.readAngle(20)
			if (rZ) ret[2] = r.readAngle(20)
			return ret
		}
	}
	if (bc === 32) {
		return (r) => [
			intBitsToFloat(r.readBits(32)),
			intBitsToFloat(r.readBits(32)),
			intBitsToFloat(r.readBits(32)),
		]
	}
	if (bc !== 0) {
		return (r) => [r.readAngle(bc), r.readAngle(bc), r.readAngle(bc)]
	}
	return (r) => {
		const ret = [0, 0, 0]
		const rX = r.readBoolean()
		const rY = r.readBoolean()
		const rZ = r.readBoolean()
		if (rX) ret[0] = r.readCoord()
		if (rY) ret[1] = r.readCoord()
		if (rZ) ret[2] = r.readCoord()
		return ret
	}
}

const TYPE_DECODERS: Record<string, FieldDecoder> = {
	bool: booleanDecoder,
	char: stringDecoder,
	color32: unsignedDecoder,
	int16: signedDecoder,
	int32: signedDecoder,
	int64: signed64Decoder,
	int8: signedDecoder,
	uint16: unsignedDecoder,
	uint32: unsignedDecoder,
	uint8: unsignedDecoder,
	GameTime_t: noscaleDecoder,
	HeroFacetKey_t: unsigned64Decoder,
	HeroID_t: signedDecoder,
	HSequence: hSequenceDecoder,
	BloodType: bloodTypeDecoder,
	CBodyComponent: componentDecoder,
	CGameSceneNodeHandle: unsignedDecoder,
	Color: unsignedDecoder,
	CPhysicsComponent: componentDecoder,
	CRenderComponent: componentDecoder,
	CUtlString: stringDecoder,
	CUtlStringToken: unsignedDecoder,
	CUtlSymbolLarge: stringDecoder,
	CUtlBinaryBlock: binaryBlockDecoder,
	CGlobalSymbol: stringDecoder,
	ResourceId_t: unsigned64Decoder,
}

function findDecoder(field: Field): FieldDecoder {
	const base = field.fieldType?.baseType ?? ''
	switch (base) {
		case 'float32':
			return floatDecoder(field)
		case 'CNetworkedQuantizedFloat':
			return quantizedDecoder(field)
		case 'Vector':
		case 'VectorWS':
			return vectorDecoder(3, field)
		case 'Vector2D':
			return vectorDecoder(2, field)
		case 'Vector4D':
		case 'Quaternion':
			return vectorDecoder(4, field)
		case 'uint64':
			return field.encoder === 'fixed64'
				? (r) => r.readLeUint64()
				: unsigned64Decoder
		case 'QAngle':
			return qangleDecoder(field)
		case 'CHandle':
		case 'CEntityHandle':
			return unsignedDecoder
		case 'CStrongHandle':
			return unsigned64Decoder
	}
	return TYPE_DECODERS[base] ?? unsignedDecoder
}

function findDecoderByBaseType(base: string): FieldDecoder {
	return TYPE_DECODERS[base] ?? unsignedDecoder
}

export function readFields(
	r: BitReader,
	serializer: Serializer,
	state: FieldState,
): void {
	const paths = readFieldPaths(r)
	for (const fp of paths) {
		const decoder = serializer.decoderFor(fp, 0)
		state.set(fp, decoder(r))
	}
}

export function applyFieldModel(field: Field): void {
	if (field.serializer != null) {
		if (
			field.fieldType?.pointer ||
			POINTER_TYPES.has(field.fieldType?.baseType ?? '')
		) {
			field.setModel(FIELD_FIXED_TABLE)
		} else {
			field.setModel(FIELD_VAR_TABLE)
		}
	} else if (
		(field.fieldType?.count ?? 0) > 0 &&
		field.fieldType?.baseType !== 'char'
	) {
		field.setModel(FIELD_FIXED_ARRAY)
	} else if (
		field.fieldType?.baseType === 'CUtlVector' ||
		field.fieldType?.baseType === 'CNetworkUtlVectorBase'
	) {
		field.setModel(FIELD_VAR_ARRAY)
	} else {
		field.setModel(FIELD_SIMPLE)
	}
}

export function patchField(field: Field, build: number): void {
	if (
		field.varName === 'm_flSimulationTime' ||
		field.varName === 'm_flAnimTime'
	) {
		field.encoder = 'simtime'
	}
	if (
		field.varName === 'm_flRuneTime' &&
		field.lowValue != null &&
		field.highValue != null &&
		field.lowValue === -3.4028234663852886e38 &&
		field.highValue === 3.4028234663852886e38
	) {
		field.encoder = 'runetime'
	}
	if (build >= 1016 && build <= 1027) {
		switch (field.varName) {
			case 'm_bItemWhiteList':
			case 'm_bWorldTreeState':
			case 'm_iPlayerIDsInControl':
			case 'm_iPlayerSteamID':
			case 'm_ulTeamBannerLogo':
			case 'm_ulTeamBaseLogo':
			case 'm_ulTeamLogo':
				field.encoder = 'fixed64'
		}
	}
}
