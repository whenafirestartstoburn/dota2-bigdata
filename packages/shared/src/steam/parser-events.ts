import { asNumber, asString } from '#src/store/coerce'

export const PARSER_SCHEMA_VERSION = 3

export type ReplayTable =
	| 'replay_combat_log'
	| 'replay_intervals'
	| 'replay_actions'
	| 'replay_pings'
	| 'replay_wards'
	| 'replay_chat'
	| 'replay_announcements'
	| 'replay_draft'
	| 'replay_ability_levels'
	| 'replay_inventory'
	| 'replay_neutrals'
	| 'replay_cosmetics'
	| 'replay_epilogue'

export type MappedReplayRow = {
	table: ReplayTable
	row: Record<string, unknown>
}

export type ObjectiveKind =
	| 'first_blood'
	| 'tower'
	| 'barracks'
	| 'roshan'
	| 'aegis'
	| 'aegis_stolen'
	| 'buyback'
	| 'glyph'
	| 'scan'
	| 'pause'
	| 'reconnect'
	| 'disconnect'
	| 'win'

const ANNOUNCE_KIND: Record<string, ObjectiveKind> = {
	CHAT_MESSAGE_FIRSTBLOOD: 'first_blood',
	CHAT_MESSAGE_TOWER_KILL: 'tower',
	CHAT_MESSAGE_BARRACKS_KILL: 'barracks',
	CHAT_MESSAGE_ROSHAN_KILL: 'roshan',
	CHAT_MESSAGE_AEGIS: 'aegis',
	CHAT_MESSAGE_AEGISTOLEN: 'aegis_stolen',
	CHAT_MESSAGE_AEGIS_STOLEN: 'aegis_stolen',
	CHAT_MESSAGE_BUYBACK: 'buyback',
	CHAT_MESSAGE_GLYPH_USED: 'glyph',
	CHAT_MESSAGE_SCAN_USED: 'scan',
	CHAT_MESSAGE_PAUSED: 'pause',
	CHAT_MESSAGE_RECONNECT: 'reconnect',
	CHAT_MESSAGE_DISCONNECT: 'disconnect',
}

function num(value: unknown, fallback = 0): number {
	return asNumber(value) ?? fallback
}

function str(value: unknown): string {
	return asString(value) ?? ''
}

function bool01(value: unknown): number {
	if (value === true || value === 1) return 1
	return 0
}

function combatType(type: string): string {
	return type.startsWith('DOTA_COMBATLOG_')
		? type.slice('DOTA_COMBATLOG_'.length)
		: type
}

function shared(
	matchId: number,
	startTime: string,
	entry: Record<string, unknown>,
): Record<string, unknown> {
	return {
		match_id: String(matchId),
		start_time: startTime,
		time: num(entry.time),
		tick: num(entry.tick),
		slot: num(entry.slot, -1),
		parser_version: PARSER_SCHEMA_VERSION,
	}
}

