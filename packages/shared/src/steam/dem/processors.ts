import {
	protoBool as bool,
	decodeFields,
	type ProtoField,
	protoAllBytes,
	protoBytes,
	protoFloat32,
	protoNum,
	protoRepeatedInt32,
	protoSint32,
	protoStr,
} from '#src/gc/protobuf'
import { asNumeric } from '#src/store/coerce'
import type { DemoParser, Entity } from './demo'

const UM_CHAT_EVENT = 466
const UM_LOCATION_PING = 477
const UM_CHAT_WHEEL = 501
const UM_UNIT_ORDERS = 547
const UM_COMBAT_LOG = 554
const UM_CHAT_MESSAGE = 612

const COMBAT_TYPES = [
	'DOTA_COMBATLOG_DAMAGE',
	'DOTA_COMBATLOG_HEAL',
	'DOTA_COMBATLOG_MODIFIER_ADD',
	'DOTA_COMBATLOG_MODIFIER_REMOVE',
	'DOTA_COMBATLOG_DEATH',
	'DOTA_COMBATLOG_ABILITY',
	'DOTA_COMBATLOG_ITEM',
	'DOTA_COMBATLOG_LOCATION',
	'DOTA_COMBATLOG_GOLD',
	'DOTA_COMBATLOG_GAME_STATE',
	'DOTA_COMBATLOG_XP',
	'DOTA_COMBATLOG_PURCHASE',
	'DOTA_COMBATLOG_BUYBACK',
	'DOTA_COMBATLOG_ABILITY_TRIGGER',
	'DOTA_COMBATLOG_PLAYERSTATS',
	'DOTA_COMBATLOG_MULTIKILL',
	'DOTA_COMBATLOG_KILLSTREAK',
	'DOTA_COMBATLOG_TEAM_BUILDING_KILL',
	'DOTA_COMBATLOG_FIRST_BLOOD',
	'DOTA_COMBATLOG_MODIFIER_STACK_EVENT',
	'DOTA_COMBATLOG_NEUTRAL_CAMP_STACK',
	'DOTA_COMBATLOG_PICKUP_RUNE',
	'DOTA_COMBATLOG_REVEALED_INVISIBLE',
	'DOTA_COMBATLOG_HERO_SAVED',
	'DOTA_COMBATLOG_MANA_RESTORED',
	'DOTA_COMBATLOG_HERO_LEVELUP',
	'DOTA_COMBATLOG_BOTTLE_HEAL_ALLY',
	'DOTA_COMBATLOG_ENDGAME_STATS',
	'DOTA_COMBATLOG_INTERRUPT_CHANNEL',
	'DOTA_COMBATLOG_ALLIED_GOLD',
	'DOTA_COMBATLOG_AEGIS_TAKEN',
	'DOTA_COMBATLOG_MANA_DAMAGE',
	'DOTA_COMBATLOG_PHYSICAL_DAMAGE_PREVENTED',
	'DOTA_COMBATLOG_UNIT_SUMMONED',
	'DOTA_COMBATLOG_ATTACK_EVADE',
	'DOTA_COMBATLOG_TREE_CUT',
	'DOTA_COMBATLOG_SUCCESSFUL_SCAN',
	'DOTA_COMBATLOG_END_KILLSTREAK',
	'DOTA_COMBATLOG_BLOODSTONE_CHARGE',
	'DOTA_COMBATLOG_CRITICAL_DAMAGE',
	'DOTA_COMBATLOG_SPELL_ABSORB',
	'DOTA_COMBATLOG_UNIT_TELEPORTED',
	'DOTA_COMBATLOG_KILL_EATER_EVENT',
	'DOTA_COMBATLOG_NEUTRAL_ITEM_EARNED',
	'DOTA_COMBATLOG_STAT_TRACKER_PLAYER',
] as const

