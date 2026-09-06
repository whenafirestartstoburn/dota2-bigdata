import { afterAll, describe, expect, test } from 'bun:test'
import {
	abilityKind,
	parseCatalogs,
	persistCatalogs,
} from '#src/store/catalogs'
import { db, sql } from '#src/utils/db'

const FIXTURE = {
	heroes: {
		1: {
			id: 1,
			name: 'npc_dota_hero_antimage',
			localized_name: 'Anti-Mage',
			primary_attr: 'agi',
			attack_type: 'Melee',
			roles: ['Carry', 'Escape'],
		},
	},
	items: {
		blink: { id: 1, dname: 'Blink Dagger', cost: 2250 },
		empty: { id: 0, dname: '' },
	},
	ability_ids: {
		5001: 'antimage_mana_break',
		6001: 'special_bonus_unique_antimage',
		0: 'dota_base_ability',
		7001: 'item_blink',
		8001: 'antimage_innate_mana',
	},
	abilities: {
		antimage_mana_break: { dname: 'Mana Break' },
		special_bonus_unique_antimage: { dname: '-1s Blink Cooldown' },
		item_blink: { dname: 'Blink' },
	},
	hero_abilities: {
		npc_dota_hero_antimage: {
			abilities: ['antimage_mana_break', 'generic_hidden'],
			talents: [{ name: 'special_bonus_unique_antimage', level: 4 }],
			facets: [
				{
					id: 0,
					name: 'antimage_mana_thirst',
					title: 'Mana Thirst',
					icon: 'mana',
					color: 'Blue',
					deprecated: 'true',
				},
			],
		},
	},
	patch: [{ name: '7.39', date: '2025-05-23T00:00:00Z' }],
	game_mode: {
		'22': { id: 22, name: 'game_mode_ability_draft', balanced: false },
	},
	lobby_type: { '1': { id: 1, name: 'lobby_type_practice', balanced: true } },
	region: { '1': 'US WEST' },
	cluster: { '111': 1 },
	permanent_buffs: { '1': 'moon_shard' },
	xp_level: [0, 240, 640],
}

describe('abilityKind', () => {
	test('classifies spells, talents, innates, items, and placeholders', () => {
		expect(abilityKind('antimage_mana_break')).toBe('spell')
		expect(abilityKind('special_bonus_unique_antimage')).toBe('talent')
		expect(abilityKind('antimage_innate_mana')).toBe('innate')
		expect(abilityKind('item_blink')).toBe('item')
		expect(abilityKind('generic_hidden')).toBe('other')
		expect(abilityKind('dota_base_ability')).toBe('other')
	})
})

describe('parseCatalogs', () => {
	test('maps OpenDota constants onto catalog rows', () => {
		const snap = parseCatalogs(FIXTURE)
		expect(snap.heroes).toEqual([
			{
				hero_id: 1,
				name: 'npc_dota_hero_antimage',
				localized_name: 'Anti-Mage',
				primary_attr: 'agi',
				attack_type: 'Melee',
				roles: ['Carry', 'Escape'],
			},
		])
		expect(snap.items).toEqual([
			{
				item_id: 1,
				name: 'blink',
				localized_name: 'Blink Dagger',
				cost: 2250,
			},
		])
		expect(
			Object.fromEntries(
				snap.abilities.map((row) => [row.ability_id, row.kind]),
			),
		).toEqual({
			5001: 'spell',
			6001: 'talent',
			0: 'other',
			7001: 'item',
			8001: 'innate',
		})
		expect(snap.heroAbilities).toEqual([
			{
				hero_id: 1,
				ability_id: 5001,
				slot: 0,
				is_talent: false,
				talent_level: null,
			},
			{
				hero_id: 1,
				ability_id: 6001,
				slot: 0,
				is_talent: true,
				talent_level: 4,
			},
		])
		expect(snap.heroFacets[0]).toMatchObject({
			hero_id: 1,
			facet_id: 0,
			name: 'antimage_mana_thirst',
			localized_name: 'Mana Thirst',
			deprecated: true,
		})
		expect(snap.patches[0]?.patch).toBe('7.39')
		expect(snap.gameModes[0]?.id).toBe(22)
		expect(snap.regions[0]).toEqual({ region: 1, name: 'US WEST' })
		expect(snap.clusters[0]).toEqual({ cluster: 111, region: 1 })
		expect(snap.permanentBuffs[0]).toEqual({
			buff_id: 1,
			name: 'moon_shard',
		})
		expect(snap.xpLevels).toEqual([
			{ level: 1, xp: 0 },
			{ level: 2, xp: 240 },
			{ level: 3, xp: 640 },
		])
	})
})

