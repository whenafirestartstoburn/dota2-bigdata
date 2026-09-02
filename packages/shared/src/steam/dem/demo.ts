import {
	protoAllBytes as allBytes,
	protoBool as bool,
	protoBytes as bytes,
	decodeFields,
	protoFloat32 as float32,
	protoNum as num,
	type ProtoField,
	protoRepeatedInt32 as repeatedInt32,
	protoStr as str,
} from '#src/gc/protobuf'
import { asNumeric } from '#src/store/coerce'
import { BitReader } from './bitstream'
import { FieldPath } from './field-path'
import {
	applyFieldModel,
	Field,
	FieldState,
	parseFieldType,
	patchField,
	readFields,
	Serializer,
} from './fields'
import {
	maybeSnappyStringData,
	parseStringTable,
	type StringTable,
	snappyDecode,
} from './string-table'

const DEM_STOP = 0
const DEM_FILE_HEADER = 1
const DEM_FILE_INFO = 2
const DEM_SEND_TABLES = 4
const DEM_CLASS_INFO = 5
const DEM_STRING_TABLES = 6
const DEM_PACKET = 7
const DEM_SIGNON_PACKET = 8
const DEM_FULL_PACKET = 13
const DEM_RECOVERY = 18
const DEM_COMPRESSED = 64

const NET_TICK = 4
const SVC_SERVER_INFO = 40
const SVC_CREATE_STRING_TABLE = 44
const SVC_UPDATE_STRING_TABLE = 45
const SVC_PACKET_ENTITIES = 55
const SVC_USER_MESSAGE = 72

const INDEX_BITS = 14
const HANDLE_MASK = (1 << INDEX_BITS) - 1

export class Entity {
	index: number
	serial: number
	className: string
	classId: number
	active = true
	state: FieldState
	private serializer: Serializer
	private fpCache = new Map<string, FieldPath>()
	private fpNoop = new Set<string>()

	constructor(
		index: number,
		serial: number,
		classId: number,
		className: string,
		serializer: Serializer,
		state: FieldState,
	) {
		this.index = index
		this.serial = serial
		this.classId = classId
		this.className = className
		this.serializer = serializer
		this.state = state
	}

	get(name: string): unknown {
		let fp = this.fpCache.get(name)
		if (fp == null) {
			if (this.fpNoop.has(name)) return undefined
			fp = new FieldPath()
			fp.reset()
			if (!this.serializer.pathForName(fp, name)) {
				this.fpNoop.add(name)
				return undefined
			}
			this.fpCache.set(name, fp)
		}
		return this.state.get(fp)
	}

	num(name: string): number | null {
		return asNumeric(this.get(name))
	}

	str(name: string): string | null {
		const value = this.get(name)
		return typeof value === 'string' ? value : null
	}
}

export type EntityOp = {
	created: boolean
	updated: boolean
	deleted: boolean
	entered: boolean
	left: boolean
}

export type DemoHooks = {
	onTick?: (tick: number) => void
	onEntity?: (entity: Entity, op: EntityOp) => void
	onUserMessage?: (type: number, data: Uint8Array) => void
	onFileInfo?: (fields: ProtoField[]) => void
}

type ClassDef = {
	classId: number
	name: string
	serializer: Serializer | null
}

export class DemoParser {
	tick = 0
	netTick = 0
	gameBuild = 0
	entities = new Map<number, Entity>()
	private classIdSize = 0
	private classInfo = false
	private entityFullPackets = 0
	private classesById = new Map<number, ClassDef>()
	private classesByName = new Map<string, ClassDef>()
	private serializers = new Map<string, Serializer>()
	private classBaselines = new Map<number, Uint8Array>()
	private classBaselineStates = new Map<number, FieldState>()
	private stringTables: StringTable[] = []
	private stringTableByName = new Map<string, StringTable>()
	private hooks: DemoHooks
	private entityReader = new BitReader(new Uint8Array())

	constructor(hooks: DemoHooks = {}) {
		this.hooks = hooks
	}

	lookupString(table: string, index: number): string {
		const found = this.stringTableByName.get(table)
		if (found == null) return ''
		return found.items.get(index)?.key ?? ''
	}

	findByClass(name: string): Entity | undefined {
		for (const entity of this.entities.values()) {
			if (entity.className === name && entity.active) return entity
		}
		return undefined
	}

	findByHandle(handle: number): Entity | undefined {
		const idx = handle & HANDLE_MASK
		const serial = handle >> INDEX_BITS
		const entity = this.entities.get(idx)
		if (entity == null || entity.serial !== serial) return undefined
		return entity
	}

