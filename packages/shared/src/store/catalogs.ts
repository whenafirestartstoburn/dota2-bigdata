import { asBool, asNumber, asRecord, asString, asText } from '#src/store/coerce'
import { db, sql, sqlIn, sqlValues } from '#src/utils/db'

export type AbilityKind = 'spell' | 'talent' | 'innate' | 'item' | 'other'

export type HeroCatalog = {
	hero_id: number
	name: string
	localized_name: string
	primary_attr: string | null
	attack_type: string | null
	roles: string[]
}

export type ItemCatalog = {
	item_id: number
	name: string
	localized_name: string
	cost: number | null
}

export type AbilityCatalog = {
	ability_id: number
	name: string
	localized_name: string
	kind: AbilityKind
}

export type HeroAbilityCatalog = {
	hero_id: number
	ability_id: number
	slot: number
	is_talent: boolean
	talent_level: number | null
}

export type HeroFacetCatalog = {
	hero_id: number
	facet_id: number
	name: string
	localized_name: string
	icon: string | null
	color: string | null
	deprecated: boolean
}

export type PatchCatalog = {
	patch: string
	released_at: Date
}

export type NamedIdCatalog = {
	id: number
	name: string
	balanced: boolean | null
}

export type RegionCatalog = {
	region: number
	name: string
}

export type ClusterCatalog = {
	cluster: number
	region: number | null
}

export type BuffCatalog = {
	buff_id: number
	name: string
}

export type XpLevelCatalog = {
	level: number
	xp: number
}

export type CatalogSnapshot = {
	heroes: HeroCatalog[]
	items: ItemCatalog[]
	abilities: AbilityCatalog[]
	heroAbilities: HeroAbilityCatalog[]
	heroFacets: HeroFacetCatalog[]
	patches: PatchCatalog[]
	gameModes: NamedIdCatalog[]
	lobbyTypes: NamedIdCatalog[]
	regions: RegionCatalog[]
	clusters: ClusterCatalog[]
	permanentBuffs: BuffCatalog[]
	xpLevels: XpLevelCatalog[]
}

export type CatalogRaw = {
	heroes: unknown
	items: unknown
	abilities: unknown
	ability_ids: unknown
	hero_abilities: unknown
	patch: unknown
	game_mode: unknown
	lobby_type: unknown
	region: unknown
	cluster: unknown
	permanent_buffs: unknown
	xp_level: unknown
}

const CHUNK = 300

export function abilityKind(name: string): AbilityKind {
	if (
		name === '' ||
		name === 'generic_hidden' ||
		name === 'dota_base_ability'
	) {
		return 'other'
	}
	if (name.startsWith('special_bonus_')) return 'talent'
	if (name.startsWith('item_')) return 'item'
	if (name.includes('_innate')) return 'innate'
	return 'spell'
}

function objectEntries(value: unknown): Array<[string, unknown]> {
	const rec = asRecord(value)
	if (rec == null) return []
	return Object.entries(rec)
}

function textList(value: unknown): string[] {
	if (!Array.isArray(value)) return []
	const out: string[] = []
	for (const item of value) {
		const text = asString(item)
		if (text != null) out.push(text)
	}
	return out
}

export function parseHeroes(raw: unknown): HeroCatalog[] {
	const out: HeroCatalog[] = []
	for (const [, value] of objectEntries(raw)) {
		const row = asRecord(value)
		const heroId = asNumber(row?.id)
		const name = asString(row?.name)
		if (heroId == null || heroId <= 0 || name == null) continue
		out.push({
			hero_id: heroId,
			name,
			localized_name: asString(row?.localized_name) ?? '',
			primary_attr: asString(row?.primary_attr),
			attack_type: asString(row?.attack_type),
			roles: textList(row?.roles),
		})
	}
	return out
}

