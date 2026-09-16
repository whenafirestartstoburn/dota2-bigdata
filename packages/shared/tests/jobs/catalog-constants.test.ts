import { describe, expect, test } from 'bun:test'
import {
	buildAbilities,
	buildAbilityIds,
	buildHeroAbilities,
	buildHeroes,
	buildItems,
	buildRegions,
	listHeroNames,
	localizationTokens,
	mergeHeroScripts,
	mergeHeroTables,
	parseHeroBaseIncludes,
	parseJsonOrVdf,
} from '#src/jobs/catalog-constants'

const HEROES_VDF = `"DOTAHeroes"
{
	"Version"		"1"
	"npc_dota_hero_base"
	{
		"StatusHealth"		"200"
	}
	"npc_dota_hero_antimage"
	{
		"HeroID"		"1"
		"workshop_guide_name"		"Anti-Mage"
		"AttributePrimary"		"DOTA_ATTRIBUTE_AGILITY"
		"AttackCapabilities"		"DOTA_UNIT_CAP_MELEE_ATTACK"
		"Role"		"Carry,Escape"
		"Ability1"		"antimage_mana_break"
		"Ability2"		"antimage_blink"
		"Ability10"		"special_bonus_unique_antimage"
		"Ability11"		"special_bonus_strength_8"
		"AbilityTalentStart"		"10"
		"Facets"
		{
			"antimage_mana_thirst"
			{
				"Icon"		"Mana"
				"Color"		"Blue"
				"GradientID"		"0"
				"Deprecated"		"true"
			}
		}
	}
}
`

const LOC_VDF = `"lang"
{
	"Tokens"
	{
		"npc_dota_hero_antimage:n"		"Anti-Mage"
		"DOTA_Tooltip_ability_item_blink"		"Blink Dagger"
		"DOTA_Tooltip_ability_antimage_mana_break"		"Mana Break"
		"DOTA_Tooltip_ability_special_bonus_unique_antimage"		"{s:value} Blink Cooldown"
		"DOTA_Tooltip_facet_antimage_mana_thirst"		"Mana Thirst"
	}
}
`

const IDS_VDF = `"DOTAAbilityIDs"
{
	"UnitAbilities"
	{
		"Locked"
		{
			"antimage_mana_break"		"5001"
			"special_bonus_unique_antimage"		"6001"
		}
	}
	"ItemAbilities"
	{
		"Locked"
		{
			"item_blink"		"1"
		}
	}
}
`

const ITEMS_VDF = `"DOTAAbilities"
{
	"Version"		"1"
	"item_blink"
	{
		"ItemCost"		"2250"
	}
	"item_recipe_dummy"
	{
		"ItemCost"		"0"
	}
}
`

const NPC_ABILITIES_VDF = `"DOTAAbilities"
{
	"ability_base"
	{
		"ID"		"0"
	}
	"antimage_mana_break"
	{
		"AbilityValues"
		{
			"value"		"1"
		}
	}
}
`

const HERO_FILE_VDF = `"DOTAAbilities"
{
	"special_bonus_unique_antimage"
	{
		"AbilityValues"
		{
			"value"		"-1"
		}
	}
}
`

describe('parseJsonOrVdf', () => {
	test('parses JSON and Valve VDF', () => {
		expect(parseJsonOrVdf('{"ok":true}', 'mem://json')).toEqual({ ok: true })
		const parsed = parseJsonOrVdf(HEROES_VDF, 'mem://heroes')
		expect(listHeroNames(parsed)).toEqual(['npc_dota_hero_antimage'])
	})
})

describe('catalog builders', () => {
	const heroesVdf = parseJsonOrVdf(HEROES_VDF, 'mem://heroes')
	const loc = parseJsonOrVdf(LOC_VDF, 'mem://loc')
	const ids = parseJsonOrVdf(IDS_VDF, 'mem://ids')
	const items = parseJsonOrVdf(ITEMS_VDF, 'mem://items')
	const npc = parseJsonOrVdf(NPC_ABILITIES_VDF, 'mem://npc')
	const heroFile = parseJsonOrVdf(HERO_FILE_VDF, 'mem://hero')
	const tokens = localizationTokens(loc)

	test('buildHeroes maps VPK rows', () => {
		expect(buildHeroes(heroesVdf, loc)).toEqual({
			'1': {
				id: 1,
				name: 'npc_dota_hero_antimage',
				localized_name: 'Anti-Mage',
				primary_attr: 'agi',
				attack_type: 'Melee',
				roles: ['Carry', 'Escape'],
			},
		})
	})

	test('buildItems skips free recipes and strips item_ prefix', () => {
		expect(buildItems(items, ids, tokens)).toEqual({
			blink: { id: 1, dname: 'Blink Dagger', cost: 2250 },
		})
	})

	test('buildAbilityIds flips UnitAbilities locked map', () => {
		expect(buildAbilityIds(ids)).toEqual({
			'5001': 'antimage_mana_break',
			'6001': 'special_bonus_unique_antimage',
		})
	})

	test('buildAbilities merges hero files and fills talent dnames', () => {
		const scripts = mergeHeroScripts(npc, heroesVdf, [heroFile])
		const abilities = buildAbilities(scripts, tokens, heroesVdf)
		expect(abilities.antimage_mana_break).toEqual({ dname: 'Mana Break' })
		expect(abilities.special_bonus_unique_antimage).toEqual({
			dname: '-1 Blink Cooldown',
		})
		expect(abilities.ability_base).toBeUndefined()
	})

	test('parseHeroBaseIncludes reads #base hero files', () => {
		const names = parseHeroBaseIncludes(`
#base "heroes/npc_dota_hero_base.txt"
#base "heroes/npc_dota_hero_antimage.txt"
`)
		expect(names).toEqual(['npc_dota_hero_base', 'npc_dota_hero_antimage'])
		const merged = mergeHeroTables([heroesVdf])
		expect(listHeroNames(merged)).toEqual(['npc_dota_hero_antimage'])
	})

	test('mergeHeroScripts reads AbilityDefinitions on the hero', () => {
		const split = parseJsonOrVdf(
			`"DOTAHeroes"
{
	"npc_dota_hero_antimage"
	{
		"AbilityDefinitions"
		{
			"antimage_blink"
			{
				"AbilityValues"
				{
					"value"		"2"
				}
			}
		}
	}
}
`,
			'mem://defs',
		)
		const scripts = mergeHeroScripts(npc, split)
		expect(scripts.antimage_blink).toBeDefined()
	})

	test('buildRegions maps Valve display_name tokens', () => {
		const regions = parseJsonOrVdf(
			`"regions"
{
	"USWest"
	{
		"region"		"1"
		"display_name"		"#dota_region_us_west"
	}
}
`,
			'mem://regions',
		)
		expect(buildRegions(regions)).toEqual({ '1': 'US WEST' })
	})

	test('buildHeroAbilities splits skills, talents, and facets', () => {
		const kit = buildHeroAbilities(heroesVdf, tokens)
		expect(kit.npc_dota_hero_antimage).toEqual({
			abilities: ['antimage_mana_break', 'antimage_blink'],
			talents: [
				{ name: 'special_bonus_unique_antimage', level: 1 },
				{ name: 'special_bonus_strength_8', level: 1 },
			],
			facets: [
				{
					id: 0,
					name: 'antimage_mana_thirst',
					deprecated: 'true',
					icon: 'mana',
					color: 'Blue',
					title: 'Mana Thirst',
					abilities: undefined,
				},
			],
		})
	})
})
