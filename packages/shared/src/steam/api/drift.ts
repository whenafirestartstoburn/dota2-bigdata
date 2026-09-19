export type DriftSpec = {
	required?: string[]
	optional?: string[]
	objects?: Record<string, DriftSpec>
	arrays?: Record<string, DriftSpec>
}

export type SchemaDrift = {
	extra: string[]
	missing: string[]
}

export const SCHEMA_DRIFT_COOLDOWN_MS = 60 * 60 * 1000

function joinPath(path: string, key: string): string {
	return path === '' ? key : `${path}.${key}`
}

function knownKeys(spec: DriftSpec): Set<string> {
	return new Set([
		...(spec.required ?? []),
		...(spec.optional ?? []),
		...Object.keys(spec.objects ?? {}),
		...Object.keys(spec.arrays ?? {}),
	])
}

function walk(
	value: unknown,
	spec: DriftSpec,
	path: string,
	extra: string[],
	missing: string[],
): void {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		for (const key of spec.required ?? []) {
			missing.push(joinPath(path, key))
		}
		return
	}
	const rec = value as Record<string, unknown>
	const known = knownKeys(spec)
	for (const key of Object.keys(rec)) {
		if (!known.has(key)) extra.push(joinPath(path, key))
	}
	for (const key of spec.required ?? []) {
		if (!Object.hasOwn(rec, key)) missing.push(joinPath(path, key))
	}
	for (const [key, child] of Object.entries(spec.objects ?? {})) {
		if (!Object.hasOwn(rec, key) || rec[key] == null) continue
		walk(rec[key], child, joinPath(path, key), extra, missing)
	}
	for (const [key, child] of Object.entries(spec.arrays ?? {})) {
		const items = rec[key]
		if (!Array.isArray(items) || items.length === 0) continue
		for (let i = 0; i < items.length; i++) {
			walk(items[i], child, `${joinPath(path, key)}[${i}]`, extra, missing)
		}
	}
}

export function findSchemaDrift(
	value: unknown,
	spec: DriftSpec,
): SchemaDrift | null {
	const extra: string[] = []
	const missing: string[] = []
	walk(value, spec, '', extra, missing)
	const uniqueExtra = [...new Set(extra)]
	const uniqueMissing = [...new Set(missing)]
	if (uniqueExtra.length === 0 && uniqueMissing.length === 0) return null
	return { extra: uniqueExtra, missing: uniqueMissing }
}

const leagueInfoSpec: DriftSpec = {
	required: ['league_id'],
	optional: [
		'name',
		'tier',
		'region',
		'most_recent_activity',
		'total_prize_pool',
		'start_timestamp',
		'end_timestamp',
		'status',
	],
}

const livePlayerSpec: DriftSpec = {
	required: ['account_id', 'team'],
	optional: ['hero_id', 'name'],
}

const liveTeamSpec: DriftSpec = {
	required: ['team_id'],
	optional: ['team_name', 'team_logo', 'complete'],
}

const liveDraftHeroSpec: DriftSpec = {
	required: ['hero_id'],
}

const liveAbilitySpec: DriftSpec = {
	optional: ['ability_id', 'ability_level'],
}

const liveScoreboardPlayerSpec: DriftSpec = {
	optional: [
		'player_slot',
		'account_id',
		'hero_id',
		'kills',
		'death',
		'deaths',
		'assists',
		'last_hits',
		'denies',
		'gold',
		'level',
		'gold_per_min',
		'xp_per_min',
		'ultimate_state',
		'ultimate_cooldown',
		'item0',
		'item1',
		'item2',
		'item3',
		'item4',
		'item5',
		'item_0',
		'item_1',
		'item_2',
		'item_3',
		'item_4',
		'item_5',
		'respawn_timer',
		'position_x',
		'position_y',
		'x',
		'y',
		'net_worth',
		'name',
	],
}

const liveSideSpec: DriftSpec = {
	optional: ['score', 'tower_state', 'barracks_state'],
	arrays: {
		picks: liveDraftHeroSpec,
		bans: liveDraftHeroSpec,
		players: liveScoreboardPlayerSpec,
		abilities: liveAbilitySpec,
	},
}

const liveScoreboardSpec: DriftSpec = {
	optional: ['duration', 'roshan_respawn_timer'],
	objects: { radiant: liveSideSpec, dire: liveSideSpec },
}

const liveLeagueGameSpec: DriftSpec = {
	required: ['match_id'],
	optional: [
		'league_id',
		'league_node_id',
		'series_id',
		'series_type',
		'dire_series_wins',
		'radiant_series_wins',
		'stream_delay_s',
		'lobby_id',
		'spectators',
		'game_number',
		'league_series_id',
		'league_game_id',
		'stage_name',
		'league_tier',
	],
	arrays: { players: livePlayerSpec },
	objects: {
		radiant_team: liveTeamSpec,
		dire_team: liveTeamSpec,
		scoreboard: liveScoreboardSpec,
	},
}

