import {
	asBool,
	asComplete,
	asIntArray,
	asItemId,
	asNumber,
	asPgInt8,
	asString,
} from '#src/store/coerce'

/** Valve `player_slot`: 0–4 radiant, 128–132 dire. */
export function valvePlayerSlot(team: 0 | 1, teamSlot: number): number {
	return team === 0 ? teamSlot : 128 + teamSlot
}

/** Accept Valve slots or linear 0–9 (5–9 → dire). Reject 133+ / negative. */
export function normalizeValvePlayerSlot(slot: number): number | null {
	if (slot >= 0 && slot <= 4) return slot
	if (slot >= 128 && slot <= 132) return slot
	if (slot >= 5 && slot <= 9) return 128 + (slot - 5)
	return null
}

export type MatchFacts = {
	matchId: number
	matchSeqNum: number | null
	leagueId: number | null
	startTime: number | null
	duration: number | null
	preGameDuration: number | null
	radiantWin: boolean | null
	radiantScore: number | null
	direScore: number | null
	towerStatusRadiant: number | null
	towerStatusDire: number | null
	barracksStatusRadiant: number | null
	barracksStatusDire: number | null
	firstBloodTime: number | null
	lobbyType: number | null
	lobbyId: number | null
	gameMode: number | null
	engine: number | null
	humanPlayers: number | null
	cluster: number | null
	replaySalt: number | null
	seriesId: number | null
	seriesType: number | null
	radiantTeamId: number | null
	direTeamId: number | null
	radiantTeamName: string | null
	direTeamName: string | null
	radiantTeamComplete: number | null
	direTeamComplete: number | null
	radiantCaptain: number | null
	direCaptain: number | null
	positiveVotes: number | null
	negativeVotes: number | null
	matchFlags: number | null
	matchOutcome: number | null
	gameBalance: number | null
	radiantTeamLogo: number | null
	direTeamLogo: number | null
	radiantTeamLogoUrl: string | null
	direTeamLogoUrl: string | null
	radiantTeamTag: string | null
	direTeamTag: string | null
	radiantGuildId: number | null
	direGuildId: number | null
	tournamentId: number | null
	tournamentRound: number | null
	leagueSeriesId: number | null
	leagueGameId: number | null
	gameNumber: number | null
	stageName: string | null
	leagueTier: number | null
	coaches: CoachFacts[]
	broadcasters: BroadcasterFacts[]
}

export type CoachFacts = {
	accountId: number
	coachName: string | null
	coachRating: number | null
	coachTeam: number | null
	coachPartyId: number | null
	isPrivateCoach: boolean | null
}

export type BroadcasterFacts = {
	seq: number
	countryCode: string | null
	description: string | null
	languageCode: string | null
	accountId: number | null
	name: string | null
}

export type AbilityUpgradeFacts = {
	seq: number
	abilityId: number
	time: number | null
	level: number | null
}

export type DamageBreakdownFacts = {
	direction: 'received' | 'dealt'
	damageType: number
	preReduction: number | null
	postReduction: number | null
}