export function parseItems(raw: unknown): ItemCatalog[] {
	const out: ItemCatalog[] = []
	for (const [name, value] of objectEntries(raw)) {
		const row = asRecord(value)
		const itemId = asNumber(row?.id)
		if (itemId == null || itemId <= 0) continue
		out.push({
			item_id: itemId,
			name,
			localized_name:
				asString(row?.dname) ?? asString(row?.localized_name) ?? '',
			cost: asNumber(row?.cost),
		})
	}
	return out
}

export function parseAbilities(
	abilityIds: unknown,
	abilities: unknown,
): AbilityCatalog[] {
	const details = asRecord(abilities) ?? {}
	const out: AbilityCatalog[] = []
	for (const [idKey, nameRaw] of objectEntries(abilityIds)) {
		const abilityId = asNumber(idKey)
		const name = asString(nameRaw)
		if (abilityId == null || name == null) continue
		const info = asRecord(details[name])
		out.push({
			ability_id: abilityId,
			name,
			localized_name: asString(info?.dname) ?? '',
			kind: abilityKind(name),
		})
	}
	return out
}

function parseNamedIds(raw: unknown): NamedIdCatalog[] {
	const out: NamedIdCatalog[] = []
	for (const [key, value] of objectEntries(raw)) {
		const row = asRecord(value)
		const id = asNumber(row?.id) ?? asNumber(key)
		const name = asString(row?.name) ?? asString(value)
		if (id == null || name == null) continue
		out.push({
			id,
			name,
			balanced: asBool(row?.balanced),
		})
	}
	return out
}

export function parsePatches(raw: unknown): PatchCatalog[] {
	const rows = Array.isArray(raw) ? raw : objectEntries(raw).map(([, v]) => v)
	const out: PatchCatalog[] = []
	for (const value of rows) {
		const row = asRecord(value)
		const patch = asString(row?.name) ?? asString(row?.patch)
		const released = asString(row?.date) ?? asString(row?.released_at)
		if (patch == null || released == null) continue
		const at = new Date(released)
		if (Number.isNaN(at.getTime())) continue
		out.push({ patch, released_at: at })
	}
	return out
}

export function parseRegions(raw: unknown): RegionCatalog[] {
	const out: RegionCatalog[] = []
	for (const [key, value] of objectEntries(raw)) {
		const region = asNumber(key)
		const name = asString(value) ?? asString(asRecord(value)?.name)
		if (region == null || name == null) continue
		out.push({ region, name })
	}
	return out
}

export function parseClusters(raw: unknown): ClusterCatalog[] {
	const out: ClusterCatalog[] = []
	for (const [key, value] of objectEntries(raw)) {
		const cluster = asNumber(key)
		if (cluster == null) continue
		const rec = asRecord(value)
		out.push({
			cluster,
			region: asNumber(value) ?? asNumber(rec?.region),
		})
	}
	return out
}

export function parsePermanentBuffs(raw: unknown): BuffCatalog[] {
	const out: BuffCatalog[] = []
	for (const [key, value] of objectEntries(raw)) {
		const buffId = asNumber(key)
		const name = asString(value) ?? asString(asRecord(value)?.name)
		if (buffId == null || buffId <= 0 || name == null) continue
		out.push({ buff_id: buffId, name })
	}
	return out
}

export function parseXpLevels(raw: unknown): XpLevelCatalog[] {
	if (!Array.isArray(raw)) return []
	const out: XpLevelCatalog[] = []
	for (const [index, value] of raw.entries()) {
		const xp = asNumber(value)
		if (xp == null) continue
		out.push({ level: index + 1, xp })
	}
	return out
}

