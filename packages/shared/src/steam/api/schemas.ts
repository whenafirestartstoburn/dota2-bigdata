import { z } from 'zod'

const intOrText = z.union([z.string(), z.number()])

export const leagueInfoSchema = z.object({
	league_id: z.number(),
	name: z.string().default(''),
	tier: z.number().default(0),
	region: z.number().default(0),
	most_recent_activity: z.number().default(0),
	total_prize_pool: z.number().default(0),
	start_timestamp: z.number().default(0),
	end_timestamp: z.number().default(0),
	status: z.number().default(0),
})

export const leagueInfoListSchema = z.object({
	infos: z.array(z.unknown()).default([]),
})

export const livePlayerSchema = z.object({
	account_id: z.number(),
	hero_id: z.number().default(0),
	name: z.string().default(''),
	team: z.number(),
})

export const liveTeamSchema = z.object({
	team_id: z.number(),
	team_name: z.string().default(''),
	team_logo: intOrText.optional(),
	complete: z.boolean().optional(),
})

export const liveDraftHeroSchema = z.object({
	hero_id: z.number(),
})

export const liveScoreboardPlayerSchema = z.object({
	player_slot: z.number().optional(),
	account_id: z.number().optional(),
	hero_id: z.number().optional(),
	kills: z.number().optional(),
	death: z.number().optional(),
	deaths: z.number().optional(),
	assists: z.number().optional(),
	last_hits: z.number().optional(),
	denies: z.number().optional(),
	gold: z.number().optional(),
	level: z.number().optional(),
	gold_per_min: z.number().optional(),
	xp_per_min: z.number().optional(),
	ultimate_state: z.number().optional(),
	ultimate_cooldown: z.number().optional(),
	item0: z.number().optional(),
	item1: z.number().optional(),
	item2: z.number().optional(),
	item3: z.number().optional(),
	item4: z.number().optional(),
	item5: z.number().optional(),
	item_0: z.number().optional(),
	item_1: z.number().optional(),
	item_2: z.number().optional(),
	item_3: z.number().optional(),
	item_4: z.number().optional(),
	item_5: z.number().optional(),
	respawn_timer: z.number().optional(),
	position_x: z.number().optional(),
	position_y: z.number().optional(),
	x: z.number().optional(),
	y: z.number().optional(),
	net_worth: z.number().optional(),
	name: z.string().optional(),
})

export const liveAbilitySchema = z.object({
	ability_id: z.number().optional(),
	ability_level: z.number().optional(),
})

export const liveSideScoreboardSchema = z.object({
	score: z.number().optional(),
	tower_state: z.number().optional(),
	barracks_state: z.number().optional(),
	picks: z.array(liveDraftHeroSchema).optional(),
	bans: z.array(liveDraftHeroSchema).optional(),
	players: z.array(z.unknown()).optional(),
	abilities: z.array(liveAbilitySchema).optional(),
})

export const liveScoreboardSchema = z.object({
	duration: z.number().optional(),
	roshan_respawn_timer: z.number().optional(),
	radiant: liveSideScoreboardSchema.optional(),
	dire: liveSideScoreboardSchema.optional(),
})

export const liveLeagueGameSchema = z.object({
	match_id: z.number(),
	league_id: z.number().default(0),
	league_node_id: z.number().default(0),
	series_id: z.number().optional(),
	series_type: z.number().default(0),
	dire_series_wins: z.number().default(0),
	radiant_series_wins: z.number().default(0),
	stream_delay_s: z.number().default(0),
	lobby_id: intOrText.optional(),
	spectators: z.number().optional(),
	game_number: z.number().optional(),
	league_series_id: z.number().optional(),
	league_game_id: z.number().optional(),
	stage_name: z.string().optional(),
	league_tier: z.number().optional(),
	players: z.array(livePlayerSchema).default([]),
	radiant_team: liveTeamSchema.optional(),
	dire_team: liveTeamSchema.optional(),
	scoreboard: liveScoreboardSchema.optional(),
})