	parse(dem: Uint8Array): void {
		if (
			dem.length < 16 ||
			dem[0] !== 80 ||
			dem[1] !== 66 ||
			dem[2] !== 68 ||
			dem[3] !== 69 ||
			dem[4] !== 77 ||
			dem[5] !== 83 ||
			dem[6] !== 50 ||
			dem[7] !== 0
		) {
			throw new Error('not a Source 2 PBDEMS2 demo')
		}
		let pos = 16
		while (pos < dem.length) {
			const [command, afterCmd] = readVarUint(dem, pos)
			pos = afterCmd
			const type = command & ~DEM_COMPRESSED
			const compressed = (command & DEM_COMPRESSED) === DEM_COMPRESSED
			if (type === DEM_STOP) break
			const [tick, afterTick] = readVarUint(dem, pos)
			pos = afterTick
			this.tick = tick === 0xffff_ffff ? 0 : tick
			const [size, afterSize] = readVarUint(dem, pos)
			pos = afterSize
			let data = dem.subarray(pos, pos + size)
			pos += size
			if (compressed) data = snappyDecode(data)
			this.dispatchDemo(type, data)
		}
	}

	private dispatchDemo(type: number, data: Uint8Array): void {
		const fields = decodeFields(data)
		if (type === DEM_FILE_HEADER) {
			const dir = str(fields, 6) ?? ''
			const match = /\/dota_v(\d+)\//.exec(dir)
			if (match?.[1] != null) this.gameBuild = Number(match[1])
			else this.gameBuild = num(fields, 13) ?? this.gameBuild
			return
		}
		if (type === DEM_FILE_INFO) {
			this.hooks.onFileInfo?.(fields)
			return
		}
		if (type === DEM_SEND_TABLES) {
			this.onSendTables(bytes(fields, 1) ?? new Uint8Array())
			return
		}
		if (type === DEM_CLASS_INFO) {
			this.onClassInfo(fields)
			return
		}
		if (type === DEM_STRING_TABLES) {
			this.onDemoStringTables(fields)
			return
		}
		if (type === DEM_PACKET || type === DEM_SIGNON_PACKET) {
			this.onDemoPacket(bytes(fields, 3) ?? new Uint8Array())
			return
		}
		if (type === DEM_FULL_PACKET) {
			const tables = bytes(fields, 1)
			if (tables != null) this.onDemoStringTables(decodeFields(tables))
			const packet = bytes(fields, 2)
			if (packet != null) {
				const inner = decodeFields(packet)
				this.onDemoPacket(bytes(inner, 3) ?? packet)
			}
			return
		}
		if (type === DEM_RECOVERY) {
			const msg = bytes(fields, 2)
			if (msg == null || msg.length === 0) return
			const r = new BitReader(msg)
			const netType = r.readUBitVar()
			const size = r.readVarUint32()
			this.dispatchPacket(netType, r.readBytes(size))
		}
	}

	private onSendTables(raw: Uint8Array): void {
		const r = new BitReader(raw)
		const size = r.readVarUint32()
		if (size === 0 || size > r.remBytes()) {
			throw new Error(
				`CDemoSendTables: declared ${size} bytes, have ${r.remBytes()}`,
			)
		}
		const payload = r.readBytes(size)
		const msg = decodeFields(payload)
		const symbols = allBytes(msg, 2).map((b) => new TextDecoder().decode(b))
		const fieldMsgs = allBytes(msg, 3)
		const serMsgs = allBytes(msg, 1)
		const fields: Field[] = []
		for (const blob of fieldMsgs) {
			const f = decodeFields(blob)
			const field = new Field()
			const typeSym = num(f, 1)
			const nameSym = num(f, 2)
			field.varType = typeSym != null ? (symbols[typeSym] ?? '') : ''
			field.varName = nameSym != null ? (symbols[nameSym] ?? '') : ''
			field.bitCount = num(f, 3) ?? null
			field.lowValue = float32(f, 4) ?? null
			field.highValue = float32(f, 5) ?? null
			field.encodeFlags = num(f, 6) ?? null
			const serSym = num(f, 7)
			field.serializerName = serSym != null ? (symbols[serSym] ?? '') : ''
			field.serializerVersion = num(f, 8) ?? 0
			const nodeSym = num(f, 9)
			field.sendNode = nodeSym != null ? (symbols[nodeSym] ?? '') : ''
			if (field.sendNode === '(root)') field.sendNode = ''
			const encSym = num(f, 10)
			field.encoder = encSym != null ? (symbols[encSym] ?? '') : ''
			field.fieldType = parseFieldType(field.varType)
			patchField(field, this.gameBuild)
			fields.push(field)
		}
		for (const blob of serMsgs) {
			const s = decodeFields(blob)
			const nameSym = num(s, 1) ?? 0
			const serializer = new Serializer()
			serializer.name = symbols[nameSym] ?? ''
			serializer.version = num(s, 2) ?? 0
			const indexes = repeatedInt32(s, 3)
			for (const i of indexes) {
				const field = fields[i]
				if (field != null) serializer.fields.push(field)
			}
			this.serializers.set(
				`${serializer.name}(${serializer.version})`,
				serializer,
			)
			this.serializers.set(serializer.name, serializer)
			const cls = this.classesByName.get(serializer.name)
			if (cls != null) cls.serializer = serializer
		}
		for (const field of fields) {
			if (field.serializerName !== '') {
				field.serializer =
					this.serializers.get(
						`${field.serializerName}(${field.serializerVersion})`,
					) ??
					this.serializers.get(field.serializerName) ??
					null
			}
			applyFieldModel(field)
		}
	}