export type PlayerFacts = {
	accountId: number
	playerSlot: number
	heroId: number
	heroVariant: number | null
	playerName: string | null
	proName: string | null
	realName: string | null
	teamNumber: number | null
	teamSlot: number | null
	side: 'radiant' | 'dire'
	kills: number | null
	deaths: number | null
	assists: number | null
	lastHits: number | null
	denies: number | null
	gold: number | null
	goldSpent: number | null
	goldPerMin: number | null
	xpPerMin: number | null
	netWorth: number | null
	level: number | null
	heroDamage: number | null
	towerDamage: number | null
	heroHealing: number | null
	scaledHeroDamage: number | null
	scaledTowerDamage: number | null
	scaledHeroHealing: number | null
	item0: number | null
	item1: number | null
	item2: number | null
	item3: number | null
	item4: number | null
	item5: number | null
	itemNeutral: number | null
	itemNeutral2: number | null
	item6: number | null
	item7: number | null
	item8: number | null
	item9: number | null
	item10: number | null
	item10Lvl: number | null
	backpack0: number | null
	backpack1: number | null
	backpack2: number | null
	backpack3: number | null
	selectedFacet: number | null
	aghanimsScepter: number | null
	aghanimsShard: number | null
	moonshard: number | null
	abilityUpgrades: number[] | null
	abilityUpgradeRows: AbilityUpgradeFacts[]
	leaverStatus: number | null
	partyId: number | null
	partySize: number | null
	claimedFarmGold: number | null
	supportGold: number | null
	claimedDenies: number | null
	claimedMisses: number | null
	misses: number | null
	supportAbilityValue: number | null
	scaledKills: number | null
	scaledDeaths: number | null
	scaledAssists: number | null
	heroPickOrder: number | null
	heroWasRandomed: boolean | null
	secondsDead: number | null
	goldLostToDeath: number | null
	laneSelectionFlags: number | null
	bountyRunes: number | null
	outpostsCaptured: number | null
	disableDuration: number | null
	buffs: Array<{ buffId: number; stacks: number; grantTime: number | null }>
	units: Array<{
		unitName: string
		item0: number | null
		item1: number | null
		item2: number | null
		item3: number | null
		item4: number | null
		item5: number | null
	}>
	damageBreakdown: DamageBreakdownFacts[]
}

export type DraftPick = {
	ord: number
	isPick: boolean
	heroId: number
	team: number
	playerSlot: number | null
	clock: number | null
}

const RADIANT_VICTORY = 2
const DIRE_VICTORY = 3

function asStatusPair(
	raw: Record<string, unknown>,
	radiantKey: string,
	direKey: string,
	packedKey: string,
): [number | null, number | null] {
	const packed = Array.isArray(raw[packedKey]) ? raw[packedKey] : null
	const fromPacked = (index: number) =>
		packed == null ? null : asNumber(packed[index])
	return [
		asNumber(raw[radiantKey]) ?? fromPacked(0),
		asNumber(raw[direKey]) ?? fromPacked(1),
	]
}

function radiantWinOf(raw: Record<string, unknown>): boolean | null {
	const flag = asBool(raw.radiant_win)
	if (flag !== null) return flag
	const outcome = asNumber(raw.match_outcome)
	if (outcome === RADIANT_VICTORY) return true
	if (outcome === DIRE_VICTORY) return false
	return null
}