export function parseHeroKit(
	raw: unknown,
	heroes: readonly HeroCatalog[],
	abilities: readonly AbilityCatalog[],
): { heroAbilities: HeroAbilityCatalog[]; heroFacets: HeroFacetCatalog[] } {
	const heroByName = new Map(heroes.map((row) => [row.name, row.hero_id]))
	const abilityByName = new Map(
		abilities.map((row) => [row.name, row.ability_id]),
	)
	const heroAbilities: HeroAbilityCatalog[] = []
	const heroFacets: HeroFacetCatalog[] = []

	for (const [heroName, value] of objectEntries(raw)) {
		const heroId = heroByName.get(heroName)
		const kit = asRecord(value)
		if (heroId == null || kit == null) continue

		const abilityNames = Array.isArray(kit.abilities) ? kit.abilities : []
		for (const [slot, nameRaw] of abilityNames.entries()) {
			const name = asString(nameRaw)
			if (name == null) continue
			const abilityId = abilityByName.get(name)
			if (abilityId == null) continue
			heroAbilities.push({
				hero_id: heroId,
				ability_id: abilityId,
				slot,
				is_talent: false,
				talent_level: null,
			})
		}

		const talents = Array.isArray(kit.talents) ? kit.talents : []
		for (const [slot, talentRaw] of talents.entries()) {
			const talent = asRecord(talentRaw)
			const name = asString(talent?.name) ?? asString(talentRaw)
			if (name == null) continue
			const abilityId = abilityByName.get(name)
			if (abilityId == null) continue
			heroAbilities.push({
				hero_id: heroId,
				ability_id: abilityId,
				slot,
				is_talent: true,
				talent_level: asNumber(talent?.level),
			})
		}

		const facets = Array.isArray(kit.facets) ? kit.facets : []
		for (const facetRaw of facets) {
			const facet = asRecord(facetRaw)
			const facetId = asNumber(facet?.id)
			const name = asString(facet?.name)
			if (facetId == null || name == null) continue
			const deprecated =
				facet?.deprecated === true || facet?.deprecated === 'true'
			heroFacets.push({
				hero_id: heroId,
				facet_id: facetId,
				name,
				localized_name: asString(facet?.title) ?? '',
				icon: asText(facet?.icon),
				color: asText(facet?.color),
				deprecated,
			})
		}
	}

	return { heroAbilities, heroFacets }
}

export function parseCatalogs(raw: CatalogRaw): CatalogSnapshot {
	const heroes = parseHeroes(raw.heroes)
	const items = parseItems(raw.items)
	const abilities = parseAbilities(raw.ability_ids, raw.abilities)
	const { heroAbilities, heroFacets } = parseHeroKit(
		raw.hero_abilities,
		heroes,
		abilities,
	)
	return {
		heroes,
		items,
		abilities,
		heroAbilities,
		heroFacets,
		patches: parsePatches(raw.patch),
		gameModes: parseNamedIds(raw.game_mode),
		lobbyTypes: parseNamedIds(raw.lobby_type),
		regions: parseRegions(raw.region),
		clusters: parseClusters(raw.cluster),
		permanentBuffs: parsePermanentBuffs(raw.permanent_buffs),
		xpLevels: parseXpLevels(raw.xp_level),
	}
}

async function upsertChunks(
	rows: ReadonlyArray<Record<string, unknown>>,
	insert: (chunk: Array<Record<string, unknown>>) => Promise<void>,
): Promise<void> {
	for (let offset = 0; offset < rows.length; offset += CHUNK) {
		await insert(rows.slice(offset, offset + CHUNK))
	}
}