	private onClassInfo(fields: ProtoField[]): void {
		for (const blob of allBytes(fields, 1)) {
			const row = decodeFields(blob)
			const classId = num(row, 1) ?? 0
			const name = str(row, 2) ?? ''
			const def: ClassDef = {
				classId,
				name,
				serializer: this.serializers.get(name) ?? null,
			}
			this.classesById.set(classId, def)
			this.classesByName.set(name, def)
		}
		this.classInfo = true
		this.updateBaselines()
	}

	private onDemoPacket(data: Uint8Array): void {
		const r = new BitReader(data)
		const pending: Array<{ t: number; buf: Uint8Array }> = []
		while (r.remBytes() > 0) {
			const t = r.readUBitVar()
			const size = r.readVarUint32()
			pending.push({ t, buf: r.readBytes(size) })
		}
		pending.sort((a, b) => packetPriority(a.t) - packetPriority(b.t))
		for (const msg of pending) this.dispatchPacket(msg.t, msg.buf)
	}

	private dispatchPacket(type: number, data: Uint8Array): void {
		if (type === NET_TICK) {
			this.netTick = num(decodeFields(data), 1) ?? this.netTick
			this.hooks.onTick?.(this.tick)
			return
		}
		if (type === SVC_SERVER_INFO) {
			const fields = decodeFields(data)
			const maxClasses = num(fields, 11) ?? 0
			if (maxClasses > 0) {
				this.classIdSize = Math.floor(Math.log2(maxClasses)) + 1
			}
			const dir = str(fields, 14) ?? ''
			const match = /\/dota_v(\d+)\//.exec(dir)
			if (match?.[1] != null) this.gameBuild = Number(match[1])
			return
		}
		if (type === SVC_CREATE_STRING_TABLE) {
			this.onCreateStringTable(decodeFields(data))
			return
		}
		if (type === SVC_UPDATE_STRING_TABLE) {
			this.onUpdateStringTable(decodeFields(data))
			return
		}
		if (type === SVC_PACKET_ENTITIES) {
			try {
				this.onPacketEntities(decodeFields(data))
			} catch {
				// Keep user-messages (combat log, chat) even if this snapshot
				// desyncs. A later full snapshot can rebuild entity state.
			}
			return
		}
		if (type === SVC_USER_MESSAGE) {
			const fields = decodeFields(data)
			const msgType = num(fields, 1) ?? 0
			const msgData = bytes(fields, 2) ?? new Uint8Array()
			this.hooks.onUserMessage?.(msgType, msgData)
			return
		}
		// Dota user messages are inlined as packet types (EDotaUserMessages
		// 464+), not wrapped in svc_UserMessage.
		if (type >= 464) {
			this.hooks.onUserMessage?.(type, data)
		}
	}

	private onDemoStringTables(fields: ProtoField[]): void {
		for (const blob of allBytes(fields, 1)) {
			const tableMsg = decodeFields(blob)
			const name = str(tableMsg, 1) ?? ''
			const table = this.stringTableByName.get(name)
			if (table == null) continue
			table.items.clear()
			let index = 0
			for (const itemBlob of allBytes(tableMsg, 2)) {
				const item = decodeFields(itemBlob)
				table.items.set(index, {
					index,
					key: str(item, 1) ?? '',
					value: bytes(item, 2) ?? new Uint8Array(),
				})
				index += 1
			}
			if (name === 'instancebaseline') this.updateBaselines()
		}
	}

	private onCreateStringTable(fields: ProtoField[]): void {
		const table: StringTable = {
			index: this.stringTables.length,
			name: str(fields, 1) ?? '',
			items: new Map(),
			userDataFixedSize: bool(fields, 3),
			userDataSizeBits: num(fields, 5) ?? 0,
			flags: num(fields, 6) ?? 0,
			varintBitCounts: bool(fields, 10),
		}
		let data = bytes(fields, 7) ?? new Uint8Array()
		if (bool(fields, 9)) data = maybeSnappyStringData(data)
		const items = parseStringTable(
			data,
			num(fields, 2) ?? 0,
			table.userDataFixedSize,
			table.userDataSizeBits,
			table.flags,
			table.varintBitCounts,
		)
		for (const item of items) table.items.set(item.index, item)
		this.stringTables.push(table)
		this.stringTableByName.set(table.name, table)
		if (table.name === 'instancebaseline') this.updateBaselines()
	}