const historyPlayerSpec: DriftSpec = {
	required: ['account_id', 'player_slot'],
	optional: ['hero_id', 'team_number', 'team_slot', 'hero_variant'],
}

const historyMatchSpec: DriftSpec = {
	required: ['match_id', 'match_seq_num'],
	optional: [
		'start_time',
		'lobby_type',
		'series_id',
		'series_type',
		'radiant_team_id',
		'dire_team_id',
	],
	arrays: { players: historyPlayerSpec },
}

const seqMatchSpec: DriftSpec = {
	required: ['match_id', 'match_seq_num'],
	optional: [
		'start_time',
		'starttime',
		'leagueid',
		'league_id',
		'radiant_win',
		'duration',
		'pre_game_duration',
		'lobby_type',
		'game_mode',
		'cluster',
		'engine',
		'human_players',
		'radiant_score',
		'dire_score',
		'tower_status_radiant',
		'tower_status_dire',
		'barracks_status_radiant',
		'barracks_status_dire',
		'first_blood_time',
		'replay_salt',
		'series_id',
		'series_type',
		'radiant_team_id',
		'dire_team_id',
		'radiant_name',
		'dire_name',
		'radiant_logo',
		'dire_logo',
		'radiant_team_complete',
		'dire_team_complete',
		'radiant_captain',
		'dire_captain',
		'flags',
		'match_flags',
		'positive_votes',
		'negative_votes',
		'players',
		'picks_bans',
	],
}

const topLiveGameSpec: DriftSpec = {
	required: ['match_id', 'server_steam_id', 'league_id'],
	optional: [
		'delay',
		'lobby_id',
		'spectators',
		'game_time',
		'game_mode',
		'series_id',
		'team_name_radiant',
		'team_name_dire',
		'team_logo_radiant',
		'team_logo_dire',
		'team_id_radiant',
		'team_id_dire',
		'radiant_score',
		'dire_score',
		'average_mmr',
		'activate_time',
		'deactivate_time',
		'lobby_type',
		'sort_score',
		'last_update_time',
		'radiant_lead',
		'building_state',
		'weekend_tourney_tournament_id',
		'weekend_tourney_division',
		'weekend_tourney_skill_level',
		'weekend_tourney_bracket_round',
		'custom_game_difficulty',
		'is_player_draft',
		'is_watch_eligible',
		'players',
	],
}

const realtimePickBanSpec: DriftSpec = {
	required: ['team', 'hero'],
}

const realtimeTeamPlayerSpec: DriftSpec = {
	optional: [
		'accountid',
		'account_id',
		'playerid',
		'name',
		'team',
		'team_slot',
		'heroid',
		'hero_id',
		'level',
		'kill_count',
		'death_count',
		'assists_count',
		'denies_count',
		'lh_count',
		'kills',
		'deaths',
		'assists',
		'last_hits',
		'denies',
		'gold',
		'net_worth',
		'x',
		'y',
		'items',
		'abilities',
	],
}

const realtimeTeamSpec: DriftSpec = {
	required: ['team_number'],
	optional: [
		'team_id',
		'team_name',
		'team_tag',
		'team_logo',
		'team_logo_url',
		'score',
		'net_worth',
	],
	arrays: { players: realtimeTeamPlayerSpec },
}

export const STEAM_API_DRIFT: Record<string, DriftSpec> = {
	GetLeagueInfoList: {
		required: ['infos'],
		arrays: { infos: leagueInfoSpec },
	},
	GetLiveLeagueGames: {
		required: ['result'],
		objects: {
			result: {
				optional: ['status', 'games'],
				arrays: { games: liveLeagueGameSpec },
			},
		},
	},
	GetMatchHistory: {
		required: ['result'],
		objects: {
			result: {
				required: ['status'],
				optional: [
					'num_results',
					'total_results',
					'results_remaining',
					'statusDetail',
				],
				arrays: { matches: historyMatchSpec },
			},
		},
	},
	GetMatchHistoryBySequenceNum: {
		required: ['result'],
		objects: {
			result: {
				required: ['status'],
				optional: ['statusDetail'],
				arrays: { matches: seqMatchSpec },
			},
		},
	},
	GetTopLiveGame: {
		optional: [
			'game_list',
			'search_key',
			'league_id',
			'hero_id',
			'start_game',
			'num_games',
			'game_list_index',
			'specific_games',
			'bot_game',
		],
		arrays: { game_list: topLiveGameSpec },
	},
	GetRealtimeStats: {
		required: ['match'],
		optional: ['buildings', 'graph_data'],
		objects: {
			match: {
				required: ['match_id', 'league_id'],
				optional: [
					'game_state',
					'game_time',
					'league_node_id',
					'node_id',
					'server_steam_id',
					'timestamp',
					'start_timestamp',
					'lobby_type',
					'game_mode',
					'is_player_draft',
				],
				arrays: {
					picks: realtimePickBanSpec,
					bans: realtimePickBanSpec,
				},
			},
			graph_data: { optional: ['graph_gold'] },
		},
		arrays: { teams: realtimeTeamSpec },
	},
}