export async function persistCatalogs(
	snapshot: CatalogSnapshot,
): Promise<void> {
	if (snapshot.heroes.length === 0) {
		throw new Error('catalog snapshot has no heroes')
	}

	await db.transaction(async (tx) => {
		await upsertChunks(snapshot.heroes, async (chunk) => {
			await tx.execute(sql`
				INSERT INTO heroes ${sqlValues(chunk)}
				ON CONFLICT (hero_id) DO UPDATE SET
					name = excluded.name,
					localized_name = excluded.localized_name,
					primary_attr = excluded.primary_attr,
					attack_type = excluded.attack_type,
					roles = excluded.roles,
					updated_at = now()
			`)
		})

		await upsertChunks(snapshot.items, async (chunk) => {
			await tx.execute(sql`
				INSERT INTO items ${sqlValues(chunk)}
				ON CONFLICT (item_id) DO UPDATE SET
					name = excluded.name,
					localized_name = excluded.localized_name,
					cost = excluded.cost,
					updated_at = now()
			`)
		})

		await upsertChunks(snapshot.abilities, async (chunk) => {
			await tx.execute(sql`
				INSERT INTO abilities ${sqlValues(chunk)}
				ON CONFLICT (ability_id) DO UPDATE SET
					name = excluded.name,
					localized_name = excluded.localized_name,
					kind = excluded.kind,
					updated_at = now()
			`)
		})

		await upsertChunks(snapshot.patches, async (chunk) => {
			await tx.execute(sql`
				INSERT INTO patches ${sqlValues(chunk)}
				ON CONFLICT (patch) DO UPDATE SET
					released_at = excluded.released_at,
					updated_at = now()
			`)
		})

		await upsertChunks(
			snapshot.gameModes.map((row) => ({
				game_mode: row.id,
				name: row.name,
				balanced: row.balanced,
			})),
			async (chunk) => {
				await tx.execute(sql`
					INSERT INTO game_modes ${sqlValues(chunk)}
					ON CONFLICT (game_mode) DO UPDATE SET
						name = excluded.name,
						balanced = excluded.balanced,
						updated_at = now()
				`)
			},
		)

		await upsertChunks(
			snapshot.lobbyTypes.map((row) => ({
				lobby_type: row.id,
				name: row.name,
				balanced: row.balanced,
			})),
			async (chunk) => {
				await tx.execute(sql`
					INSERT INTO lobby_types ${sqlValues(chunk)}
					ON CONFLICT (lobby_type) DO UPDATE SET
						name = excluded.name,
						balanced = excluded.balanced,
						updated_at = now()
				`)
			},
		)

		await upsertChunks(snapshot.regions, async (chunk) => {
			await tx.execute(sql`
				INSERT INTO regions ${sqlValues(chunk)}
				ON CONFLICT (region) DO UPDATE SET
					name = excluded.name,
					updated_at = now()
			`)
		})

		await upsertChunks(snapshot.clusters, async (chunk) => {
			await tx.execute(sql`
				INSERT INTO clusters ${sqlValues(chunk)}
				ON CONFLICT (cluster) DO UPDATE SET
					region = excluded.region,
					updated_at = now()
			`)
		})

		await upsertChunks(snapshot.permanentBuffs, async (chunk) => {
			await tx.execute(sql`
				INSERT INTO permanent_buffs ${sqlValues(chunk)}
				ON CONFLICT (buff_id) DO UPDATE SET
					name = excluded.name,
					updated_at = now()
			`)
		})

		await upsertChunks(snapshot.xpLevels, async (chunk) => {
			await tx.execute(sql`
				INSERT INTO xp_levels ${sqlValues(chunk)}
				ON CONFLICT (level) DO UPDATE SET
					xp = excluded.xp,
					updated_at = now()
			`)
		})

		const mappedHeroIds = [
			...new Set([
				...snapshot.heroes.map((row) => row.hero_id),
				...snapshot.heroAbilities.map((row) => row.hero_id),
				...snapshot.heroFacets.map((row) => row.hero_id),
			]),
		]
		if (mappedHeroIds.length > 0) {
			await tx.execute(
				sql`DELETE FROM hero_abilities WHERE hero_id IN ${sqlIn(mappedHeroIds)}`,
			)
			await tx.execute(
				sql`DELETE FROM hero_facets WHERE hero_id IN ${sqlIn(mappedHeroIds)}`,
			)
		}
		await upsertChunks(snapshot.heroAbilities, async (chunk) => {
			await tx.execute(sql`INSERT INTO hero_abilities ${sqlValues(chunk)}`)
		})
		await upsertChunks(snapshot.heroFacets, async (chunk) => {
			await tx.execute(sql`INSERT INTO hero_facets ${sqlValues(chunk)}`)
		})
	})
}

export async function countHeroes(): Promise<number> {
	const rows = await db.execute(sql`SELECT count(*)::int AS n FROM heroes`)
	const n = rows[0]?.n
	return typeof n === 'number' ? n : Number(n ?? 0)
}
