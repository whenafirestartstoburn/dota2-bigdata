import { describe, expect, test } from 'bun:test'
import {
	announcementObjective,
	mapReplayEvent,
	toValvePlayerSlot,
} from './parser-events'

const start = '2026-08-01 00:00:00'

describe('mapReplayEvent', () => {
	test('strips combat-log prefix', () => {
		const mapped = mapReplayEvent(1, start, {
			type: 'DOTA_COMBATLOG_DAMAGE',
			time: 12,
			attackername: 'npc_dota_hero_axe',
			value: 80,
		})
		expect(mapped?.table).toBe('replay_combat_log')
		expect(mapped?.row.type).toBe('DAMAGE')
		expect(mapped?.row.value).toBe(80)
	})

	test('maps interval snapshots', () => {
		const mapped = mapReplayEvent(1, start, {
			type: 'interval',
			slot: 0,
			gold: 500,
			lh: 10,
		})
		expect(mapped?.table).toBe('replay_intervals')
		expect(mapped?.row.gold).toBe(500)
	})

	test('maps ward expire as sen_left', () => {
		const mapped = mapReplayEvent(1, start, {
			type: 'sen_left',
			x: 1,
			y: 2,
			z: 3,
		})
		expect(mapped?.table).toBe('replay_wards')
		expect(mapped?.row.kind).toBe('sen')
		expect(mapped?.row.is_left).toBe(1)
	})

	test('keeps unknown chat events', () => {
		const mapped = mapReplayEvent(1, start, {
			type: 'CHAT_MESSAGE_TOWER_KILL',
			player1: 0,
			value: 2,
		})
		expect(mapped?.table).toBe('replay_announcements')
		expect(announcementObjective('CHAT_MESSAGE_TOWER_KILL')).toBe('tower')
		expect(mapped?.row.slot).toBe(0)
	})

	test('skips player_slot bookkeeping rows', () => {
		expect(
			mapReplayEvent(1, start, { type: 'player_slot', key: '0' }),
		).toBeNull()
	})

	test('reads Clarity draft_timings (draft_order, pick, DOTA_TEAM 2/3)', () => {
		const mapped = mapReplayEvent(1, start, {
			type: 'draft_timings',
			hero_id: 41,
			draft_order: 1,
			pick: false,
			draft_active_team: 2,
			time: -926,
		})
		expect(mapped?.table).toBe('replay_draft')
		expect(mapped?.row).toMatchObject({
			hero_id: 41,
			is_pick: 0,
			ord: 0,
			team: 0,
			clock: -926,
			extra_time_radiant: 0,
			extra_time_dire: 0,
		})
	})

	test('maps inventory, chat, and epilogue types', () => {
		expect(
			mapReplayEvent(1, start, {
				type: 'STARTING_ITEM',
				valuename: 'item_tango',
				itemslot: 2,
				charges: 6,
			})?.row,
		).toMatchObject({ item_id: 'item_tango', item_slot: 2, charges: 6 })
		expect(
			mapReplayEvent(1, start, { type: 'chat', key: 'glhf', slot: 4 })?.table,
		).toBe('replay_chat')
		expect(
			mapReplayEvent(1, start, { type: 'epilogue', key: '{}' })?.table,
		).toBe('replay_epilogue')
		expect(
			mapReplayEvent(1, start, {
				type: 'DOTA_COMBATLOG_PICKUP_RUNE',
				health: 800,
				rune_type: 1,
			})?.row,
		).toMatchObject({ type: 'PICKUP_RUNE', health: 800, rune_type: 1 })
	})
})

describe('toValvePlayerSlot', () => {
	test('maps Clarity 0–9 onto Valve 0–4 / 128–132', () => {
		expect(toValvePlayerSlot(0)).toBe(0)
		expect(toValvePlayerSlot(4)).toBe(4)
		expect(toValvePlayerSlot(5)).toBe(128)
		expect(toValvePlayerSlot(9)).toBe(132)
		expect(toValvePlayerSlot(-1)).toBe(-1)
	})
})