const CHAT_MESSAGES: Record<number, string> = {
	0: 'CHAT_MESSAGE_HERO_KILL',
	1: 'CHAT_MESSAGE_HERO_DENY',
	2: 'CHAT_MESSAGE_BARRACKS_KILL',
	3: 'CHAT_MESSAGE_TOWER_KILL',
	4: 'CHAT_MESSAGE_TOWER_DENY',
	5: 'CHAT_MESSAGE_FIRSTBLOOD',
	6: 'CHAT_MESSAGE_STREAK_KILL',
	7: 'CHAT_MESSAGE_BUYBACK',
	8: 'CHAT_MESSAGE_AEGIS',
	9: 'CHAT_MESSAGE_ROSHAN_KILL',
	10: 'CHAT_MESSAGE_COURIER_LOST',
	11: 'CHAT_MESSAGE_COURIER_RESPAWNED',
	12: 'CHAT_MESSAGE_GLYPH_USED',
	13: 'CHAT_MESSAGE_ITEM_PURCHASE',
	14: 'CHAT_MESSAGE_CONNECT',
	15: 'CHAT_MESSAGE_DISCONNECT',
	16: 'CHAT_MESSAGE_DISCONNECT_WAIT_FOR_RECONNECT',
	17: 'CHAT_MESSAGE_DISCONNECT_TIME_REMAINING',
	18: 'CHAT_MESSAGE_DISCONNECT_TIME_REMAINING_PLURAL',
	19: 'CHAT_MESSAGE_RECONNECT',
	20: 'CHAT_MESSAGE_PLAYER_LEFT',
	21: 'CHAT_MESSAGE_SAFE_TO_LEAVE',
	22: 'CHAT_MESSAGE_RUNE_PICKUP',
	23: 'CHAT_MESSAGE_RUNE_BOTTLE',
	24: 'CHAT_MESSAGE_INTHEBAG',
	25: 'CHAT_MESSAGE_SECRETSHOP',
	26: 'CHAT_MESSAGE_ITEM_AUTOPURCHASED',
	27: 'CHAT_MESSAGE_ITEMS_COMBINED',
	28: 'CHAT_MESSAGE_SUPER_CREEPS',
	29: 'CHAT_MESSAGE_CANT_USE_ACTION_ITEM',
	31: 'CHAT_MESSAGE_CANTPAUSE',
	32: 'CHAT_MESSAGE_NOPAUSESLEFT',
	33: 'CHAT_MESSAGE_CANTPAUSEYET',
	34: 'CHAT_MESSAGE_PAUSED',
	35: 'CHAT_MESSAGE_UNPAUSE_COUNTDOWN',
	36: 'CHAT_MESSAGE_UNPAUSED',
	37: 'CHAT_MESSAGE_AUTO_UNPAUSED',
	38: 'CHAT_MESSAGE_YOUPAUSED',
	39: 'CHAT_MESSAGE_CANTUNPAUSETEAM',
	41: 'CHAT_MESSAGE_VOICE_TEXT_BANNED',
	42: 'CHAT_MESSAGE_SPECTATORS_WATCHING_THIS_GAME',
	43: 'CHAT_MESSAGE_REPORT_REMINDER',
	44: 'CHAT_MESSAGE_ECON_ITEM',
	45: 'CHAT_MESSAGE_TAUNT',
	46: 'CHAT_MESSAGE_RANDOM',
	47: 'CHAT_MESSAGE_RD_TURN',
	49: 'CHAT_MESSAGE_DROP_RATE_BONUS',
	50: 'CHAT_MESSAGE_NO_BATTLE_POINTS',
	51: 'CHAT_MESSAGE_DENIED_AEGIS',
	52: 'CHAT_MESSAGE_INFORMATIONAL',
	53: 'CHAT_MESSAGE_AEGIS_STOLEN',
	54: 'CHAT_MESSAGE_ROSHAN_CANDY',
	55: 'CHAT_MESSAGE_ITEM_GIFTED',
	56: 'CHAT_MESSAGE_HERO_KILL_WITH_GREEVIL',
	57: 'CHAT_MESSAGE_HOLDOUT_TOWER_DESTROYED',
	58: 'CHAT_MESSAGE_HOLDOUT_WALL_DESTROYED',
	59: 'CHAT_MESSAGE_HOLDOUT_WALL_FINISHED',
	62: 'CHAT_MESSAGE_PLAYER_LEFT_LIMITED_HERO',
	63: 'CHAT_MESSAGE_ABANDON_LIMITED_HERO_EXPLANATION',
	64: 'CHAT_MESSAGE_DISCONNECT_LIMITED_HERO',
	65: 'CHAT_MESSAGE_LOW_PRIORITY_COMPLETED_EXPLANATION',
	66: 'CHAT_MESSAGE_RECRUITMENT_DROP_RATE_BONUS',
	67: 'CHAT_MESSAGE_FROSTIVUS_SHINING_BOOSTER_ACTIVE',
	73: 'CHAT_MESSAGE_PLAYER_LEFT_AFK',
	74: 'CHAT_MESSAGE_PLAYER_LEFT_DISCONNECTED_TOO_LONG',
	75: 'CHAT_MESSAGE_PLAYER_ABANDONED',
	76: 'CHAT_MESSAGE_PLAYER_ABANDONED_AFK',
	77: 'CHAT_MESSAGE_PLAYER_ABANDONED_DISCONNECTED_TOO_LONG',
	78: 'CHAT_MESSAGE_WILL_NOT_BE_SCORED',
	79: 'CHAT_MESSAGE_WILL_NOT_BE_SCORED_RANKED',
	80: 'CHAT_MESSAGE_WILL_NOT_BE_SCORED_NETWORK',
	81: 'CHAT_MESSAGE_WILL_NOT_BE_SCORED_NETWORK_RANKED',
	82: 'CHAT_MESSAGE_CAN_QUIT_WITHOUT_ABANDON',
	83: 'CHAT_MESSAGE_RANKED_GAME_STILL_SCORED_LEAVERS_GET_LOSS',
	84: 'CHAT_MESSAGE_ABANDON_RANKED_BEFORE_FIRST_BLOOD_PARTY',
	85: 'CHAT_MESSAGE_COMPENDIUM_LEVEL',
	86: 'CHAT_MESSAGE_VICTORY_PREDICTION_STREAK',
	87: 'CHAT_MESSAGE_ASSASSIN_ANNOUNCE',
	88: 'CHAT_MESSAGE_ASSASSIN_SUCCESS',
	89: 'CHAT_MESSAGE_ASSASSIN_DENIED',
	90: 'CHAT_MESSAGE_VICTORY_PREDICTION_SINGLE_USER_CONFIRM',
	91: 'CHAT_MESSAGE_EFFIGY_KILL',
	92: 'CHAT_MESSAGE_VOICE_TEXT_BANNED_OVERFLOW',
	93: 'CHAT_MESSAGE_YEAR_BEAST_KILLED',
	94: 'CHAT_MESSAGE_PAUSE_COUNTDOWN',
	95: 'CHAT_MESSAGE_COINS_WAGERED',
	96: 'CHAT_MESSAGE_HERO_NOMINATED_BAN',
	97: 'CHAT_MESSAGE_HERO_BANNED',
	98: 'CHAT_MESSAGE_HERO_BAN_COUNT',
	99: 'CHAT_MESSAGE_RIVER_PAINTED',
	100: 'CHAT_MESSAGE_SCAN_USED',
	101: 'CHAT_MESSAGE_SHRINE_KILLED',
	102: 'CHAT_MESSAGE_WAGER_TOKEN_SPENT',
	103: 'CHAT_MESSAGE_RANK_WAGER',
	104: 'CHAT_MESSAGE_NEW_PLAYER_REMINDER',
	105: 'CHAT_MESSAGE_OBSERVER_WARD_KILLED',
	106: 'CHAT_MESSAGE_SENTRY_WARD_KILLED',
	107: 'CHAT_MESSAGE_ITEM_PLACED_IN_NEUTRAL_STASH',
	108: 'CHAT_MESSAGE_HERO_CHOICE_INVALID',
	109: 'CHAT_MESSAGE_BOUNTY',
	110: 'CHAT_MESSAGE_ABILITY_DRAFT_START',
	111: 'CHAT_MESSAGE_HERO_FOUND_CANDY',
	112: 'CHAT_MESSAGE_ABILITY_DRAFT_RANDOMED',
	113: 'CHAT_MESSAGE_PRIVATE_COACH_CONNECTED',
	114: 'CHAT_MESSAGE_RUNE_DENY',
	115: 'CHAT_MESSAGE_CANT_PAUSE_TOO_EARLY',
	116: 'CHAT_MESSAGE_HERO_KILL_WITH_PENGUIN',
	117: 'CHAT_MESSAGE_MINIBOSS_KILL',
	118: 'CHAT_MESSAGE_PLAYER_IN_GAME_BAN_TEXT',
	119: 'CHAT_MESSAGE_BANNER_PLANTED',
	120: 'CHAT_MESSAGE_ALCHEMIST_GRANTED_SCEPTER',
	121: 'CHAT_MESSAGE_PROTECTOR_SPAWNED',
	122: 'CHAT_MESSAGE_CRAFTING_XP',
	123: 'CHAT_MESSAGE_ROSHAN_ROAR',
	124: 'CHAT_MESSAGE_STONE_OF_RECALL_USED',
	125: 'CHAT_MESSAGE_DEITY_BLESSING',
	126: 'CHAT_MESSAGE_SMOKE_ACTIVATED',
}