	private onUpdateStringTable(fields: ProtoField[]): void {
		const table = this.stringTables[num(fields, 1) ?? -1]
		if (table == null) return
		const items = parseStringTable(
			bytes(fields, 3) ?? new Uint8Array(),
			num(fields, 2) ?? 0,
			table.userDataFixedSize,
			table.userDataSizeBits,
			table.flags,
			table.varintBitCounts,
		)
		for (const item of items) {
			const prev = table.items.get(item.index)
			if (prev != null) {
				if (item.key !== '') prev.key = item.key
				if (item.value.length > 0) prev.value = item.value
			} else {
				table.items.set(item.index, item)
			}
		}
		if (table.name === 'instancebaseline') this.updateBaselines()
	}

	private updateBaselines(): void {
		if (!this.classInfo) return
		const table = this.stringTableByName.get('instancebaseline')
		if (table == null) return
		for (const item of table.items.values()) {
			const classId = Number(item.key)
			if (Number.isFinite(classId)) this.classBaselines.set(classId, item.value)
		}
		this.classBaselineStates.clear()
	}

	private onPacketEntities(fields: ProtoField[]): void {
		const data = bytes(fields, 7)
		if (data == null) return
		const isDelta = bool(fields, 3)
		if (!isDelta) {
			if (this.entityFullPackets > 0) return
			this.entityFullPackets += 1
		}
		this.entityReader.reset(data)
		this.applyEntityUpdates(num(fields, 2) ?? 0, (num(fields, 16) ?? 0) > 0)
	}

	private applyEntityUpdates(updates: number, hasPvsVisBits: boolean): void {
		const r = this.entityReader
		let index = -1
		for (let n = updates; n > 0; n--) {
			index += r.readUBitVar() + 1
			const cmd = r.readBits(2)
			let entity = this.entities.get(index)
			const op: EntityOp = {
				created: false,
				updated: false,
				deleted: false,
				entered: false,
				left: false,
			}
			if ((cmd & 0x01) === 0) {
				if ((cmd & 0x02) !== 0) {
					const classId = r.readBits(this.classIdSize)
					const serial = r.readBits(17)
					r.readVarUint32()
					const cls = this.classesById.get(classId)
					if (cls?.serializer == null) {
						throw new Error(`unknown entity class ${classId}`)
					}
					let baseline = this.classBaselineStates.get(classId)
					if (baseline == null) {
						const raw = this.classBaselines.get(classId) ?? new Uint8Array()
						baseline = new FieldState()
						if (raw.length > 0) {
							readFields(new BitReader(raw), cls.serializer, baseline)
						}
						this.classBaselineStates.set(classId, baseline)
					}
					entity = new Entity(
						index,
						serial,
						classId,
						cls.name,
						cls.serializer,
						baseline.clone(),
					)
					this.entities.set(index, entity)
					readFields(r, cls.serializer, entity.state)
					op.created = true
					op.entered = true
				} else {
					if (hasPvsVisBits && (r.readBits(2) & 0x01) !== 0) {
						continue
					}
					if (entity == null) return
					op.updated = true
					if (!entity.active) {
						entity.active = true
						op.entered = true
					}
					const cls = this.classesById.get(entity.classId)
					if (cls?.serializer == null) {
						throw new Error(`missing serializer for ${entity.className}`)
					}
					readFields(r, cls.serializer, entity.state)
				}
			} else {
				if (entity == null || !entity.active) continue
				op.left = true
				entity.active = false
				if ((cmd & 0x02) !== 0) {
					op.deleted = true
					this.entities.delete(index)
				}
			}
			if (entity != null) this.hooks.onEntity?.(entity, op)
		}
	}
}

function packetPriority(type: number): number {
	if (
		type === NET_TICK ||
		type === SVC_SERVER_INFO ||
		type === SVC_CREATE_STRING_TABLE ||
		type === SVC_UPDATE_STRING_TABLE
	) {
		return -10
	}
	if (type === SVC_PACKET_ENTITIES) return 5
	return 0
}

function readVarUint(buf: Uint8Array, offset: number): [number, number] {
	let result = 0
	let shift = 0
	let pos = offset
	while (pos < buf.length) {
		const b = buf[pos]!
		pos += 1
		result |= (b & 0x7f) << shift
		if ((b & 0x80) === 0) return [result >>> 0, pos]
		shift += 7
		if (shift > 35) throw new Error('varint too long')
	}
	throw new Error('truncated varint')
}
