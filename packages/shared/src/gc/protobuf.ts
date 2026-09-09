// Minimal protobuf2 reader/writer for the Dota GC messages we need.
// Unknown fields are skipped so Valve adding columns does not break salt lookup.

function readVarint(buf: Uint8Array, offset: number): [bigint, number] {
	let result = 0n
	let shift = 0n
	let pos = offset
	while (pos < buf.length) {
		const b = buf[pos]!
		pos += 1
		result |= BigInt(b & 0x7f) << shift
		if ((b & 0x80) === 0) return [result, pos]
		shift += 7n
		if (shift > 63n) throw new Error('varint too long')
	}
	throw new Error('truncated varint')
}

function writeVarint(value: bigint): Uint8Array {
	const bytes: number[] = []
	let n = value
	while (n >= 0x80n) {
		bytes.push(Number(n & 0x7fn) | 0x80)
		n >>= 7n
	}
	bytes.push(Number(n))
	return Uint8Array.from(bytes)
}

function skip(buf: Uint8Array, offset: number, wire: number): number {
	switch (wire) {
		case 0:
			return readVarint(buf, offset)[1]
		case 1:
			return offset + 8
		case 2: {
			const [len, next] = readVarint(buf, offset)
			return next + Number(len)
		}
		case 5:
			return offset + 4
		default:
			throw new Error(`unsupported protobuf wire type ${wire}`)
	}
}

export type ProtoField = {
	field: number
	wire: number
	varint?: bigint
	bytes?: Uint8Array
	fixed32?: number
	fixed64?: bigint
}

export function decodeFields(buf: Uint8Array): ProtoField[] {
	const fields: ProtoField[] = []
	let pos = 0
	while (pos < buf.length) {
		const [tag, afterTag] = readVarint(buf, pos)
		const field = Number(tag >> 3n)
		const wire = Number(tag & 7n)
		pos = afterTag
		if (wire === 0) {
			const [value, next] = readVarint(buf, pos)
			fields.push({ field, wire, varint: value })
			pos = next
			continue
		}
		if (wire === 2) {
			const [len, start] = readVarint(buf, pos)
			const end = start + Number(len)
			fields.push({ field, wire, bytes: buf.slice(start, end) })
			pos = end
			continue
		}
		if (wire === 5) {
			if (pos + 4 > buf.length) throw new Error('truncated fixed32')
			const fixed32 =
				(buf[pos]! |
					(buf[pos + 1]! << 8) |
					(buf[pos + 2]! << 16) |
					(buf[pos + 3]! << 24)) >>>
				0
			fields.push({ field, wire, fixed32 })
			pos += 4
			continue
		}
		if (wire === 1) {
			if (pos + 8 > buf.length) throw new Error('truncated fixed64')
			const lo =
				(buf[pos]! |
					(buf[pos + 1]! << 8) |
					(buf[pos + 2]! << 16) |
					(buf[pos + 3]! << 24)) >>>
				0
			const hi =
				(buf[pos + 4]! |
					(buf[pos + 5]! << 8) |
					(buf[pos + 6]! << 16) |
					(buf[pos + 7]! << 24)) >>>
				0
			fields.push({
				field,
				wire,
				fixed64: BigInt(lo) + (BigInt(hi) << 32n),
			})
			pos += 8
			continue
		}
		pos = skip(buf, pos, wire)
	}
	return fields
}

export function encodeVarintField(
	field: number,
	value: bigint | number,
): Buffer {
	const n = typeof value === 'bigint' ? value : BigInt(value)
	const tag = Buffer.from(writeVarint(BigInt((field << 3) | 0)))
	return Buffer.concat([tag, Buffer.from(writeVarint(n))])
}

/** CMsgClientHello: version=1, engine=Source2. Empty payload is ignored by the GC. */
export function encodeClientHello(): Buffer {
	return Buffer.concat([encodeVarintField(1, 1), encodeVarintField(7, 1)])
}

export function encodeMatchDetailsRequest(matchId: number | bigint): Buffer {
	const id = typeof matchId === 'bigint' ? matchId : BigInt(matchId)
	// field 1, wire 0
	return Buffer.concat([Buffer.from([0x08]), Buffer.from(writeVarint(id))])
}

export type GcMatchReplayLocator = {
	result: number
	matchId: number | null
	cluster: number | null
	replaySalt: number | null
	replayState: number | null
	match: Record<string, unknown> | null
}

function num(field: ProtoField | undefined): number | undefined {
	if (field?.varint !== undefined) return Number(field.varint)
	if (field?.fixed32 !== undefined) return field.fixed32
	if (field?.fixed64 !== undefined) return Number(field.fixed64)
	return undefined
}