const WARD_OBS = new Set([
	'CDOTA_NPC_Observer_Ward',
	'CDOTA_NPC_Observer_Ward_TrueSight',
])

function num(fields: ProtoField[], id: number): number {
	return protoNum(fields, id) ?? 0
}

function flt(fields: ProtoField[], id: number): number {
	return protoFloat32(fields, id) ?? 0
}

function str(fields: ProtoField[], id: number): string {
	return protoStr(fields, id) ?? ''
}

function pad4(i: number): string {
	return String(i).padStart(4, '0')
}

function asNum(value: unknown): number {
	return asNumeric(value) ?? 0
}

function cellPos(entity: Entity, axis: 'X' | 'Y' | 'Z'): number {
	const cell = asNum(entity.get(`CBodyComponent.m_cell${axis}`))
	const vec = asNum(entity.get(`CBodyComponent.m_vec${axis}`))
	return cell * 128 + vec
}

export type ReplayEvent = Record<string, unknown>

/** Event catalog: combat log, 1 Hz intervals, draft, chat, wards, starting items. */
export class ReplayProcessors {
	private time = 0
	private gameStartTime = 0
	private nextInterval = 0
	private postGame = false
	private initPlayers = false
	private validIndices: number[] = []
	private draftSeen = new Set<number>()
	private draftOrder = 1
	private startingWritten = new Set<number>()
	private abilityLevels = new Map<string, number>()
	private heroSlot = new Map<string, number>()
	readonly events: ReplayEvent[] = []