describe('persistCatalogs', () => {
	const heroId = 990001
	const abilityId = 990001

	afterAll(async () => {
		await db.execute(sql`DELETE FROM hero_facets WHERE hero_id = ${heroId}`)
		await db.execute(sql`DELETE FROM hero_abilities WHERE hero_id = ${heroId}`)
		await db.execute(sql`DELETE FROM heroes WHERE hero_id = ${heroId}`)
		await db.execute(sql`DELETE FROM abilities WHERE ability_id = ${abilityId}`)
		await db.execute(sql`DELETE FROM items WHERE item_id = ${990001}`)
		await db.execute(sql`DELETE FROM permanent_buffs WHERE buff_id = ${990001}`)
		await db.execute(sql`DELETE FROM game_modes WHERE game_mode = ${990001}`)
		await db.execute(sql`DELETE FROM lobby_types WHERE lobby_type = ${990001}`)
		await db.execute(sql`DELETE FROM regions WHERE region = ${990001}`)
		await db.execute(sql`DELETE FROM clusters WHERE cluster = ${990001}`)
		await db.execute(sql`DELETE FROM xp_levels WHERE level = ${990001}`)
		await db.execute(sql`DELETE FROM patches WHERE patch = ${'99.001-test'}`)
	})

	test('upserts a synthetic catalog slice', async () => {
		await persistCatalogs({
			heroes: [
				{
					hero_id: heroId,
					name: 'npc_dota_hero_catalog_test',
					localized_name: 'Catalog Test',
					primary_attr: 'str',
					attack_type: 'Melee',
					roles: ['Carry'],
				},
			],
			items: [
				{
					item_id: 990001,
					name: 'catalog_test_item',
					localized_name: 'Test Item',
					cost: 1,
				},
			],
			abilities: [
				{
					ability_id: abilityId,
					name: 'catalog_test_spell',
					localized_name: 'Test Spell',
					kind: 'spell',
				},
			],
			heroAbilities: [
				{
					hero_id: heroId,
					ability_id: abilityId,
					slot: 0,
					is_talent: false,
					talent_level: null,
				},
			],
			heroFacets: [
				{
					hero_id: heroId,
					facet_id: 0,
					name: 'catalog_test_facet',
					localized_name: 'Test Facet',
					icon: 'test',
					color: 'Red',
					deprecated: false,
				},
			],
			patches: [
				{
					patch: '99.001-test',
					released_at: new Date('2099-01-01T00:00:00Z'),
				},
			],
			gameModes: [{ id: 990001, name: 'game_mode_test', balanced: false }],
			lobbyTypes: [{ id: 990001, name: 'lobby_type_test', balanced: true }],
			regions: [{ region: 990001, name: 'TEST' }],
			clusters: [{ cluster: 990001, region: 990001 }],
			permanentBuffs: [{ buff_id: 990001, name: 'test_buff' }],
			xpLevels: [{ level: 990001, xp: 1 }],
		})

		const [hero] = await db.execute(sql`
			SELECT localized_name, roles
			FROM heroes WHERE hero_id = ${heroId}
		`)
		expect(hero?.localized_name).toBe('Catalog Test')
		expect(hero?.roles).toEqual(['Carry'])
	})
})
