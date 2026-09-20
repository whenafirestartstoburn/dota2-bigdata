/**
 * Official Valve website dictionaries (`www.dota2.com/datafeed`).
 * List endpoints only — no herodata / itemdata fan-out.
 */
import { classifyWebApiError, observeWebApi } from '#src/metrics/observe'
import { steamFetch } from '#src/steam/http'
import type {
	AbilityCatalog,
	HeroCatalog,
	ItemCatalog,
	PatchCatalog,
} from '#src/store/catalogs'
import { abilityKind } from '#src/store/catalogs'
import { asBool, asNumber, asRecord, asString } from '#src/store/coerce'

const DATAFEED = 'https://www.dota2.com/datafeed'
const FETCH_MS = 45_000
const LANGUAGE = 'english'

const PRIMARY_ATTR = ['str', 'agi', 'int', 'all'] as const

export function missingPatches(
	incoming: readonly PatchCatalog[],
	existing: ReadonlySet<string>,
): string[] {
	return incoming
		.filter((row) => !existing.has(row.patch))
		.map((row) => row.patch)
}

export function parseDatafeedPatches(raw: unknown): PatchCatalog[] {
	const root = asRecord(raw) ?? {}
	const rows = Array.isArray(root.patches) ? root.patches : []
	const out: PatchCatalog[] = []
	for (const value of rows) {
		const row = asRecord(value)
		const patch =
			asString(row?.patch_number) ??
			asString(row?.patch_name) ??
			asString(row?.patch)
		const ts = asNumber(row?.patch_timestamp)
		if (patch == null || ts == null) continue
		out.push({ patch, released_at: new Date(ts * 1000) })
	}
	return out
}

export function parseDatafeedHeroes(raw: unknown): HeroCatalog[] {
	const out: HeroCatalog[] = []
	for (const value of datafeedList(raw, 'heroes')) {
		const row = asRecord(value)
		const heroId = asNumber(row?.id)
		const name = asString(row?.name)
		if (row == null || heroId == null || heroId <= 0 || name == null) continue
		out.push({
			hero_id: heroId,
			name,
			localized_name:
				asString(row.name_english_loc) ?? asString(row.name_loc) ?? '',
			primary_attr: primaryAttr(row.primary_attr),
			attack_type: null,
			roles: [],
		})
	}
	return out
}

export function parseDatafeedItems(raw: unknown): ItemCatalog[] {
	const out: ItemCatalog[] = []
	for (const value of datafeedList(raw, 'itemabilities')) {
		const row = asRecord(value)
		const itemId = asNumber(row?.id)
		const rawName = asString(row?.name)
		if (row == null || itemId == null || itemId <= 0 || rawName == null) {
			continue
		}
		out.push({
			item_id: itemId,
			name: rawName.replace(/^item_/, ''),
			localized_name:
				asString(row.name_english_loc) ?? asString(row.name_loc) ?? '',
			cost: null,
		})
	}
	return out
}

export function parseDatafeedAbilities(raw: unknown): AbilityCatalog[] {
	const out: AbilityCatalog[] = []
	for (const value of datafeedList(raw, 'itemabilities')) {
		const row = asRecord(value)
		const abilityId = asNumber(row?.id)
		const name = asString(row?.name)
		if (row == null || abilityId == null || name == null) continue
		out.push({
			ability_id: abilityId,
			name,
			localized_name:
				asString(row.name_english_loc) ?? asString(row.name_loc) ?? '',
			kind: asBool(row.is_innate) === true ? 'innate' : abilityKind(name),
		})
	}
	return out
}

export async function fetchDatafeedJson(
	path: 'patchnoteslist' | 'herolist' | 'itemlist' | 'abilitylist',
): Promise<unknown> {
	const url = new URL(`${DATAFEED}/${path}`)
	url.searchParams.set('language', LANGUAGE)
	const started = performance.now()
	try {
		const response = await steamFetch(url, {
			signal: AbortSignal.timeout(FETCH_MS),
		})
		if (!response.ok) {
			throw new Error(`datafeed HTTP ${response.status} ${url.href}`)
		}
		const body: unknown = await response.json()
		observeWebApi('dota2', path, 'success', started)
		return body
	} catch (error) {
		observeWebApi('dota2', path, classifyWebApiError(error), started)
		throw error
	}
}

function datafeedList(raw: unknown, key: string): unknown[] {
	const root = asRecord(raw) ?? {}
	const top = root[key]
	if (Array.isArray(top)) return top
	const result = asRecord(root.result)
	const data = asRecord(result?.data) ?? asRecord(root.data)
	const nested = data?.[key]
	return Array.isArray(nested) ? nested : []
}

function primaryAttr(value: unknown): string | null {
	const n = asNumber(value)
	if (n === 0 || n === 1 || n === 2 || n === 3) return PRIMARY_ATTR[n]
	return asString(value)
}