	constructor(private parser: DemoParser) {}

	onTick(): void {
		const grp = this.parser.findByClass('CDOTAGamerulesProxy')
		const pr = this.parser.findByClass('CDOTA_PlayerResource')
		const radiant = this.parser.findByClass('CDOTA_DataRadiant')
		const dire = this.parser.findByClass('CDOTA_DataDire')
		if (grp == null) return

		const oldTime = grp.get('m_pGameRules.m_fGameTime')
		if (oldTime == null) {
			const paused = Boolean(grp.get('m_pGameRules.m_bGamePaused'))
			const timeTick = paused
				? asNum(grp.get('m_pGameRules.m_nPauseStartTick'))
				: this.parser.netTick
			const pausedTicks = asNum(grp.get('m_pGameRules.m_nTotalPausedTicks'))
			this.time = Math.round((timeTick - pausedTicks) / 30)
		} else {
			this.time = Math.round(asNum(oldTime))
		}

		const start = Math.round(asNum(grp.get('m_pGameRules.m_flGameStartTime')))
		if (this.gameStartTime === 0 && start !== 0) this.gameStartTime = start

		const draftStage = asNum(grp.get('m_pGameRules.m_nGameState'))
		if (draftStage === 2) this.emitDraft(grp)

		if (this.nextInterval === 0) this.nextInterval = this.time
		if (pr != null) this.emitIntervals(pr, radiant, dire, draftStage)
	}

	onEntity(entity: Entity, entered: boolean, left: boolean): void {
		if (WARD_OBS.has(entity.className)) {
			const sentry = entity.className.endsWith('TrueSight')
			const kind = sentry ? 'sen' : 'obs'
			if (entered) {
				this.push({
					type: kind,
					time: this.time,
					tick: this.parser.tick,
					x: cellPos(entity, 'X'),
					y: cellPos(entity, 'Y'),
					z: cellPos(entity, 'Z'),
					ehandle: entity.index,
				})
			}
			if (left) {
				this.push({
					type: `${kind}_left`,
					time: this.time,
					tick: this.parser.tick,
					x: cellPos(entity, 'X'),
					y: cellPos(entity, 'Y'),
					z: cellPos(entity, 'Z'),
					ehandle: entity.index,
					entityleft: true,
				})
			}
		}
		if (entered && entity.className === 'CDOTAWearableItem') {
			const itemId = asNum(entity.get('m_iItemDefinitionIndex'))
			if (itemId > 0) {
				this.push({
					type: 'cosmetics',
					time: this.time,
					tick: this.parser.tick,
					value: itemId,
				})
			}
		}
	}

	onUserMessage(type: number, data: Uint8Array): void {
		if (type === UM_COMBAT_LOG) this.onCombatLog(decodeFields(data))
		else if (type === UM_CHAT_EVENT) this.onChatEvent(decodeFields(data))
		else if (type === UM_CHAT_MESSAGE) this.onChat(decodeFields(data))
		else if (type === UM_CHAT_WHEEL) this.onChatWheel(decodeFields(data))
		else if (type === UM_LOCATION_PING) this.onPing(decodeFields(data))
		else if (type === UM_UNIT_ORDERS) this.onOrders(decodeFields(data))
	}

