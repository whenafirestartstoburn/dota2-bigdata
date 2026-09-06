import { z } from 'zod'

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
	team_logo: z.union([z.string(), z.number()]).optional(),
	complete: z.boolean().optional(),
})

export const liveSideScoreboardSchema = z.object({
	score: z.number().optional(),
	tower_state: z.number().optional(),
	barracks_state: z.number().optional(),
	picks: z.array(z.object({ hero_id: z.number() })).optional(),
	bans: z.array(z.object({ hero_id: z.number() })).optional(),
	players: z.array(z.unknown()).optional(),
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
	lobby_id: z.union([z.string(), z.number()]).optional(),
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
		games: z.array(z.unknown()).optional().default([]),
	}),
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
})

export const seqResponseSchema = z.object({
	result: z.object({
		status: z.number(),
		matches: z.array(z.unknown()).default([]),
		statusDetail: z.string().optional(),
	}),
})

export const topLiveGamesResponseSchema = z.object({
	game_list: z.array(z.unknown()).default([]),
})

export const topLiveGameEntrySchema = z.object({
	match_id: z.union([z.string(), z.number()]),
	server_steam_id: z.union([z.string(), z.number()]),
	league_id: z.number(),
	delay: z.number().default(0),
})

export const realtimePickBanSchema = z.object({
	team: z.number(),
	hero: z.number(),
})

export const realtimeMatchSchema = z.object({
	match_id: z.union([z.string(), z.number()]),
	game_state: z.number().optional(),
	game_time: z.number().optional(),
	league_id: z.number(),
	league_node_id: z.number().optional(),
	server_steam_id: z.union([z.string(), z.number()]).optional(),
	picks: z.array(realtimePickBanSchema).optional(),
	bans: z.array(realtimePickBanSchema).optional(),
})

export const realtimeStatsResponseSchema = z.object({
	match: realtimeMatchSchema,
	teams: z.array(z.unknown()).default([]),
})

export type LeagueInfo = z.infer<typeof leagueInfoSchema>
export type LiveLeagueGame = z.infer<typeof liveLeagueGameSchema>
export type HistoryMatch = z.infer<typeof historyMatchSchema>
export type TopLiveGameEntry = z.infer<typeof topLiveGameEntrySchema>
export type RealtimeStatsResponse = z.infer<typeof realtimeStatsResponseSchema>