function str(field: ProtoField | undefined): string | undefined {
	if (field?.bytes === undefined) return undefined
	return new TextDecoder().decode(field.bytes)
}

function float32(field: ProtoField | undefined): number | undefined {
	if (field?.fixed32 === undefined) return undefined
	const buf = new ArrayBuffer(4)
	const view = new DataView(buf)
	view.setUint32(0, field.fixed32, true)
	return view.getFloat32(0, true)
}

function bool(field: ProtoField | undefined): boolean | undefined {
	if (field?.varint === undefined) return undefined
	return field.varint !== 0n
}

function first(fields: ProtoField[], id: number): ProtoField | undefined {
	return fields.find((field) => field.field === id)
}

function all(fields: ProtoField[], id: number): ProtoField[] {
	return fields.filter((field) => field.field === id)
}

function packedUint32(field: ProtoField | undefined): number[] {
	if (field?.bytes === undefined) return []
	const out: number[] = []
	let pos = 0
	while (pos < field.bytes.length) {
		const [value, next] = readVarint(field.bytes, pos)
		out.push(Number(value))
		pos = next
	}
	return out
}

function repeatedUint32(fields: ProtoField[], id: number): number[] {
	const found = all(fields, id)
	if (found.length === 0) return []
	if (found.length === 1 && found[0]?.bytes !== undefined) {
		return packedUint32(found[0])
	}
	return found.flatMap((field) => {
		const n = num(field)
		return n === undefined ? [] : [n]
	})
}

function repeatedInt32(fields: ProtoField[], id: number): number[] {
	return repeatedUint32(fields, id)
}

export function protoNum(fields: ProtoField[], id: number): number | undefined {
	return num(first(fields, id))
}

export function protoSint32(
	fields: ProtoField[],
	id: number,
): number | undefined {
	const field = first(fields, id)
	if (field?.varint === undefined) return undefined
	const n = Number(field.varint)
	return (n >>> 1) ^ -(n & 1)
}

export function protoBool(fields: ProtoField[], id: number): boolean {
	return (first(fields, id)?.varint ?? 0n) !== 0n
}

export function protoBytes(
	fields: ProtoField[],
	id: number,
): Uint8Array | undefined {
	return first(fields, id)?.bytes
}

export function protoStr(fields: ProtoField[], id: number): string | undefined {
	const raw = protoBytes(fields, id)
	if (raw == null) return undefined
	return new TextDecoder().decode(raw)
}

export function protoFloat32(
	fields: ProtoField[],
	id: number,
): number | undefined {
	return float32(first(fields, id))
}

export function protoAllBytes(fields: ProtoField[], id: number): Uint8Array[] {
	return all(fields, id).flatMap((field) =>
		field.bytes != null ? [field.bytes] : [],
	)
}

export function protoRepeatedInt32(fields: ProtoField[], id: number): number[] {
	return repeatedInt32(fields, id)
}

function decodePickBan(bytes: Uint8Array): Record<string, unknown> {
	const fields = decodeFields(bytes)
	return {
		is_pick: bool(first(fields, 1)) ?? false,
		team: num(first(fields, 2)) ?? 0,
		hero_id: num(first(fields, 3)) ?? 0,
	}
}

function decodeAbilityUpgrade(bytes: Uint8Array): Record<string, unknown> {
	const fields = decodeFields(bytes)
	return {
		ability: num(first(fields, 1)),
		time: num(first(fields, 2)),
	}
}

function decodeBuff(bytes: Uint8Array): Record<string, unknown> {
	const fields = decodeFields(bytes)
	return {
		permanent_buff: num(first(fields, 1)),
		stack_count: num(first(fields, 2)),
		grant_time: num(first(fields, 3)),
	}
}

function decodeUnit(bytes: Uint8Array): Record<string, unknown> {
	const fields = decodeFields(bytes)
	return {
		unit_name: str(first(fields, 1)),
		items: repeatedInt32(fields, 2),
	}
}

function decodeHeroDamage(bytes: Uint8Array): Record<string, unknown> {
	const fields = decodeFields(bytes)
	return {
		pre_reduction: num(first(fields, 1)),
		post_reduction: num(first(fields, 2)),
		damage_type: num(first(fields, 3)) ?? 0,
	}
}