	onFileInfo(fields: ProtoField[]): void {
		const tick = this.parser.tick
		const pushEpi = (key: string, value: string) => {
			this.push({ type: 'epilogue', time: this.time, tick, key, value })
		}
		pushEpi('playback_time', String(protoFloat32(fields, 1) ?? 0))
		pushEpi('playback_ticks', String(num(fields, 2)))
		pushEpi('playback_frames', String(num(fields, 3)))
		const gameInfo = protoBytes(fields, 4)
		if (gameInfo == null) return
		const dota = protoBytes(decodeFields(gameInfo), 4)
		if (dota == null) return
		const info = decodeFields(dota)
		pushEpi('match_id', String(num(info, 1)))
		pushEpi('game_mode', String(num(info, 2)))
		pushEpi('game_winner', String(num(info, 3)))
		pushEpi('leagueid', String(num(info, 5)))
		pushEpi('radiant_team_id', String(num(info, 7)))
		pushEpi('dire_team_id', String(num(info, 8)))
		pushEpi('radiant_team_tag', str(info, 9))
		pushEpi('dire_team_tag', str(info, 10))
		pushEpi('end_time', String(num(info, 11)))
		pushEpi(
			'player_info',
			JSON.stringify(
				protoAllBytes(info, 4).map((blob) => {
					const row = decodeFields(blob)
					return {
						hero_name: str(row, 1),
						player_name: str(row, 2),
						is_fake_client: bool(row, 3),
						steamid: String(protoNum(row, 4) ?? 0),
						game_team: num(row, 5),
					}
				}),
			),
		)
		pushEpi(
			'picks_bans',
			JSON.stringify(
				protoAllBytes(info, 6).map((blob) => {
					const row = decodeFields(blob)
					return {
						is_pick: bool(row, 1),
						team: num(row, 2),
						hero_id: num(row, 3),
					}
				}),
			),
		)
	}

	private onCombatLog(fields: ProtoField[]): void {
		const typeId = num(fields, 1)
		if (typeId < 0) return
		const typeName = COMBAT_TYPES[typeId] ?? `DOTA_COMBATLOG_${typeId}`
		this.time = Math.round(flt(fields, 15))
		const combatName = (id: number) =>
			this.parser.lookupString('CombatLogNames', num(fields, id))
		const attacker = combatName(4)
		const target = combatName(2)
		const source = combatName(5)
		const targetSource = combatName(3)
		const inflictor = combatName(6)
		const value = num(fields, 13)
		const attackerSlot = this.heroSlot.get(attacker) ?? -1
		const targetSlot = this.heroSlot.get(target) ?? -1
		const entry: ReplayEvent = {
			type: typeName,
			time: this.time,
			tick: this.parser.tick,
			slot: attackerSlot >= 0 ? attackerSlot : targetSlot,
			attackername: attacker,
			targetname: target,
			sourcename: source,
			targetsourcename: targetSource,
			inflictor,
			attacker_slot: attackerSlot,
			target_slot: targetSlot,
			attackerillusion: bool(fields, 7),
			attackerhero: bool(fields, 8),
			targetillusion: bool(fields, 9),
			targethero: bool(fields, 10),
			visible_radiant: bool(fields, 11),
			visible_dire: bool(fields, 12),
			value,
			health: num(fields, 14),
			stun_duration: flt(fields, 16),
			slow_duration: flt(fields, 17),
			is_ability_toggle_on: bool(fields, 18),
			is_ability_toggle_off: bool(fields, 19),
			ability_level: num(fields, 20),
			location_x: flt(fields, 21),
			location_y: flt(fields, 22),
			gold_reason: num(fields, 23),
			timestamp_raw: flt(fields, 24),
			modifier_duration: flt(fields, 25),
			xp_reason: num(fields, 26),
			last_hits: num(fields, 27),
			attacker_team: num(fields, 28),
			target_team: num(fields, 29),
			obs_wards_placed: num(fields, 30),
			assist_player0: num(fields, 31),
			assist_player1: num(fields, 32),
			assist_player2: num(fields, 33),
			assist_player3: num(fields, 34),
			stack_count: num(fields, 35),
			hidden_modifier: bool(fields, 36),
			is_target_building: bool(fields, 37),
			neutral_camp_type: num(fields, 38),
			rune_type: num(fields, 39),
			assist_players: protoRepeatedInt32(fields, 40),
			is_heal_save: bool(fields, 41),
			is_ultimate_ability: bool(fields, 42),
			attacker_hero_level: num(fields, 43),
			target_hero_level: num(fields, 44),
			xpm: num(fields, 45),
			gpm: num(fields, 46),
			event_location: num(fields, 47),
			target_is_self: bool(fields, 48),
			damage_type: num(fields, 49),
			invisibility_modifier: bool(fields, 50),
			damage_category: num(fields, 51),
			networth: num(fields, 52),
			building_type: num(fields, 53),
			modifier_elapsed_duration: flt(fields, 54),
			silence_modifier: bool(fields, 55),
			heal_from_lifesteal: bool(fields, 56),
			modifier_purged: bool(fields, 57),
			spell_evaded: bool(fields, 58),
			motion_controller_modifier: bool(fields, 59),
			long_range_kill: bool(fields, 60),
			modifier_purge_ability: num(fields, 61),
			modifier_purge_npc: num(fields, 62),
			root_modifier: bool(fields, 63),
			total_unit_death_count: num(fields, 64),
			aura_modifier: bool(fields, 65),
			armor_debuff_modifier: bool(fields, 66),
			no_physical_damage_modifier: bool(fields, 67),
			modifier_ability: num(fields, 68),
			modifier_hidden: bool(fields, 69),
			inflictor_is_stolen_ability: bool(fields, 70),
			kill_eater_event: num(fields, 71),
			unit_status_label: num(fields, 72),
			spell_generated_attack: bool(fields, 73),
			at_night_time: bool(fields, 74),
			attacker_has_scepter: bool(fields, 75),
			neutral_camp_team: num(fields, 76),
			regenerated_health: flt(fields, 77),
			will_reincarnate: bool(fields, 78),
			uses_charges: bool(fields, 79),
			tracked_stat_id: num(fields, 80),
			modifier_purged_duration: flt(fields, 81),
			heal_from_regen: bool(fields, 82),
		}
		if (typeId === 11) {
			entry.valuename = this.parser.lookupString('CombatLogNames', value)
		}
		if (typeName === 'DOTA_COMBATLOG_GAME_STATE') {
			if (value === 6) this.postGame = true
			if (value === 5 && this.gameStartTime === 0)
				this.gameStartTime = this.time
		}
		this.push(entry)
		if (typeName === 'DOTA_COMBATLOG_NEUTRAL_ITEM_EARNED') {
			this.push({
				type: 'neutral_item_history',
				time: this.time,
				tick: this.parser.tick,
				slot: attackerSlot >= 0 ? attackerSlot : targetSlot,
				key: inflictor || this.parser.lookupString('CombatLogNames', value),
				value,
			})
		}
	}

