import { describe, expect, test } from 'bun:test'
import {
	missingPatches,
	parseDatafeedAbilities,
	parseDatafeedHeroes,
	parseDatafeedItems,
	parseDatafeedPatches,
} from '#src/jobs/catalog-datafeed'

describe('parseDatafeedPatches', () => {
	test('reads Valve patch_number + unix timestamp', () => {
		expect(
			parseDatafeedPatches({
				patches: [
					{
						patch_number: '7.41f',
						patch_name: '7.41f',
						patch_timestamp: 1789455600,
					},
					{ patch_number: 'bad' },
				],
				success: true,
			}),
		).toEqual([{ patch: '7.41f', released_at: new Date(1789455600 * 1000) }])
	})
})

describe('missingPatches', () => {
	test('returns names absent from the existing set', () => {
		expect(
			missingPatches(
				[
					{ patch: '7.41', released_at: new Date('2026-03-24T00:00:00Z') },
					{ patch: '7.41f', released_at: new Date('2026-09-15T07:00:00Z') },
				],
				new Set(['7.41']),
			),
		).toEqual(['7.41f'])
	})
})

describe('parseDatafeedHeroes', () => {
	test('maps numeric primary_attr and leaves attack_type / roles empty', () => {
		expect(
			parseDatafeedHeroes({
				result: {
					data: {
						heroes: [
							{
								id: 1,
								name: 'npc_dota_hero_antimage',
								name_loc: 'Anti-Mage',
								name_english_loc: 'Anti-Mage',
								primary_attr: 1,
								complexity: 1,
							},
							{ id: 0, name: 'npc_dota_hero_base' },
						],
					},
				},
			}),
		).toEqual([
			{
				hero_id: 1,
				name: 'npc_dota_hero_antimage',
				localized_name: 'Anti-Mage',
				primary_attr: 'agi',
				attack_type: null,
				roles: [],
			},
		])
	})
})

describe('parseDatafeedItems', () => {
	test('strips item_ prefix and does not invent cost', () => {
		expect(
			parseDatafeedItems({
				result: {
					data: {
						itemabilities: [
							{
								id: 1,
								name: 'item_blink',
								name_loc: 'Blink Dagger',
								name_english_loc: 'Blink Dagger',
								recipes: [],
							},
						],
					},
				},
			}),
		).toEqual([
			{
				item_id: 1,
				name: 'blink',
				localized_name: 'Blink Dagger',
				cost: null,
			},
		])
	})
})

describe('parseDatafeedAbilities', () => {
	test('classifies innate flag and talent names', () => {
		const rows = parseDatafeedAbilities({
			result: {
				data: {
					itemabilities: [
						{
							id: 5003,
							name: 'antimage_mana_break',
							name_loc: 'Mana Break',
							name_english_loc: 'Mana Break',
							is_innate: false,
						},
						{
							id: 1166,
							name: 'axe_one_man_army',
							name_loc: 'One Man Army',
							name_english_loc: 'One Man Army',
							is_innate: true,
						},
						{
							id: 6012,
							name: 'special_bonus_unique_antimage',
							name_loc: '-{s:bonus_AbilityCooldown}s Blink Cooldown',
							name_english_loc: '-{s:bonus_AbilityCooldown}s Blink Cooldown',
							is_innate: false,
						},
					],
				},
			},
		})
		expect(rows).toEqual([
			{
				ability_id: 5003,
				name: 'antimage_mana_break',
				localized_name: 'Mana Break',
				kind: 'spell',
			},
			{
				ability_id: 1166,
				name: 'axe_one_man_army',
				localized_name: 'One Man Army',
				kind: 'innate',
			},
			{
				ability_id: 6012,
				name: 'special_bonus_unique_antimage',
				localized_name: '-{s:bonus_AbilityCooldown}s Blink Cooldown',
				kind: 'talent',
			},
		])
	})
})
