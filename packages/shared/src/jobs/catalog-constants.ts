/**
 * Catalog snapshot from Valve VPK dumps (dotabuff/d2vpkr), same sources as
 * odota/dotaconstants `tasks/updateconstants.ts`. Manual tables (patch,
 * modes, buffs, XP) come from that repo's `json/`. Regions are built from
 * VPK `scripts/regions.txt`. Cluster is the leftover `build/cluster.json`.
 */
import { parse as parseVdf } from 'vdf-parser'
import type { CatalogRaw } from '#src/store/catalogs'
import { asNumber, asRecord, asString } from '#src/store/coerce'

const D2VPKR = 'https://raw.githubusercontent.com/dotabuff/d2vpkr/master/dota'
const ODOTA_JSON =
	'https://raw.githubusercontent.com/odota/dotaconstants/master/json'
const FETCH_MS = 45_000
const HERO_FILE_BATCH = 20

const BAD_HERO_NAMES = new Set([
	'Version',
	'npc_dota_hero_base',
	'npc_dota_hero_target_dummy',
])

const NOT_ABILITIES = new Set([
	'Version',
	'version',
	'ability_base',
	'default_attack',
	'attribute_bonus',
	'ability_deward',
])

const MANUAL_JSON = [
	'patch',
	'game_mode',
	'lobby_type',
	'permanent_buffs',
	'xp_level',
] as const

export async function fetchCatalogRaw(): Promise<CatalogRaw> {
	const heroesIndexUrl = `${D2VPKR}/scripts/npc/npc_heroes.txt`
	const heroesIndex = await fetchText(heroesIndexUrl)
	const includeNames = parseHeroBaseIncludes(heroesIndex)
	const [
		localization,
		abilityIds,
		abilityLoc,
		npcAbilities,
		items,
		regionsVdf,
		heroFiles,
	] = await Promise.all([
		fetchParsed(`${D2VPKR}/resource/localization/dota_english.txt`),
		fetchParsed(`${D2VPKR}/scripts/npc/npc_ability_ids.txt`),
		fetchParsed(`${D2VPKR}/resource/localization/abilities_english.txt`),
		fetchParsed(`${D2VPKR}/scripts/npc/npc_abilities.txt`),
		fetchParsed(`${D2VPKR}/scripts/npc/items.txt`),
		fetchParsed(`${D2VPKR}/scripts/regions.txt`),
		includeNames.length > 0
			? mapPool(includeNames, HERO_FILE_BATCH, (name) =>
					fetchParsed(`${D2VPKR}/scripts/npc/heroes/${name}.txt`),
				)
			: Promise.resolve([]),
	])

	const heroesVdf =
		includeNames.length > 0
			? mergeHeroTables(heroFiles)
			: parseJsonOrVdf(heroesIndex, heroesIndexUrl)

	const manuals = await Promise.all([
		...MANUAL_JSON.map((name) => fetchJson(`${ODOTA_JSON}/${name}.json`)),
		fetchJson(
			'https://raw.githubusercontent.com/odota/dotaconstants/master/build/cluster.json',
		),
	])

	const tokens = localizationTokens(abilityLoc)
	const scripts = mergeHeroScripts(npcAbilities, heroesVdf, heroFiles)
	return {
		heroes: buildHeroes(heroesVdf, localization),
		items: buildItems(items, abilityIds, tokens),
		abilities: buildAbilities(scripts, tokens, heroesVdf),
		ability_ids: buildAbilityIds(abilityIds),
		hero_abilities: buildHeroAbilities(heroesVdf, tokens),
		patch: manuals[0],
		game_mode: manuals[1],
		lobby_type: manuals[2],
		permanent_buffs: manuals[3],
		xp_level: manuals[4],
		cluster: manuals[5],
		region: buildRegions(regionsVdf),
	}
}