	private onChatEvent(fields: ProtoField[]): void {
		const typeId = num(fields, 1)
		const name = CHAT_MESSAGES[typeId] ?? `CHAT_MESSAGE_${typeId}`
		const player1 = protoSint32(fields, 3) ?? -1
		this.push({
			type: name,
			time: this.time,
			tick: this.parser.tick,
			player1,
			player2: protoSint32(fields, 4) ?? -1,
			player3: protoSint32(fields, 5) ?? -1,
			player4: protoSint32(fields, 6) ?? -1,
			player5: protoSint32(fields, 7) ?? -1,
			player6: protoSint32(fields, 8) ?? -1,
			value: num(fields, 2),
			value2: num(fields, 9),
			value3: num(fields, 10),
			slot: player1,
		})
	}

	private onChat(fields: ProtoField[]): void {
		this.push({
			type: 'chat',
			time: this.time,
			tick: this.parser.tick,
			slot: num(fields, 1),
			channel: num(fields, 2),
			key: str(fields, 3),
			unit: '',
		})
	}

	private onChatWheel(fields: ProtoField[]): void {
		this.push({
			type: 'chatwheel',
			time: this.time,
			tick: this.parser.tick,
			slot: num(fields, 2),
			key: String(num(fields, 1)),
		})
	}

	private onPing(fields: ProtoField[]): void {
		const ping = protoBytes(fields, 2)
		const inner = ping != null ? decodeFields(ping) : []
		this.push({
			type: 'pings',
			time: this.time,
			tick: this.parser.tick,
			slot: num(fields, 1),
			x: num(inner, 1),
			y: num(inner, 2),
		})
	}

	private onOrders(fields: ProtoField[]): void {
		this.push({
			type: 'actions',
			time: this.time,
			tick: this.parser.tick,
			key: num(fields, 2),
		})
	}