export function extractMatchFacts(raw: Record<string, unknown>): MatchFacts {
	const matchId = asNumber(raw.match_id)
	if (matchId === null) throw new Error('match details missing match_id')
	const leagueId = asNumber(raw.leagueid) ?? asNumber(raw.league_id)
	const [towerRadiant, towerDire] = asStatusPair(
		raw,
		'tower_status_radiant',
		'tower_status_dire',
		'tower_status',
	)
	const [raxRadiant, raxDire] = asStatusPair(
		raw,
		'barracks_status_radiant',
		'barracks_status_dire',
		'barracks_status',
	)
	return {
		matchId,
		matchSeqNum: asNumber(raw.match_seq_num),
		leagueId: leagueId === 0 ? null : leagueId,
		startTime: asNumber(raw.start_time) ?? asNumber(raw.starttime),
		duration: asNumber(raw.duration),
		preGameDuration: asNumber(raw.pre_game_duration),
		radiantWin: radiantWinOf(raw),
		radiantScore:
			asNumber(raw.radiant_score) ?? asNumber(raw.radiant_team_score),
		direScore: asNumber(raw.dire_score) ?? asNumber(raw.dire_team_score),
		towerStatusRadiant: towerRadiant,
		towerStatusDire: towerDire,
		barracksStatusRadiant: raxRadiant,
		barracksStatusDire: raxDire,
		firstBloodTime: asNumber(raw.first_blood_time),
		lobbyType: asNumber(raw.lobby_type),
		lobbyId: asPgInt8(raw.lobby_id),
		gameMode: asNumber(raw.game_mode),
		engine: asNumber(raw.engine),
		humanPlayers: asNumber(raw.human_players),
		cluster: asNumber(raw.cluster),
		replaySalt: asNumber(raw.replay_salt),
		seriesId: asNumber(raw.series_id),
		seriesType: asNumber(raw.series_type),
		radiantTeamId: asNumber(raw.radiant_team_id),
		direTeamId: asNumber(raw.dire_team_id),
		radiantTeamName:
			asString(raw.radiant_name) ?? asString(raw.radiant_team_name),
		direTeamName: asString(raw.dire_name) ?? asString(raw.dire_team_name),
		radiantTeamComplete: asComplete(raw.radiant_team_complete),
		direTeamComplete: asComplete(raw.dire_team_complete),
		radiantCaptain: asNumber(raw.radiant_captain),
		direCaptain: asNumber(raw.dire_captain),
		positiveVotes: asNumber(raw.positive_votes),
		negativeVotes: asNumber(raw.negative_votes),
		matchFlags: asNumber(raw.match_flags) ?? asNumber(raw.flags),
		matchOutcome: asNumber(raw.match_outcome),
		gameBalance: asNumber(raw.game_balance),
		radiantTeamLogo:
			asPgInt8(raw.radiant_team_logo) ?? asPgInt8(raw.radiant_logo),
		direTeamLogo: asPgInt8(raw.dire_team_logo) ?? asPgInt8(raw.dire_logo),
		radiantTeamLogoUrl: asString(raw.radiant_team_logo_url),
		direTeamLogoUrl: asString(raw.dire_team_logo_url),
		radiantTeamTag: asString(raw.radiant_team_tag),
		direTeamTag: asString(raw.dire_team_tag),
		radiantGuildId: asNumber(raw.radiant_guild_id),
		direGuildId: asNumber(raw.dire_guild_id),
		tournamentId: asNumber(raw.tournament_id),
		tournamentRound: asNumber(raw.tournament_round),
		leagueSeriesId: asNumber(raw.league_series_id),
		leagueGameId: asNumber(raw.league_game_id),
		gameNumber: asNumber(raw.game_number),
		stageName: asString(raw.stage_name),
		leagueTier: asNumber(raw.league_tier),
		coaches: extractCoaches(raw),
		broadcasters: extractBroadcasters(raw),
	}
}

function extractCoaches(raw: Record<string, unknown>): CoachFacts[] {
	const rows = Array.isArray(raw.coaches) ? raw.coaches : []
	const out: CoachFacts[] = []
	for (const item of rows) {
		if (typeof item !== 'object' || item === null) continue
		const row = item as Record<string, unknown>
		const accountId = asNumber(row.account_id)
		if (accountId === null || accountId <= 0) continue
		out.push({
			accountId,
			coachName: asString(row.coach_name),
			coachRating: asNumber(row.coach_rating),
			coachTeam: asNumber(row.coach_team),
			coachPartyId: asNumber(row.coach_party_id),
			isPrivateCoach: asBool(row.is_private_coach),
		})
	}
	return out
}

function extractBroadcasters(raw: Record<string, unknown>): BroadcasterFacts[] {
	const channels = Array.isArray(raw.broadcaster_channels)
		? raw.broadcaster_channels
		: []
	const out: BroadcasterFacts[] = []
	let seq = 0
	for (const item of channels) {
		if (typeof item !== 'object' || item === null) continue
		const channel = item as Record<string, unknown>
		const infos = Array.isArray(channel.broadcaster_infos)
			? channel.broadcaster_infos
			: [channel]
		for (const infoItem of infos) {
			if (typeof infoItem !== 'object' || infoItem === null) continue
			const info = infoItem as Record<string, unknown>
			out.push({
				seq,
				countryCode: asString(channel.country_code),
				description: asString(channel.description),
				languageCode: asString(channel.language_code),
				accountId: asNumber(info.account_id),
				name: asString(info.name),
			})
			seq += 1
		}
	}
	return out
}

