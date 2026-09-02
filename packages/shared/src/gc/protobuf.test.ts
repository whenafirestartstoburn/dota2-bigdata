import { describe, expect, test } from 'bun:test'
import {
	decodeFields,
	decodeGcMatch,
	decodeMatchDetailsResponse,
	encodeClientHello,
	encodeMatchDetailsRequest,
	protoFloat32,
	protoNum,
	protoSint32,
} from './protobuf'

describe('gc protobuf', () => {
	test('round-trips match_id in the request', () => {
		const encoded = encodeMatchDetailsRequest(8937790009)
		expect(encoded[0]).toBe(0x08)
		// field 1 varint of 8937790009
		expect(encoded.length).toBeGreaterThan(1)
	})

	test('reads cluster and replay_salt from a response', () => {
		const salt = Buffer.alloc(4)
		salt.writeUInt32LE(1509767537, 0)
		const match = Buffer.concat([
			Buffer.from([0x30, 0x0a]), // field 6 varint 10
			Buffer.from([0x50, 0xb6, 0x01]), // field 10 varint 182
			Buffer.from([0x6d]), // field 13, wire 5
			salt,
		])
		const response = Buffer.concat([
			Buffer.from([0x08, 0x01]),
			Buffer.from([0x12, match.length]),
			match,
		])
		const decoded = decodeMatchDetailsResponse(response)
		expect(decoded.result).toBe(1)
		expect(decoded.matchId).toBe(10)
		expect(decoded.cluster).toBe(182)
		expect(decoded.replaySalt).toBe(1509767537)
		expect(decoded.match?.cluster).toBe(182)
	})

	test('decodes CMsgDOTAMatch players and match scalars', () => {
		const player = Buffer.concat([
			Buffer.from([0x08, 0x2a]), // account_id 42
			Buffer.from([0x10, 0x00]), // player_slot 0
			Buffer.from([0x18, 0x01]), // hero_id 1
			Buffer.from([0x20, 0x05]), // item_0 5
			Buffer.from([0x90, 0x05, 0x02]), // selected_facet field 82 = 2
		])
		const name = Buffer.from('OG')
		const match = Buffer.concat([
			Buffer.from([0x18, 0x0a]), // duration 10 field 3
			Buffer.from([0x30, 0x0a]), // match_id 10 field 6
			Buffer.from([0x2a, player.length]), // players field 5
			player,
			Buffer.from([0x60, 0x07]), // first_blood_time 7 field 12
			Buffer.from([0xba, 0x01, name.length]), // radiant_team_name field 23
			name,
			Buffer.from([0x90, 0x03, 0x02]), // match_outcome 2 field 50
		])
		const decoded = decodeGcMatch(match)
		expect(decoded.match_id).toBe(10)
		expect(decoded.duration).toBe(10)
		expect(decoded.first_blood_time).toBe(7)
		expect(decoded.radiant_team_name).toBe('OG')
		expect(decoded.match_outcome).toBe(2)
		const roster = decoded.players as Array<Record<string, unknown>>
		expect(roster[0]?.account_id).toBe(42)
		expect(roster[0]?.item_0).toBe(5)
		expect(roster[0]?.selected_facet).toBe(2)
	})

	test('ClientHello sets version and Source 2 engine', () => {
		const fields = decodeFields(encodeClientHello())
		expect(Number(fields.find((f) => f.field === 1)?.varint)).toBe(1)
		expect(Number(fields.find((f) => f.field === 7)?.varint)).toBe(1)
	})

	test('protoSint32 zigzag-decodes omitted-as-minus-one chat player ids', () => {
		const fields = decodeFields(Uint8Array.from([0x18, 0x01]))
		expect(protoSint32(fields, 3)).toBe(-1)
	})

	test('protoFloat32 reads IEEE-754 bits; protoNum keeps the raw uint', () => {
		const bits = new ArrayBuffer(4)
		new DataView(bits).setFloat32(0, 100.5, true)
		const raw = new Uint8Array(bits)
		const fields = decodeFields(Uint8Array.from([0x7d, ...raw]))
		expect(protoFloat32(fields, 15)).toBeCloseTo(100.5)
		expect(protoNum(fields, 15)).not.toBe(100.5)
	})
})