	private emitDraft(grp: Entity): void {
		for (let i = 0; i < 24; i++) {
			const pick = i >= 14
			const idx = pick ? i - 14 : i
			const hero = asNum(
				grp.get(
					pick
						? `m_pGameRules.m_SelectedHeroes.${pad4(idx)}`
						: `m_pGameRules.m_BannedHeroes.${pad4(idx)}`,
				),
			)
			if (hero <= 0 || this.draftSeen.has(i)) continue
			this.draftSeen.add(i)
			this.push({
				type: 'draft_timings',
				time: this.time,
				tick: this.parser.tick,
				draft_order: this.draftOrder,
				pick,
				hero_id: hero,
				draft_active_team: asNum(grp.get('m_pGameRules.m_iActiveTeam')),
				draft_extime0: Math.round(
					asNum(grp.get('m_pGameRules.m_fExtraTimeRemaining.0000')),
				),
				draft_extime1: Math.round(
					asNum(grp.get('m_pGameRules.m_fExtraTimeRemaining.0001')),
				),
			})
			this.draftOrder += 1
		}
	}

	private emitIntervals(
		pr: Entity,
		radiant: Entity | undefined,
		dire: Entity | undefined,
		draftStage: number,
	): void {
		if (!this.initPlayers) {
			const indices: number[] = []
			for (let i = 0; i < 30 && indices.length < 10; i++) {
				const team = asNum(pr.get(`m_vecPlayerData.${pad4(i)}.m_iPlayerTeam`))
				if (team === 2 || team === 3) indices.push(i)
			}
			if (indices.length >= 10) {
				this.validIndices = indices
				this.initPlayers = true
			}
		}
		if (!this.initPlayers || this.postGame || this.time < this.nextInterval) {
			return
		}
		for (let slot = 0; slot < this.validIndices.length; slot++) {
			const i = this.validIndices[slot]
			if (i == null) continue
			const team = asNum(pr.get(`m_vecPlayerData.${pad4(i)}.m_iPlayerTeam`))
			const teamSlot = asNum(
				pr.get(`m_vecPlayerTeamData.${pad4(i)}.m_iTeamSlot`),
			)
			const dataTeam = team === 2 ? radiant : dire
			const handle = asNum(
				pr.get(`m_vecPlayerTeamData.${pad4(i)}.m_hSelectedHero`),
			)
			const heroEnt = this.parser.findByHandle(handle)
			const unit = heroEnt?.className ?? ''
			if (unit.startsWith('CDOTA_Unit_Hero_')) {
				this.heroSlot.set(
					`npc_dota_hero_${unit.slice('CDOTA_Unit_Hero_'.length).toLowerCase()}`,
					slot,
				)
			}
			const heroId = asNum(
				pr.get(`m_vecPlayerTeamData.${pad4(i)}.m_nSelectedHeroID`),
			)
			let variant = asNum(
				pr.get(`m_vecPlayerTeamData.${pad4(i)}.m_nSelectedHeroVariant`),
			)
			let facetHeroId = 0
			if (heroEnt != null) {
				const facetKey = asNum(heroEnt.get('m_iHeroFacetKey'))
				if (facetKey !== 0) {
					facetHeroId = Math.floor(facetKey / 2 ** 32)
					variant = facetKey & 0xff
				}
			}
			const ts = pad4(teamSlot)
			const entry: ReplayEvent = {
				type: 'interval',
				time: this.time,
				tick: this.parser.tick,
				slot,
				hero_id: heroId,
				variant,
				facet_hero_id: facetHeroId,
				unit,
				x: heroEnt != null ? cellPos(heroEnt, 'X') : 0,
				y: heroEnt != null ? cellPos(heroEnt, 'Y') : 0,
				gold: asNum(dataTeam?.get(`m_vecDataTeam.${ts}.m_iTotalEarnedGold`)),
				lh: asNum(dataTeam?.get(`m_vecDataTeam.${ts}.m_iLastHitCount`)),
				xp: asNum(dataTeam?.get(`m_vecDataTeam.${ts}.m_iTotalEarnedXP`)),
				networth: asNum(dataTeam?.get(`m_vecDataTeam.${ts}.m_iNetWorth`)),
				denies: asNum(dataTeam?.get(`m_vecDataTeam.${ts}.m_iDenyCount`)),
				level: asNum(pr.get(`m_vecPlayerTeamData.${pad4(i)}.m_iLevel`)),
				kills: asNum(pr.get(`m_vecPlayerTeamData.${pad4(i)}.m_iKills`)),
				deaths: asNum(pr.get(`m_vecPlayerTeamData.${pad4(i)}.m_iDeaths`)),
				assists: asNum(pr.get(`m_vecPlayerTeamData.${pad4(i)}.m_iAssists`)),
				life_state: asNum(heroEnt?.get('m_lifeState')),
				stuns: asNum(dataTeam?.get(`m_vecDataTeam.${ts}.m_fStuns`)),
				obs_placed: asNum(
					dataTeam?.get(`m_vecDataTeam.${ts}.m_iObserverWardsPlaced`),
				),
				sen_placed: asNum(
					dataTeam?.get(`m_vecDataTeam.${ts}.m_iSentryWardsPlaced`),
				),
				creeps_stacked: asNum(
					dataTeam?.get(`m_vecDataTeam.${ts}.m_iCreepsStacked`),
				),
				camps_stacked: asNum(
					dataTeam?.get(`m_vecDataTeam.${ts}.m_iCampsStacked`),
				),
				rune_pickups: asNum(
					dataTeam?.get(`m_vecDataTeam.${ts}.m_iRunePickups`),
				),
				towers_killed: asNum(
					dataTeam?.get(`m_vecDataTeam.${ts}.m_iTowerKills`),
				),
				roshans_killed: asNum(
					dataTeam?.get(`m_vecDataTeam.${ts}.m_iRoshanKills`),
				),
				teamfight_participation: asNum(
					pr.get(`m_vecPlayerTeamData.${pad4(i)}.m_flTeamFightParticipation`),
				),
				firstblood_claimed: asNum(
					pr.get(`m_vecPlayerTeamData.${pad4(i)}.m_iFirstBloodClaimed`),
				),
				stage: draftStage,
				repicked: Boolean(
					pr.get(`m_vecPlayerTeamData.${pad4(i)}.m_bHasRepicked`),
				),
				randomed: Boolean(
					pr.get(`m_vecPlayerTeamData.${pad4(i)}.m_bHasRandomed`),
				),
				pred_vict: Boolean(
					pr.get(`m_vecPlayerTeamData.${pad4(i)}.m_bHasPredictedVictory`),
				),
				observers_placed: asNum(
					dataTeam?.get(`m_vecDataTeam.${ts}.m_iObserverWardsPlaced`),
				),
			}
			this.push(entry)
			if (heroEnt != null && unit.startsWith('CDOTA_Unit_Hero_')) {
				this.emitAbilitiesAndItems(heroEnt, slot, unit)
			}
		}
		this.nextInterval += 1
	}