export function extractDraft(raw: Record<string, unknown>): DraftPick[] {
	const rows = Array.isArray(raw.picks_bans) ? raw.picks_bans : []
	const out: DraftPick[] = []
	for (let i = 0; i < rows.length; i++) {
		const item = rows[i]
		if (typeof item !== 'object' || item === null) continue
		const row = item as Record<string, unknown>
		const heroId = asNumber(row.hero_id)
		if (heroId === null || heroId === 0) continue
		const isPick =
			asBool(row.is_pick) ??
			(typeof row.is_pick === 'number' ? row.is_pick === 1 : true)
		const team = asNumber(row.team) ?? 0
		const ord = asNumber(row.order) ?? asNumber(row.ord) ?? i
		out.push({
			ord,
			isPick,
			heroId,
			team,
			playerSlot: asNumber(row.player_slot),
			clock: asNumber(row.clock),
		})
	}
	return out
}

export function extractPlayers(raw: Record<string, unknown>): PlayerFacts[] {
	const rows = Array.isArray(raw.players) ? raw.players : []
	const out: PlayerFacts[] = []
	for (let i = 0; i < rows.length; i++) {
		const item = rows[i]
		if (typeof item !== 'object' || item === null) continue
		const row = item as Record<string, unknown>
		const rawSlot = asNumber(row.player_slot) ?? i
		const slot = normalizeValvePlayerSlot(rawSlot)
		if (slot === null) continue
		out.push(extractPlayer(row, slot))
	}
	return out
}

function extractAbilityUpgrades(
	row: Record<string, unknown>,
): AbilityUpgradeFacts[] {
	const raw = Array.isArray(row.ability_upgrades)
		? row.ability_upgrades
		: Array.isArray(row.ability_upgrades_arr)
			? row.ability_upgrades_arr
			: []
	const out: AbilityUpgradeFacts[] = []
	for (let i = 0; i < raw.length; i++) {
		const item = raw[i]
		if (typeof item === 'number' && Number.isFinite(item)) {
			out.push({ seq: i, abilityId: item, time: null, level: i + 1 })
			continue
		}
		if (typeof item !== 'object' || item === null) continue
		const upgrade = item as Record<string, unknown>
		const abilityId = asNumber(upgrade.ability) ?? asNumber(upgrade.ability_id)
		if (abilityId === null) continue
		out.push({
			seq: asNumber(upgrade.seq) ?? i,
			abilityId,
			time: asNumber(upgrade.time),
			level: asNumber(upgrade.level),
		})
	}
	return out
}

function extractDamage(
	row: Record<string, unknown>,
	key: string,
	direction: DamageBreakdownFacts['direction'],
): DamageBreakdownFacts[] {
	const raw = Array.isArray(row[key]) ? row[key] : []
	const out: DamageBreakdownFacts[] = []
	for (const item of raw) {
		if (typeof item !== 'object' || item === null) continue
		const dmg = item as Record<string, unknown>
		const damageType = asNumber(dmg.damage_type) ?? 0
		out.push({
			direction,
			damageType,
			preReduction: asNumber(dmg.pre_reduction),
			postReduction: asNumber(dmg.post_reduction),
		})
	}
	return out
}