function decodeCoach(bytes: Uint8Array): Record<string, unknown> {
	const fields = decodeFields(bytes)
	return {
		account_id: num(first(fields, 1)),
		coach_name: str(first(fields, 2)),
		coach_rating: num(first(fields, 3)),
		coach_team: num(first(fields, 4)),
		coach_party_id: num(first(fields, 5)),
		is_private_coach: bool(first(fields, 6)),
	}
}

function decodeBroadcaster(bytes: Uint8Array): Record<string, unknown> {
	const fields = decodeFields(bytes)
	return {
		account_id: num(first(fields, 1)),
		name: str(first(fields, 2)),
	}
}

function decodeBroadcasterChannel(bytes: Uint8Array): Record<string, unknown> {
	const fields = decodeFields(bytes)
	return {
		country_code: str(first(fields, 1)),
		description: str(first(fields, 2)),
		broadcaster_infos: all(fields, 3).flatMap((field) =>
			field.bytes ? [decodeBroadcaster(field.bytes)] : [],
		),
		language_code: str(first(fields, 4)),
	}
}

function decodeGcPlayer(bytes: Uint8Array): Record<string, unknown> {
	const fields = decodeFields(bytes)
	return {
		account_id: num(first(fields, 1)),
		player_slot: num(first(fields, 2)),
		hero_id: num(first(fields, 3)),
		item_0: num(first(fields, 4)),
		item_1: num(first(fields, 5)),
		item_2: num(first(fields, 6)),
		item_3: num(first(fields, 7)),
		item_4: num(first(fields, 8)),
		item_5: num(first(fields, 9)),
		item_6: num(first(fields, 59)),
		item_7: num(first(fields, 60)),
		item_8: num(first(fields, 61)),
		item_9: num(first(fields, 76)),
		item_10: num(first(fields, 83)),
		item_10_lvl: num(first(fields, 84)),
		kills: num(first(fields, 14)),
		deaths: num(first(fields, 15)),
		assists: num(first(fields, 16)),
		leaver_status: num(first(fields, 17)),
		gold: num(first(fields, 18)),
		last_hits: num(first(fields, 19)),
		denies: num(first(fields, 20)),
		gold_per_min: num(first(fields, 21)),
		xp_per_min: num(first(fields, 22)),
		gold_spent: num(first(fields, 23)),
		hero_damage: num(first(fields, 24)),
		tower_damage: num(first(fields, 25)),
		hero_healing: num(first(fields, 26)),
		disable_duration: num(first(fields, 85)),
		level: num(first(fields, 27)),
		player_name: str(first(fields, 29)),
		support_ability_value: num(first(fields, 30)),
		party_id: num(first(fields, 38)),
		scaled_hero_damage: num(first(fields, 54)),
		scaled_tower_damage: num(first(fields, 55)),
		scaled_hero_healing: num(first(fields, 56)),
		scaled_kills: float32(first(fields, 39)),
		scaled_deaths: float32(first(fields, 40)),
		scaled_assists: float32(first(fields, 41)),
		claimed_farm_gold: num(first(fields, 42)),
		support_gold: num(first(fields, 43)),
		claimed_denies: num(first(fields, 44)),
		claimed_misses: num(first(fields, 45)),
		misses: num(first(fields, 46)),
		ability_upgrades: all(fields, 47).flatMap((field) =>
			field.bytes ? [decodeAbilityUpgrade(field.bytes)] : [],
		),
		additional_units: all(fields, 48).flatMap((field) =>
			field.bytes ? [decodeUnit(field.bytes)] : [],
		),
		permanent_buffs: all(fields, 57).flatMap((field) =>
			field.bytes ? [decodeBuff(field.bytes)] : [],
		),
		net_worth: num(first(fields, 52)),
		hero_pick_order: num(first(fields, 63)),
		hero_was_randomed: bool(first(fields, 64)),
		hero_damage_received: all(fields, 67).flatMap((field) =>
			field.bytes ? [decodeHeroDamage(field.bytes)] : [],
		),
		hero_damage_dealt: all(fields, 79).flatMap((field) =>
			field.bytes ? [decodeHeroDamage(field.bytes)] : [],
		),
		seconds_dead: num(first(fields, 70)),
		gold_lost_to_death: num(first(fields, 71)),
		pro_name: str(first(fields, 72)),
		real_name: str(first(fields, 73)),
		lane_selection_flags: num(first(fields, 75)),
		bounty_runes: num(first(fields, 77)),
		outposts_captured: num(first(fields, 78)),
		team_number: num(first(fields, 80)),
		team_slot: num(first(fields, 81)),
		selected_facet: num(first(fields, 82)),
	}
}