export function parseJsonOrVdf(text: string, url: string): unknown {
	try {
		return JSON.parse(text)
	} catch {
		try {
			return parseVdf(fixValveVdf(text), { types: false, arrayify: true })
		} catch (error) {
			throw new Error(
				`Couldn't parse JSON or VDF ${url}: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}
}

export function parseHeroBaseIncludes(text: string): string[] {
	const out: string[] = []
	for (const line of text.split(/\r?\n/)) {
		const match = line.match(/^#base\s+"heroes\/(npc_dota_hero_[^"]+)\.txt"/)
		const name = match?.[1]
		if (name != null) out.push(name)
	}
	return out
}

export function listHeroNames(heroesVdf: unknown): string[] {
	const heroes = asRecord(asRecord(heroesVdf)?.DOTAHeroes)
	if (heroes == null) return []
	return Object.keys(heroes).filter((name) => !BAD_HERO_NAMES.has(name))
}

export function mergeHeroTables(heroFiles: readonly unknown[]): {
	DOTAHeroes: Record<string, unknown>
} {
	const heroes: Record<string, unknown> = {}
	for (const file of heroFiles) {
		const bag = asRecord(asRecord(file)?.DOTAHeroes)
		if (bag == null) continue
		Object.assign(heroes, bag)
	}
	return { DOTAHeroes: heroes }
}

export function buildHeroes(
	heroesVdf: unknown,
	localization: unknown,
): Record<string, unknown> {
	const heroes = asRecord(asRecord(heroesVdf)?.DOTAHeroes)
	const tokens = localizationTokens(localization)
	if (heroes == null) return {}
	const out: Record<string, unknown> = {}
	for (const name of listHeroNames(heroesVdf)) {
		const row = asRecord(heroes[name])
		const id = asNumber(row?.HeroID)
		if (row == null || id == null || id <= 0) continue
		const localized =
			asString(row.workshop_guide_name) ?? token(tokens, `${name}:n`) ?? name
		out[String(id)] = {
			id,
			name,
			localized_name: localized,
			primary_attr: primaryAttr(asString(row.AttributePrimary)),
			attack_type:
				asString(row.AttackCapabilities) === 'DOTA_UNIT_CAP_MELEE_ATTACK'
					? 'Melee'
					: 'Ranged',
			roles: (asString(row.Role) ?? '')
				.split(',')
				.map((role) => role.trim())
				.filter((role) => role !== ''),
		}
	}
	return out
}

export function buildItems(
	itemsVdf: unknown,
	abilityIds: unknown,
	tokens: Record<string, string>,
): Record<string, unknown> {
	const scripts = asRecord(asRecord(itemsVdf)?.DOTAAbilities)
	const idLookup = asRecord(
		asRecord(asRecord(abilityIds)?.DOTAAbilityIDs)?.ItemAbilities,
	)
	const locked = asRecord(idLookup?.Locked) ?? {}
	if (scripts == null) return {}
	const out: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(scripts)) {
		const row = asRecord(value)
		if (row == null || key === 'Version') continue
		if (key.includes('item_recipe') && asString(row.ItemCost) === '0') continue
		const id = asNumber(locked[key])
		if (id == null || id <= 0) continue
		const short = key.replace(/^item_/, '')
		out[short] = {
			id,
			dname:
				token(tokens, `DOTA_Tooltip_ability_${key}`) ??
				token(tokens, `DOTA_Tooltip_ability_${key}:n`) ??
				'',
			cost: asNumber(row.ItemCost),
		}
	}
	return out
}

export function buildAbilityIds(abilityIds: unknown): Record<string, string> {
	const locked = asRecord(
		asRecord(asRecord(asRecord(abilityIds)?.DOTAAbilityIDs)?.UnitAbilities)
			?.Locked,
	)
	const out: Record<string, string> = {}
	if (locked == null) return out
	for (const [name, idRaw] of Object.entries(locked)) {
		const id = asNumber(idRaw)
		if (id == null || name === '') continue
		out[String(id)] = name
	}
	return out
}

export function buildAbilities(
	scripts: Record<string, unknown>,
	tokens: Record<string, string>,
	heroesVdf: unknown,
): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(scripts)) {
		if (NOT_ABILITIES.has(key)) continue
		const row = asRecord(value)
		if (row == null) continue
		const dname =
			replaceSValues(
				token(tokens, `DOTA_Tooltip_ability_${key}`) ??
					token(tokens, `DOTA_Tooltip_Ability_${key}`),
				row,
			) ?? ''
		out[key] = { dname }
	}
	for (const talent of referencedHeroTalents(heroesVdf)) {
		if (out[talent] != null) continue
		const dname =
			token(tokens, `DOTA_Tooltip_ability_${talent}`) ??
			token(tokens, `DOTA_Tooltip_Ability_${talent}`)
		if (dname != null) out[talent] = { dname }
	}
	for (const [key, value] of Object.entries(tokens)) {
		if (
			!key.startsWith('dota_tooltip_ability_special_bonus_unique') ||
			key.endsWith('description')
		) {
			continue
		}
		const name = key.slice('dota_tooltip_ability_'.length)
		if (out[name] == null) out[name] = { dname: value }
	}
	return out
}

export function buildRegions(regionsVdf: unknown): Record<string, string> {
	const regions = asRecord(asRecord(regionsVdf)?.regions)
	const out: Record<string, string> = {}
	if (regions == null) return out
	for (const value of Object.values(regions)) {
		const row = asRecord(value)
		const id = asNumber(row?.region)
		const display = asString(row?.display_name)
		if (id == null || id <= 0 || display == null) continue
		out[String(id)] = display.startsWith('#dota_region_')
			? display
					.slice('#dota_region_'.length)
					.split('_')
					.map((part) => part.toUpperCase())
					.join(' ')
			: display
	}
	return out
}

export function buildHeroAbilities(
	heroesVdf: unknown,
	tokens: Record<string, string>,
): Record<string, unknown> {
	const heroes = asRecord(asRecord(heroesVdf)?.DOTAHeroes)
	if (heroes == null) return {}
	const out: Record<string, unknown> = {}
	for (const name of listHeroNames(heroesVdf)) {
		const hero = asRecord(heroes[name])
		if (hero == null) continue
		const abilities: string[] = []
		const talents: Array<{ name: string; level: number }> = []
		const talentStart = asNumber(hero.AbilityTalentStart) ?? 10
		let talentCounter = 2
		for (const [key, value] of Object.entries(hero)) {
			const match = key.match(/^Ability([0-9]+)$/)
			const abilityName = asString(value)
			if (match == null || abilityName == null || abilityName === '') continue
			const num = Number(match[1])
			if (num < talentStart) abilities.push(abilityName)
			else {
				talents.push({
					name: abilityName,
					level: Math.floor(talentCounter / 2),
				})
				talentCounter += 1
			}
		}
		const facets: unknown[] = []
		const facetBag = asRecord(hero.Facets) ?? {}
		let facetId = 0
		for (const [facetKey, facetRaw] of Object.entries(facetBag)) {
			const facet = asRecord(facetRaw)
			if (facet == null) continue
			const abilityNames = Object.values(asRecord(facet.Abilities) ?? {})
				.map((entry) => asString(asRecord(entry)?.AbilityName))
				.filter((item): item is string => item != null)
			const title =
				token(tokens, `dota_tooltip_facet_${facetKey}`) ??
				(abilityNames[0] != null
					? token(tokens, `dota_tooltip_ability_${abilityNames[0]}`)
					: null) ??
				''
			facets.push({
				id: facetId,
				name: facetKey,
				deprecated: facet.Deprecated,
				icon: asString(facet.Icon)?.toLowerCase() ?? null,
				color: asString(facet.Color) ?? null,
				title,
				abilities: abilityNames.length > 0 ? abilityNames : undefined,
			})
			facetId += 1
		}
		out[name] = { abilities, talents, facets }
	}
	return out
}

export function mergeHeroScripts(
	npcAbilities: unknown,
	heroesVdf: unknown,
	heroFiles: readonly unknown[] = [],
): Record<string, unknown> {
	const scripts = { ...(asRecord(asRecord(npcAbilities)?.DOTAAbilities) ?? {}) }
	for (const file of heroFiles) {
		const extra = asRecord(asRecord(file)?.DOTAAbilities)
		if (extra != null) Object.assign(scripts, extra)
	}
	const heroes = asRecord(asRecord(heroesVdf)?.DOTAHeroes)
	if (heroes != null) {
		for (const hero of Object.values(heroes)) {
			const defs = asRecord(asRecord(hero)?.AbilityDefinitions)
			if (defs != null) Object.assign(scripts, defs)
		}
	}
	return scripts
}

export function localizationTokens(raw: unknown): Record<string, string> {
	const tokens = asRecord(asRecord(raw)?.lang)?.Tokens
	const rec = asRecord(tokens)
	const out: Record<string, string> = {}
	if (rec == null) return out
	for (const [key, value] of Object.entries(rec)) {
		const text = asString(value)
		if (text == null) continue
		out[key] = text
		out[key.toLowerCase()] = text
	}
	return out
}

function token(
	tokens: Record<string, string>,
	key: string,
): string | undefined {
	return tokens[key] ?? tokens[key.toLowerCase()]
}

function primaryAttr(value: string | null): string | null {
	if (value == null) return null
	return value.replace('DOTA_ATTRIBUTE_', '').slice(0, 3).toLowerCase()
}

function referencedHeroTalents(heroesVdf: unknown): string[] {
	const heroes = asRecord(asRecord(heroesVdf)?.DOTAHeroes)
	if (heroes == null) return []
	const talents = new Set<string>()
	for (const hero of Object.values(heroes)) {
		const row = asRecord(hero)
		if (row == null) continue
		const start = asNumber(row.AbilityTalentStart) ?? 10
		for (const [key, value] of Object.entries(row)) {
			const match = key.match(/^Ability(\d+)$/)
			const name = asString(value)
			if (
				match == null ||
				name == null ||
				Number(match[1]) < start ||
				!name.startsWith('special_bonus')
			) {
				continue
			}
			talents.add(name)
		}
	}
	return [...talents]
}

function replaceSValues(
	template: string | undefined,
	ability: Record<string, unknown>,
): string | undefined {
	if (template == null) return template
	const values = asRecord(ability.AbilityValues)
	if (values == null) return template
	return template.replace(/\{s:([^}]+)\}/g, (all, key: string) => {
		const raw = values[key]
		if (raw == null) return all
		if (typeof raw === 'string' || typeof raw === 'number') return String(raw)
		const rec = asRecord(raw)
		const value = rec?.value
		return typeof value === 'string' || typeof value === 'number'
			? String(value)
			: all
	})
}

function fixValveVdf(text: string): string {
	return text
		.replaceAll(
			`\t\t"ItemRequirements"\r\n\t\t""`,
			`\t\t"ItemRequirements"\t\t""`,
		)
		.replaceAll(
			`\t\t\t"has_flying_movement"\t\r\n\t\t\t""`,
			`\t\t\t"has_flying_movement"\t\t""`,
		)
		.replaceAll(
			`\t\t\t"damage_reduction"\t\r\n\t\t\t""`,
			`\t\t\t"damage_reduction"\t\t""`,
		)
		.replaceAll(`\t"default_attack"\r\n\t""`, `\t"default_attack"\t\t""`)
		.replaceAll(`\t\t"AbilityValues"\r\n\t\t""`, `\t\t"AbilityValues"\t\t""`)
		.replaceAll(
			`\t\t\t\t"spill_movement_slow_pct"\r\n\t\t\t\t""`,
			`\t\t\t\t"default_attack"\r\n\t\t\t\t{}`,
		)
}

async function fetchParsed(url: string): Promise<unknown> {
	const text = await fetchText(url)
	return parseJsonOrVdf(text, url)
}

async function fetchJson(url: string): Promise<unknown> {
	const text = await fetchText(url)
	return JSON.parse(text)
}

async function fetchText(url: string): Promise<string> {
	const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_MS) })
	if (!response.ok) throw new Error(`catalog HTTP ${response.status} ${url}`)
	return response.text()
}

async function mapPool<T, R>(
	items: readonly T[],
	size: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> {
	const out: R[] = []
	for (let offset = 0; offset < items.length; offset += size) {
		const chunk = items.slice(offset, offset + size)
		out.push(...(await Promise.all(chunk.map(fn))))
	}
	return out
}