function extractPlayer(
	row: Record<string, unknown>,
	slot: number,
): PlayerFacts {
	const buffsRaw = Array.isArray(row.permanent_buffs) ? row.permanent_buffs : []
	const buffs: PlayerFacts['buffs'] = []
	for (const item of buffsRaw) {
		if (typeof item !== 'object' || item === null) continue
		const buff = item as Record<string, unknown>
		const buffId = asNumber(buff.permanent_buff) ?? asNumber(buff.buff_id)
		if (buffId === null) continue
		buffs.push({
			buffId,
			stacks: asNumber(buff.stack_count) ?? asNumber(buff.stacks) ?? 1,
			grantTime: asNumber(buff.grant_time),
		})
	}

	const unitsRaw = Array.isArray(row.additional_units)
		? row.additional_units
		: []
	const units: PlayerFacts['units'] = []
	for (const item of unitsRaw) {
		if (typeof item !== 'object' || item === null) continue
		const unit = item as Record<string, unknown>
		const unitName = asString(unit.unitname) ?? asString(unit.unit_name)
		if (unitName === null) continue
		const items = Array.isArray(unit.items) ? unit.items : null
		units.push({
			unitName,
			item0:
				asItemId(unit.item_0) ?? (items == null ? null : asItemId(items[0])),
			item1:
				asItemId(unit.item_1) ?? (items == null ? null : asItemId(items[1])),
			item2:
				asItemId(unit.item_2) ?? (items == null ? null : asItemId(items[2])),
			item3:
				asItemId(unit.item_3) ?? (items == null ? null : asItemId(items[3])),
			item4:
				asItemId(unit.item_4) ?? (items == null ? null : asItemId(items[4])),
			item5:
				asItemId(unit.item_5) ?? (items == null ? null : asItemId(items[5])),
		})
	}

	const abilityUpgradeRows = extractAbilityUpgrades(row)
	const abilityUpgrades =
		asIntArray(row.ability_upgrades_arr) ??
		asIntArray(row.ability_upgrades) ??
		(abilityUpgradeRows.length > 0
			? abilityUpgradeRows.map((row) => row.abilityId)
			: null)

	return {
		accountId: asNumber(row.account_id) ?? 0,
		playerSlot: slot,
		heroId: asNumber(row.hero_id) ?? 0,
		heroVariant: asNumber(row.hero_variant) ?? asNumber(row.selected_facet),
		playerName:
			asString(row.personaname) ??
			asString(row.player_name) ??
			asString(row.name),
		proName: asString(row.pro_name),
		realName: asString(row.real_name),
		teamNumber: asNumber(row.team_number),
		teamSlot: asNumber(row.team_slot),
		side: slot < 128 ? 'radiant' : 'dire',
		kills: asNumber(row.kills),
		deaths: asNumber(row.deaths) ?? asNumber(row.death),
		assists: asNumber(row.assists),
		lastHits: asNumber(row.last_hits),
		denies: asNumber(row.denies),
		gold: asNumber(row.gold),
		goldSpent: asNumber(row.gold_spent),
		goldPerMin: asNumber(row.gold_per_min),
		xpPerMin: asNumber(row.xp_per_min),
		netWorth: asNumber(row.net_worth),
		level: asNumber(row.level),
		heroDamage: asNumber(row.hero_damage),
		towerDamage: asNumber(row.tower_damage),
		heroHealing: asNumber(row.hero_healing),
		scaledHeroDamage: asNumber(row.scaled_hero_damage),
		scaledTowerDamage: asNumber(row.scaled_tower_damage),
		scaledHeroHealing: asNumber(row.scaled_hero_healing),
		item0: asItemId(row.item_0) ?? asItemId(row.item0),
		item1: asItemId(row.item_1) ?? asItemId(row.item1),
		item2: asItemId(row.item_2) ?? asItemId(row.item2),
		item3: asItemId(row.item_3) ?? asItemId(row.item3),
		item4: asItemId(row.item_4) ?? asItemId(row.item4),
		item5: asItemId(row.item_5) ?? asItemId(row.item5),
		itemNeutral: asItemId(row.item_neutral),
		itemNeutral2: asItemId(row.item_neutral2),
		item6: asItemId(row.item_6),
		item7: asItemId(row.item_7),
		item8: asItemId(row.item_8),
		item9: asItemId(row.item_9),
		item10: asItemId(row.item_10),
		item10Lvl: asNumber(row.item_10_lvl),
		backpack0: asItemId(row.backpack_0),
		backpack1: asItemId(row.backpack_1),
		backpack2: asItemId(row.backpack_2),
		backpack3: asItemId(row.backpack_3),
		selectedFacet: asNumber(row.selected_facet) ?? asNumber(row.hero_variant),
		aghanimsScepter: asNumber(row.aghanims_scepter),
		aghanimsShard: asNumber(row.aghanims_shard),
		moonshard: asNumber(row.moonshard),
		abilityUpgrades,
		abilityUpgradeRows,
		leaverStatus: asNumber(row.leaver_status),
		partyId: asNumber(row.party_id),
		partySize: asNumber(row.party_size),
		claimedFarmGold: asNumber(row.claimed_farm_gold),
		supportGold: asNumber(row.support_gold),
		claimedDenies: asNumber(row.claimed_denies),
		claimedMisses: asNumber(row.claimed_misses),
		misses: asNumber(row.misses),
		supportAbilityValue: asNumber(row.support_ability_value),
		scaledKills: asNumber(row.scaled_kills),
		scaledDeaths: asNumber(row.scaled_deaths),
		scaledAssists: asNumber(row.scaled_assists),
		heroPickOrder: asNumber(row.hero_pick_order),
		heroWasRandomed: asBool(row.hero_was_randomed) ?? asBool(row.randomed),
		secondsDead: asNumber(row.seconds_dead),
		goldLostToDeath: asNumber(row.gold_lost_to_death),
		laneSelectionFlags: asNumber(row.lane_selection_flags),
		bountyRunes: asNumber(row.bounty_runes),
		outpostsCaptured: asNumber(row.outposts_captured) ?? asNumber(row.outposts),
		disableDuration: asNumber(row.disable_duration),
		buffs,
		units,
		damageBreakdown: [
			...extractDamage(row, 'hero_damage_received', 'received'),
			...extractDamage(row, 'hero_damage_dealt', 'dealt'),
		],
	}
}