export const liveLeagueGamesResponseSchema = z.object({
	result: z.object({
		status: z.number().optional(),
		games: z.array(z.unknown()).optional().default([]),
	}),
})

export const historyPlayerSchema = z.object({
	account_id: z.number(),
	player_slot: z.number(),
	hero_id: z.number().default(0),
	team_number: z.number().optional(),
	team_slot: z.number().optional(),
	hero_variant: z.number().optional(),
})

export const historyMatchSchema = z.object({
	match_id: z.number(),
	match_seq_num: z.number(),
	start_time: z.number().default(0),
	lobby_type: z.number().default(0),
	series_id: z.number().optional(),
	series_type: z.number().optional(),
	radiant_team_id: z.number().optional(),
	dire_team_id: z.number().optional(),
	players: z.array(z.unknown()).default([]),
})

export const matchHistoryResponseSchema = z.object({
	result: z.object({
		status: z.number(),
		num_results: z.number().optional(),
		total_results: z.number().optional(),
		results_remaining: z.number().optional(),
		matches: z.array(z.unknown()).default([]),
		statusDetail: z.string().optional(),
	}),
})

export const seqMatchSchema = z.object({
	match_id: z.number(),
	match_seq_num: z.number(),
	start_time: z.number().optional(),
	starttime: z.number().optional(),
	leagueid: z.number().optional(),
	league_id: z.number().optional(),
	radiant_win: z.boolean().optional(),
	duration: z.number().optional(),
	pre_game_duration: z.number().optional(),
	lobby_type: z.number().optional(),
	game_mode: z.number().optional(),
	cluster: z.number().optional(),
	engine: z.number().optional(),
	human_players: z.number().optional(),
	radiant_score: z.number().optional(),
	dire_score: z.number().optional(),
	tower_status_radiant: z.number().optional(),
	tower_status_dire: z.number().optional(),
	barracks_status_radiant: z.number().optional(),
	barracks_status_dire: z.number().optional(),
	first_blood_time: z.number().optional(),
	replay_salt: z.number().optional(),
	series_id: z.number().optional(),
	series_type: z.number().optional(),
	radiant_team_id: z.number().optional(),
	dire_team_id: z.number().optional(),
	radiant_name: z.string().optional(),
	dire_name: z.string().optional(),
	radiant_logo: intOrText.optional(),
	dire_logo: intOrText.optional(),
	radiant_team_complete: z.union([z.number(), z.boolean()]).optional(),
	dire_team_complete: z.union([z.number(), z.boolean()]).optional(),
	radiant_captain: z.number().optional(),
	dire_captain: z.number().optional(),
	flags: z.number().optional(),
	match_flags: z.number().optional(),
	players: z.array(z.unknown()).optional(),
	picks_bans: z.array(z.unknown()).optional(),
})

export const seqResponseSchema = z.object({
	result: z.object({
		status: z.number(),
		matches: z.array(z.unknown()).default([]),
		statusDetail: z.string().optional(),
	}),
})

export const topLiveGamesResponseSchema = z.object({
	search_key: z.string().optional(),
	league_id: z.number().optional(),
	hero_id: z.number().optional(),
	start_game: z.number().optional(),
	num_games: z.number().optional(),
	game_list_index: z.number().optional(),
	specific_games: z.union([z.number(), z.boolean()]).optional(),
	bot_game: z.union([z.number(), z.boolean()]).optional(),
	game_list: z.array(z.unknown()).default([]),
})