/** Maps CMsgDOTAMatch onto the same keys extractMatchFacts / extractPlayers use. */
export function decodeGcMatch(bytes: Uint8Array): Record<string, unknown> {
	const fields = decodeFields(bytes)
	const towers = repeatedUint32(fields, 8)
	const barracks = repeatedUint32(fields, 9)
	return {
		duration: num(first(fields, 3)),
		start_time: num(first(fields, 4)),
		players: all(fields, 5).flatMap((field) =>
			field.bytes ? [decodeGcPlayer(field.bytes)] : [],
		),
		match_id: num(first(fields, 6)),
		tower_status: towers,
		tower_status_radiant: towers[0],
		tower_status_dire: towers[1],
		barracks_status: barracks,
		barracks_status_radiant: barracks[0],
		barracks_status_dire: barracks[1],
		cluster: num(first(fields, 10)),
		first_blood_time: num(first(fields, 12)),
		replay_salt: num(first(fields, 13)),
		lobby_type: num(first(fields, 16)),
		human_players: num(first(fields, 17)),
		game_balance: float32(first(fields, 19)),
		radiant_team_id: num(first(fields, 20)),
		dire_team_id: num(first(fields, 21)),
		leagueid: num(first(fields, 22)),
		radiant_team_name: str(first(fields, 23)),
		dire_team_name: str(first(fields, 24)),
		radiant_team_logo: num(first(fields, 25)),
		dire_team_logo: num(first(fields, 26)),
		radiant_team_complete: num(first(fields, 27)),
		dire_team_complete: num(first(fields, 28)),
		game_mode: num(first(fields, 31)),
		picks_bans: all(fields, 32).flatMap((field) =>
			field.bytes ? [decodePickBan(field.bytes)] : [],
		),
		match_seq_num: num(first(fields, 33)),
		replay_state: num(first(fields, 34)),
		radiant_guild_id: num(first(fields, 35)),
		dire_guild_id: num(first(fields, 36)),
		radiant_team_tag: str(first(fields, 37)),
		dire_team_tag: str(first(fields, 38)),
		series_id: num(first(fields, 39)),
		series_type: num(first(fields, 40)),
		broadcaster_channels: all(fields, 43).flatMap((field) =>
			field.bytes ? [decodeBroadcasterChannel(field.bytes)] : [],
		),
		engine: num(first(fields, 44)),
		match_flags: num(first(fields, 46)),
		radiant_score: num(first(fields, 48)),
		dire_score: num(first(fields, 49)),
		match_outcome: num(first(fields, 50)),
		tournament_id: num(first(fields, 51)),
		tournament_round: num(first(fields, 52)),
		pre_game_duration: num(first(fields, 53)),
		radiant_team_logo_url: str(first(fields, 54)),
		dire_team_logo_url: str(first(fields, 55)),
		coaches: all(fields, 57).flatMap((field) =>
			field.bytes ? [decodeCoach(field.bytes)] : [],
		),
	}
}

export function decodeMatchDetailsResponse(
	buf: Uint8Array,
): GcMatchReplayLocator {
	const fields = decodeFields(buf)
	const result = Number(fields.find((f) => f.field === 1)?.varint ?? 0n)
	const matchBytes = fields.find((f) => f.field === 2)?.bytes
	if (matchBytes === undefined) {
		return {
			result,
			matchId: null,
			cluster: null,
			replaySalt: null,
			replayState: null,
			match: null,
		}
	}

	const match = decodeGcMatch(matchBytes)
	return {
		result,
		matchId: typeof match.match_id === 'number' ? match.match_id : null,
		cluster: typeof match.cluster === 'number' ? match.cluster : null,
		replaySalt:
			typeof match.replay_salt === 'number' ? match.replay_salt : null,
		replayState:
			typeof match.replay_state === 'number' ? match.replay_state : null,
		match,
	}
}

export const GC_MSG = {
	clientWelcome: 4004,
	clientHello: 4006,
	connectionStatus: 4009,
	matchDetailsRequest: 7095,
	matchDetailsResponse: 7096,
} as const

export const DOTA_APP_ID = 570

export const REPLAY_STATE = {
	available: 0,
	notRecorded: 1,
	expired: 2,
} as const

/** Steam EResult on `CMsgGCMatchDetailsResponse.result`. */
export const GC_ERESULT = {
	ok: 1,
	accessDenied: 15,
} as const

/**
 * Match-level denial from the GC. Same session still serves other matches,
 * so this is not a proxy / account fault — retrying occupies a details
 * shard and never unblocks.
 */
export function isTerminalGcDetailsResult(result: number): boolean {
	return result === GC_ERESULT.accessDenied
}