export function partialPlayerFacts(
	row: Partial<PlayerFacts> & {
		accountId: number
		playerSlot: number
	},
): PlayerFacts {
	return {
		heroId: 0,
		heroVariant: null,
		playerName: null,
		proName: null,
		realName: null,
		teamNumber: null,
		teamSlot: null,
		side: row.playerSlot < 128 ? 'radiant' : 'dire',
		kills: null,
		deaths: null,
		assists: null,
		lastHits: null,
		denies: null,
		gold: null,
		goldSpent: null,
		goldPerMin: null,
		xpPerMin: null,
		netWorth: null,
		level: null,
		heroDamage: null,
		towerDamage: null,
		heroHealing: null,
		scaledHeroDamage: null,
		scaledTowerDamage: null,
		scaledHeroHealing: null,
		item0: null,
		item1: null,
		item2: null,
		item3: null,
		item4: null,
		item5: null,
		itemNeutral: null,
		itemNeutral2: null,
		item6: null,
		item7: null,
		item8: null,
		item9: null,
		item10: null,
		item10Lvl: null,
		backpack0: null,
		backpack1: null,
		backpack2: null,
		backpack3: null,
		selectedFacet: null,
		aghanimsScepter: null,
		aghanimsShard: null,
		moonshard: null,
		abilityUpgrades: null,
		abilityUpgradeRows: [],
		leaverStatus: null,
		partyId: null,
		partySize: null,
		claimedFarmGold: null,
		supportGold: null,
		claimedDenies: null,
		claimedMisses: null,
		misses: null,
		supportAbilityValue: null,
		scaledKills: null,
		scaledDeaths: null,
		scaledAssists: null,
		heroPickOrder: null,
		heroWasRandomed: null,
		secondsDead: null,
		goldLostToDeath: null,
		laneSelectionFlags: null,
		bountyRunes: null,
		outpostsCaptured: null,
		disableDuration: null,
		buffs: [],
		units: [],
		damageBreakdown: [],
		...row,
	}
}