export const topLiveGameEntrySchema = z.object({
	match_id: intOrText,
	server_steam_id: intOrText,
	league_id: z.number(),
	delay: z.number().default(0),
	lobby_id: intOrText.optional(),
	spectators: z.number().optional(),
	game_time: z.number().optional(),
	game_mode: z.number().optional(),
	series_id: z.number().optional(),
	team_name_radiant: z.string().optional(),
	team_name_dire: z.string().optional(),
	team_id_radiant: z.number().optional(),
	team_id_dire: z.number().optional(),
	radiant_score: z.number().optional(),
	dire_score: z.number().optional(),
	average_mmr: z.number().optional(),
	activate_time: z.number().optional(),
	deactivate_time: z.number().optional(),
	lobby_type: z.number().optional(),
	sort_score: z.number().optional(),
	last_update_time: z.number().optional(),
	radiant_lead: z.number().optional(),
	building_state: z.number().optional(),
	is_player_draft: z.union([z.number(), z.boolean()]).optional(),
	is_watch_eligible: z.union([z.number(), z.boolean()]).optional(),
	players: z.array(z.unknown()).optional(),
})

export const realtimePickBanSchema = z.object({
	team: z.number(),
	hero: z.number(),
})

export const realtimeMatchSchema = z.object({
	match_id: intOrText,
	game_state: z.number().optional(),
	game_time: z.number().optional(),
	league_id: z.number(),
	league_node_id: z.number().optional(),
	node_id: z.number().optional(),
	server_steam_id: intOrText.optional(),
	timestamp: z.number().optional(),
	start_timestamp: z.number().optional(),
	lobby_type: z.number().optional(),
	game_mode: z.number().optional(),
	is_player_draft: z.union([z.number(), z.boolean()]).optional(),
	picks: z.array(realtimePickBanSchema).optional(),
	bans: z.array(realtimePickBanSchema).optional(),
})

export const realtimeTeamPlayerSchema = z.object({
	accountid: z.number().optional(),
	account_id: z.number().optional(),
	playerid: z.number().optional(),
	name: z.string().optional(),
	team: z.number().optional(),
	team_slot: z.number().optional(),
	heroid: z.number().optional(),
	hero_id: z.number().optional(),
	level: z.number().optional(),
	kill_count: z.number().optional(),
	death_count: z.number().optional(),
	assists_count: z.number().optional(),
	denies_count: z.number().optional(),
	lh_count: z.number().optional(),
	kills: z.number().optional(),
	deaths: z.number().optional(),
	assists: z.number().optional(),
	last_hits: z.number().optional(),
	denies: z.number().optional(),
	gold: z.number().optional(),
	net_worth: z.number().optional(),
	x: z.number().optional(),
	y: z.number().optional(),
	items: z.array(z.number()).optional(),
	abilities: z.array(z.number()).optional(),
})

export const realtimeTeamSchema = z.object({
	team_number: z.number(),
	team_id: z.number().optional(),
	team_name: z.string().optional(),
	team_tag: z.string().optional(),
	team_logo: intOrText.optional(),
	team_logo_url: z.string().optional(),
	score: z.number().optional(),
	net_worth: z.number().optional(),
	players: z.array(z.unknown()).optional(),
})

export const realtimeStatsResponseSchema = z.object({
	match: realtimeMatchSchema,
	teams: z.array(z.unknown()).default([]),
	buildings: z.array(z.unknown()).optional(),
	delta_frame: z.union([z.number(), z.boolean()]).optional(),
	graph_data: z
		.object({
			graph_gold: z.array(z.number()).optional(),
		})
		.optional(),
})

export type LeagueInfo = z.infer<typeof leagueInfoSchema>
export type LiveLeagueGame = z.infer<typeof liveLeagueGameSchema>
export type LiveScoreboardPlayer = z.infer<typeof liveScoreboardPlayerSchema>
export type HistoryMatch = z.infer<typeof historyMatchSchema>
export type HistoryPlayer = z.infer<typeof historyPlayerSchema>
export type SeqMatch = z.infer<typeof seqMatchSchema>
export type TopLiveGameEntry = z.infer<typeof topLiveGameEntrySchema>
export type RealtimeStatsResponse = z.infer<typeof realtimeStatsResponseSchema>
export type RealtimeTeam = z.infer<typeof realtimeTeamSchema>
export type RealtimeTeamPlayer = z.infer<typeof realtimeTeamPlayerSchema>