	private emitAbilitiesAndItems(
		hero: Entity,
		slot: number,
		unit: string,
	): void {
		const ending = unit.slice('CDOTA_Unit_Hero_'.length)
		const combatName = `npc_dota_hero_${ending.toLowerCase()}`
		for (let i = 0; i < 32; i++) {
			const handle = asNum(hero.get(`m_hAbilities.${pad4(i)}`))
			if (handle === 0 || handle === 0xffffff) continue
			const ability = this.parser.findByHandle(handle)
			if (ability == null) continue
			const nameIdx = asNum(ability.get('m_pEntity.m_nameStringableIndex'))
			const id = this.parser.lookupString('EntityNames', nameIdx)
			const level = asNum(ability.get('m_iLevel'))
			const key = `${combatName}${id}`
			if (this.abilityLevels.get(key) === level) continue
			this.abilityLevels.set(key, level)
			this.push({
				type: 'DOTA_ABILITY_LEVEL',
				time: this.time,
				tick: this.parser.tick,
				targetname: combatName,
				valuename: id,
				abilitylevel: level,
			})
		}
		if (
			this.gameStartTime > 0 &&
			this.time - this.gameStartTime <= 1 &&
			!this.startingWritten.has(slot)
		) {
			this.startingWritten.add(slot)
			for (let i = 0; i < 8; i++) {
				const handle = asNum(hero.get(`m_hItems.${pad4(i)}`))
				if (handle === 0 || handle === 0xffffff) continue
				const item = this.parser.findByHandle(handle)
				if (item == null) continue
				const nameIdx = asNum(item.get('m_pEntity.m_nameStringableIndex'))
				const id = this.parser.lookupString('EntityNames', nameIdx)
				this.push({
					type: 'STARTING_ITEM',
					time: this.time,
					tick: this.parser.tick,
					slot,
					targetname: combatName,
					valuename: id,
					itemslot: i,
					charges: asNum(item.get('m_iCurrentCharges')),
					secondary_charges: asNum(item.get('m_iSecondaryCharges')),
					value: (slot < 5 ? 0 : 123) + slot,
				})
			}
		}
	}

	private push(entry: ReplayEvent): void {
		this.events.push(entry)
	}

	finalize(): void {
		if (this.parser.tick === 0) return
		if (this.events.some((entry) => entry.type === 'epilogue')) return
		this.push({
			type: 'epilogue',
			time: this.time,
			tick: this.parser.tick,
			key: 'playback_ticks',
			value: String(this.parser.tick),
		})
	}
}