export function mapReplayEvent(
	matchId: number,
	startTime: string,
	entry: Record<string, unknown>,
): MappedReplayRow | null {
	const type = str(entry.type)
	if (type === '' || type === 'player_slot') return null
	const base = shared(matchId, startTime, entry)

	if (type.startsWith('DOTA_COMBATLOG_')) {
		return {
			table: 'replay_combat_log',
			row: {
				...base,
				type: combatType(type),
				attacker: str(entry.attackername) || str(entry.attacker),
				target: str(entry.targetname) || str(entry.target),
				inflictor: str(entry.inflictor),
				sourcename: str(entry.sourcename),
				targetsourcename: str(entry.targetsourcename),
				attacker_slot: num(entry.attacker_slot, -1),
				target_slot: num(entry.target_slot, -1),
				value: num(entry.value),
				value_name: str(entry.valuename),
				gold_reason: num(entry.gold_reason),
				xp_reason: num(entry.xp_reason),
				attacker_hero: bool01(entry.attackerhero),
				target_hero: bool01(entry.targethero),
				attacker_illusion: bool01(entry.attackerillusion),
				target_illusion: bool01(entry.targetillusion),
				stun_duration: num(entry.stun_duration),
				slow_duration: num(entry.slow_duration),
				greevils_greed_stack: num(entry.greevils_greed_stack),
				tracked_death: bool01(entry.tracked_death),
				tracked_sourcename: str(entry.tracked_sourcename),
				health: num(entry.health),
				ability_level: num(entry.ability_level),
				location_x: num(entry.location_x),
				location_y: num(entry.location_y),
				modifier_duration: num(entry.modifier_duration),
				last_hits: num(entry.last_hits),
				attacker_team: num(entry.attacker_team),
				target_team: num(entry.target_team),
				stack_count: num(entry.stack_count),
				is_target_building: bool01(entry.is_target_building),
				rune_type: num(entry.rune_type),
				networth: num(entry.networth),
				visible_radiant: bool01(entry.visible_radiant),
				visible_dire: bool01(entry.visible_dire),
				is_ability_toggle_on: bool01(entry.is_ability_toggle_on),
				is_ability_toggle_off: bool01(entry.is_ability_toggle_off),
				timestamp_raw: num(entry.timestamp_raw),
				obs_wards_placed: num(entry.obs_wards_placed),
				assist_player0: num(entry.assist_player0),
				assist_player1: num(entry.assist_player1),
				assist_player2: num(entry.assist_player2),
				assist_player3: num(entry.assist_player3),
				assist_players: Array.isArray(entry.assist_players)
					? entry.assist_players.map((id) => num(id))
					: [],
				hidden_modifier: bool01(entry.hidden_modifier),
				neutral_camp_type: num(entry.neutral_camp_type),
				is_heal_save: bool01(entry.is_heal_save),
				is_ultimate_ability: bool01(entry.is_ultimate_ability),
				attacker_hero_level: num(entry.attacker_hero_level),
				target_hero_level: num(entry.target_hero_level),
				xpm: num(entry.xpm),
				gpm: num(entry.gpm),
				event_location: num(entry.event_location),
				target_is_self: bool01(entry.target_is_self),
				damage_type: num(entry.damage_type),
				invisibility_modifier: bool01(entry.invisibility_modifier),
				damage_category: num(entry.damage_category),
				building_type: num(entry.building_type),
				modifier_elapsed_duration: num(entry.modifier_elapsed_duration),
				silence_modifier: bool01(entry.silence_modifier),
				heal_from_lifesteal: bool01(entry.heal_from_lifesteal),
				modifier_purged: bool01(entry.modifier_purged),
				spell_evaded: bool01(entry.spell_evaded),
				motion_controller_modifier: bool01(entry.motion_controller_modifier),
				long_range_kill: bool01(entry.long_range_kill),
				modifier_purge_ability: num(entry.modifier_purge_ability),
				modifier_purge_npc: num(entry.modifier_purge_npc),
				root_modifier: bool01(entry.root_modifier),
				total_unit_death_count: num(entry.total_unit_death_count),
				aura_modifier: bool01(entry.aura_modifier),
				armor_debuff_modifier: bool01(entry.armor_debuff_modifier),
				no_physical_damage_modifier: bool01(entry.no_physical_damage_modifier),
				modifier_ability: num(entry.modifier_ability),
				modifier_hidden: bool01(entry.modifier_hidden),
				inflictor_is_stolen_ability: bool01(entry.inflictor_is_stolen_ability),
				kill_eater_event: num(entry.kill_eater_event),
				unit_status_label: num(entry.unit_status_label),
				spell_generated_attack: bool01(entry.spell_generated_attack),
				at_night_time: bool01(entry.at_night_time),
				attacker_has_scepter: bool01(entry.attacker_has_scepter),
				neutral_camp_team: num(entry.neutral_camp_team),
				regenerated_health: num(entry.regenerated_health),
				will_reincarnate: bool01(entry.will_reincarnate),
				uses_charges: bool01(entry.uses_charges),
				tracked_stat_id: num(entry.tracked_stat_id),
				modifier_purged_duration: num(entry.modifier_purged_duration),
				heal_from_regen: bool01(entry.heal_from_regen),
			},
		}
	}

	if (type === 'interval') {
		return {
			table: 'replay_intervals',
			row: {
				...base,
				hero_id: num(entry.hero_id),
				variant: num(entry.variant),
				facet_hero_id: num(entry.facet_hero_id),
				unit: str(entry.unit),
				x: num(entry.x),
				y: num(entry.y),
				gold: num(entry.gold),
				lh: num(entry.lh),
				xp: num(entry.xp),
				networth: num(entry.networth),
				denies: num(entry.denies),
				level: num(entry.level),
				kills: num(entry.kills),
				deaths: num(entry.deaths),
				assists: num(entry.assists),
				life_state: num(entry.life_state),
				stuns: num(entry.stuns),
				obs_placed: num(entry.obs_placed),
				sen_placed: num(entry.sen_placed),
				creeps_stacked: num(entry.creeps_stacked),
				camps_stacked: num(entry.camps_stacked),
				rune_pickups: num(entry.rune_pickups),
				towers_killed: num(entry.towers_killed),
				roshans_killed: num(entry.roshans_killed),
				teamfight_participation: num(entry.teamfight_participation),
				firstblood_claimed: num(entry.firstblood_claimed),
				draft_stage: num(entry.stage),
				repicked: bool01(entry.repicked),
				randomed: bool01(entry.randomed),
				pred_vict: bool01(entry.pred_vict),
				observers_placed: num(entry.observers_placed),
			},
		}
	}

	if (type === 'actions') {
		return {
			table: 'replay_actions',
			row: { ...base, order_type: num(entry.key) },
		}
	}

	if (type === 'pings') {
		return {
			table: 'replay_pings',
			row: { ...base, x: num(entry.x), y: num(entry.y) },
		}
	}

	if (
		type === 'obs' ||
		type === 'sen' ||
		type === 'obs_left' ||
		type === 'sen_left'
	) {
		const left = type.endsWith('_left') || entry.entityleft === true
		return {
			table: 'replay_wards',
			row: {
				...base,
				kind: type.startsWith('sen') ? 'sen' : 'obs',
				is_left: left ? 1 : 0,
				x: num(entry.x),
				y: num(entry.y),
				z: num(entry.z),
				ehandle: num(entry.ehandle),
			},
		}
	}

	if (type === 'chat' || type === 'chatwheel') {
		return {
			table: 'replay_chat',
			row: {
				...base,
				kind: type,
				key: str(entry.key),
				unit: str(entry.unit),
				channel: num(entry.channel),
			},
		}
	}

	if (type === 'DOTA_ABILITY_LEVEL') {
		return {
			table: 'replay_ability_levels',
			row: {
				...base,
				ability_id: str(entry.valuename),
				ability_level: num(entry.abilitylevel),
				target: str(entry.targetname),
			},
		}
	}

	if (type === 'STARTING_ITEM') {
		return {
			table: 'replay_inventory',
			row: {
				...base,
				item_id: str(entry.valuename),
				item_slot: num(entry.itemslot),
				charges: num(entry.charges),
				secondary_charges: num(entry.secondary_charges),
			},
		}
	}

	if (type === 'neutral_token' || type === 'neutral_item_history') {
		return {
			table: 'replay_neutrals',
			row: {
				...base,
				kind: type,
				key: str(entry.key),
				value: num(entry.value),
				is_neutral_active_drop: bool01(entry.isNeutralActiveDrop),
				is_neutral_passive_drop: bool01(entry.isNeutralPassiveDrop),
			},
		}
	}

	if (type === 'cosmetics') {
		return {
			table: 'replay_cosmetics',
			row: { ...base, item_id: num(entry.value) || num(entry.key) },
		}
	}

	if (type === 'epilogue') {
		return {
			table: 'replay_epilogue',
			row: { ...base, key: 'epilogue', value: JSON.stringify(entry) },
		}
	}

	if (type === 'draft_timings' || type === 'draft') {
		const draftOrder = num(entry.draft_order)
		const activeTeam = num(entry.draft_active_team)
		const teamFromActive =
			activeTeam === 3 ? 1 : activeTeam === 2 ? 0 : num(entry.team)
		return {
			table: 'replay_draft',
			row: {
				...base,
				is_pick: bool01(entry.pick ?? entry.is_pick),
				hero_id: num(entry.hero_id),
				team: teamFromActive,
				ord:
					num(entry.order) ||
					num(entry.ord) ||
					(draftOrder > 0 ? draftOrder - 1 : 0),
				clock: num(entry.clock) || num(entry.time),
				extra_time_radiant: num(entry.draft_extime0),
				extra_time_dire: num(entry.draft_extime1),
			},
		}
	}

	return {
		table: 'replay_announcements',
		row: {
			...base,
			kind: type,
			player1: num(entry.player1, -1),
			player2: num(entry.player2, -1),
			player3: num(entry.player3, -1),
			value: num(entry.value),
			value2: num(entry.value2),
			value3: num(entry.value3),
			slot: num(entry.slot, num(entry.player1, -1)),
		},
	}
}

export function announcementObjective(kind: string): ObjectiveKind | null {
	return ANNOUNCE_KIND[kind] ?? null
}

/** Parser slots 0–9; Postgres match_players uses Valve 0–4 / 128–132. */
export function toValvePlayerSlot(slot: number): number {
	if (slot >= 5 && slot <= 9) return 128 + (slot - 5)
	return slot
}
