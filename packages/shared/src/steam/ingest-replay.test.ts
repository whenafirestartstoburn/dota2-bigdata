import { describe, expect, test } from 'bun:test'
import meta from './fixtures/match-5240837699.meta.json'
import { ingestReplayNdjson } from './ingest-replay'
import { toValvePlayerSlot } from './parser-events'

const MATCH_ID = meta.match_id
const START = new Date(meta.start_time * 1000)
	.toISOString()
	.slice(0, 19)
	.replace('T', ' ')

const ndjson = await Bun.file(
	new URL('./fixtures/match-5240837699.ndjson', import.meta.url),
).text()
const ingested = ingestReplayNdjson(MATCH_ID, START, ndjson)

describe('ingestReplayNdjson — Astralis vs Longinus (match 5240837699)', () => {
	test('skips malformed JSON and player_slot mapping rows', () => {
		const messy = ingestReplayNdjson(
			MATCH_ID,
			START,
			'not json\n{"type":"player_slot","key":"0","value":0}\n{"type":"interval","slot":0,"gold":1}\n',
		)
		expect(messy.events).toBe(1)
		expect(messy.buckets.get('replay_intervals')).toHaveLength(1)
	})

	test('first blood time matches the fixture, not a guessed constant', () => {
		const fb = ingested.objectives.find((row) => row.kind === 'first_blood')
		expect(fb?.time).toBe(meta.first_blood_time)
		expect(fb?.slot).toBe(1)
	})

	test('Roshan kills match fixture objective times', () => {
		const times = ingested.objectives
			.filter((row) => row.kind === 'roshan')
			.map((row) => row.time)
		expect(times).toEqual(meta.roshan_times)
	})

	test('draft hero order and pick/ban flags match the fixture', () => {
		const byOrd = [...ingested.draft].sort((a, b) => a.ord - b.ord)
		expect(byOrd.map((row) => row.heroId)).toEqual(
			meta.picks_bans.map((row) => row.hero_id),
		)
		expect(byOrd.map((row) => row.isPick)).toEqual(
			meta.picks_bans.map((row) => row.is_pick),
		)
		expect(byOrd.map((row) => row.ord)).toEqual(
			meta.picks_bans.map((row) => row.ord),
		)
	})

	test('end-game interval KDA and heroes match the fixture box score', () => {
		for (const player of meta.players) {
			const claritySlot =
				player.player_slot >= 128
					? player.player_slot - 128 + 5
					: player.player_slot
			expect(toValvePlayerSlot(claritySlot)).toBe(player.player_slot)
			const row = ingested.lastInterval.get(claritySlot)
			expect(
				row,
				`missing interval for valve slot ${player.player_slot}`,
			).toBeDefined()
			expect(row?.hero_id).toBe(player.hero_id)
			expect(row?.kills).toBe(player.kills)
			expect(row?.deaths).toBe(player.deaths)
			expect(row?.assists).toBe(player.assists)
			expect(row?.time).toBeGreaterThanOrEqual(meta.duration)
			expect(row?.time).toBeLessThanOrEqual(meta.duration + 2)
		}
	})

	test('all-chat line from the fixture is stored (time + text)', () => {
		const chats = ingested.buckets.get('replay_chat') ?? []
		expect(chats).toContainEqual(
			expect.objectContaining({
				kind: 'chat',
				key: meta.chat.key,
				time: meta.chat.time,
			}),
		)
		expect(chats.some((row) => row.key === meta.chat.key)).toBe(true)
	})

	test('starting items and combat log land in the ClickHouse tables we ingest', () => {
		const items = ingested.buckets.get('replay_inventory') ?? []
		expect(items.some((row) => row.item_id === 'item_branches')).toBe(true)
		const combat = ingested.buckets.get('replay_combat_log') ?? []
		expect(combat[0]?.type).toBe('DAMAGE')
		expect(ingested.buckets.get('replay_epilogue')?.length).toBe(1)
	})
})
