// Снято с Postgres `bun run db:pull`. DDL — db/migrations, не этот файл.

import { sql } from 'drizzle-orm'
import {
	bigint,
	bigserial,
	boolean,
	check,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	real,
	smallint,
	text,
	timestamp,
	unique,
	uuid,
} from 'drizzle-orm/pg-core'

export const league_lifecycle = pgEnum('league_lifecycle', [
	'UPCOMING',
	'LIVE',
	'FINISHED',
])
export const resource_status = pgEnum('resource_status', [
	'ready',
	'active',
	'rate_limited',
	'disabled',
])
export const proxy_kind = pgEnum('proxy_kind', ['http', 'socks5'])
export const proxy_purpose = pgEnum('proxy_purpose', ['api', 'gc', 'both'])
export const match_phase = pgEnum('match_phase', [
	'discovered',
	'live',
	'awaiting_details',
	'details_ready',
	'awaiting_replay',
	'replay_stored',
	'replay_unavailable',
	'failed',
	'awaiting_history',
	'parsed',
	'not_started',
])
export const match_source = pgEnum('match_source', ['live', 'historical'])
export const replay_priority = pgEnum('replay_priority', ['live', 'historical'])
export const replay_status = pgEnum('replay_status', [
	'pending',
	'awaiting_gc',
	'downloading',
	'stored',
	'parsing',
	'parsed',
	'unavailable',
	'failed',
])
export const ingest_run_status = pgEnum('ingest_run_status', [
	'queued',
	'running',
	'succeeded',
	'failed',
])
export const marketplace_store = pgEnum('marketplace_store', ['dark_shopping'])
export const account_purchase_kind = pgEnum('account_purchase_kind', [
	'api_key',
	'gc',
])
export const marketplace_order_status = pgEnum('marketplace_order_status', [
	'pending',
	'success',
	'failed',
])
export const resource_kind = pgEnum('resource_kind', [
	'proxy',
	'gc_account',
	'api_key',
])

export const abilities = pgTable(
	'abilities',
	{
		ability_id: integer().notNull(),
		name: text().notNull(),
		localized_name: text().default('').notNull(),
		kind: text().notNull(),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		id: bigserial({ mode: 'number' }).primaryKey(),
	},
	(table) => [
		unique('abilities_ability_id_key').on(table.ability_id),
		check(
			'abilities_kind_check',
			sql`(kind = ANY (ARRAY['spell'::text, 'talent'::text, 'innate'::text, 'item'::text, 'other'::text]))`,
		),
	],
)

export const clusters = pgTable(
	'clusters',
	{
		cluster: integer().notNull(),
		region: integer().references(() => regions.region, {
			onDelete: 'set null',
		}),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		id: bigserial({ mode: 'number' }).primaryKey(),
	},
	(table) => [unique('clusters_cluster_key').on(table.cluster)],
)

export const game_modes = pgTable(
	'game_modes',
	{
		game_mode: integer().notNull(),
		name: text().notNull(),
		balanced: boolean(),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		id: bigserial({ mode: 'number' }).primaryKey(),
	},
	(table) => [unique('game_modes_game_mode_key').on(table.game_mode)],
)

export const hero_abilities = pgTable(
	'hero_abilities',
	{
		hero_id: integer()
			.notNull()
			.references(() => heroes.hero_id, { onDelete: 'cascade' }),
		ability_id: integer()
			.notNull()
			.references(() => abilities.ability_id, { onDelete: 'cascade' }),
		slot: integer().notNull(),
		is_talent: boolean().default(false).notNull(),
		talent_level: integer(),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		id: bigserial({ mode: 'number' }).primaryKey(),
	},
	(table) => [
		unique('hero_abilities_hero_id_slot_is_talent_key').on(
			table.hero_id,
			table.slot,
			table.is_talent,
		),
	],
)

export const hero_facets = pgTable(
	'hero_facets',
	{
		hero_id: integer()
			.notNull()
			.references(() => heroes.hero_id, { onDelete: 'cascade' }),
		facet_id: integer().notNull(),
		name: text().notNull(),
		localized_name: text().default('').notNull(),
		icon: text(),
		color: text(),
		deprecated: boolean().default(false).notNull(),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		id: bigserial({ mode: 'number' }).primaryKey(),
	},
	(table) => [
		unique('hero_facets_hero_id_facet_id_key').on(
			table.hero_id,
			table.facet_id,
		),
	],
)

export const heroes = pgTable(
	'heroes',
	{
		hero_id: integer().notNull(),
		name: text().notNull(),
		localized_name: text().default('').notNull(),
		primary_attr: text(),
		attack_type: text(),
		roles: text().array().default([]).notNull(),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		id: bigserial({ mode: 'number' }).primaryKey(),
	},
	(table) => [unique('heroes_hero_id_key').on(table.hero_id)],
)

export const ingest_cursors = pgTable(
	'ingest_cursors',
	{
		key: text().notNull(),
		value: text().notNull(),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		id: bigserial({ mode: 'number' }).primaryKey(),
	},
	(table) => [unique('ingest_cursors_key_key').on(table.key)],
)

export const items = pgTable(
	'items',
	{
		item_id: integer().notNull(),
		name: text().notNull(),
		localized_name: text().default('').notNull(),
		cost: integer(),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		id: bigserial({ mode: 'number' }).primaryKey(),
	},
	(table) => [unique('items_item_id_key').on(table.item_id)],
)

export const league_ingest_runs = pgTable(
	'league_ingest_runs',
	{
		run_id: uuid().defaultRandom().notNull(),
		league_id: integer().notNull(),
		matches_limit: integer(),
		status: ingest_run_status().default('queued').notNull(),
		matches_listed: integer().default(0).notNull(),
		matches_detailed: integer().default(0).notNull(),
		replays_enqueued: integer().default(0).notNull(),
		error: text(),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		started_at: timestamp({ withTimezone: true }),
		finished_at: timestamp({ withTimezone: true }),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		id: bigserial({ mode: 'number' }).primaryKey(),
	},
	(table) => [
		index('league_ingest_runs_league_idx').using(
			'btree',
			table.league_id.asc().nullsLast(),
			table.created_at.desc().nullsFirst(),
		),
		unique('league_ingest_runs_run_id_key').on(table.run_id),
	],
)

export const leagues = pgTable(
	'leagues',
	{
		league_id: integer().notNull(),
		name: text().notNull(),
		tier: integer().default(0).notNull(),
		region: integer().default(0).notNull(),
		total_prize_pool: bigint({ mode: 'number' }).default(0).notNull(),
		start_timestamp: bigint({ mode: 'number' }).default(0).notNull(),
		end_timestamp: bigint({ mode: 'number' }).default(0).notNull(),
		most_recent_activity: bigint({ mode: 'number' }).default(0).notNull(),
		valve_status: integer().default(0).notNull(),
		status: league_lifecycle().notNull(),
		fetched_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		last_match_seq_num: bigint({ mode: 'number' }),
		history_head_match_id: bigint({ mode: 'number' }),
		history_tail_match_id: bigint({ mode: 'number' }),
		history_exhausted: boolean().default(false).notNull(),
		history_checked_at: timestamp({ withTimezone: true }),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		id: bigserial({ mode: 'number' }).primaryKey(),
	},
	(table) => [
		index('leagues_activity_idx').using(
			'btree',
			table.most_recent_activity.desc().nullsFirst(),
		),
		index('leagues_status_idx').using('btree', table.status.asc().nullsLast()),
		unique('leagues_league_id_key').on(table.league_id),
	],
)

export const lobby_types = pgTable(
	'lobby_types',
	{
		lobby_type: integer().notNull(),
		name: text().notNull(),
		balanced: boolean(),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		id: bigserial({ mode: 'number' }).primaryKey(),
	},
	(table) => [unique('lobby_types_lobby_type_key').on(table.lobby_type)],
)

export const marketplace_orders = pgTable(
	'marketplace_orders',
	{
		order_id: uuid().defaultRandom().notNull(),
		store: marketplace_store().notNull(),
		kind: account_purchase_kind().notNull(),
		product_id: integer().notNull(),
		status: marketplace_order_status().default('pending').notNull(),
		idempotence_id: text().notNull(),
		external_order_id: text(),
		steam_account_id: bigint({ mode: 'number' }).references(
			() => steam_accounts.id,
			{ onDelete: 'set null' },
		),
		test_on_match_id: bigint({ mode: 'number' }),
		error_message: text(),
		test_result: jsonb(),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		completed_at: timestamp({ withTimezone: true }),
		id: bigserial({ mode: 'number' }).primaryKey(),
	},
	(table) => [
		index('marketplace_orders_store_status_idx').using(
			'btree',
			table.store.asc().nullsLast(),
			table.status.asc().nullsLast(),
		),
		unique('marketplace_orders_idempotence_id_key').on(table.idempotence_id),
		unique('marketplace_orders_order_id_key').on(table.order_id),
	],
)

export const marketplace_products = pgTable(
	'marketplace_products',
	{
		id: bigserial({ mode: 'number' }).primaryKey(),
		store: marketplace_store().notNull(),
		kind: account_purchase_kind().notNull(),
		product_id: integer().notNull(),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
	},
	(table) => [
		unique('marketplace_products_store_kind_key').on(table.store, table.kind),
		unique('marketplace_products_store_product_id_key').on(
			table.store,
			table.product_id,
		),
	],
)

export const match_broadcasters = pgTable(
	'match_broadcasters',
	{
		match_id: bigint({ mode: 'number' })
			.notNull()
			.references(() => matches.match_id, { onDelete: 'cascade' }),
		seq: integer().notNull(),
		country_code: text(),
		description: text(),
		language_code: text(),
		account_id: bigint({ mode: 'number' }),
		name: text(),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		id: bigserial({ mode: 'number' }).primaryKey(),
	},
	(table) => [
		unique('match_broadcasters_match_id_seq_key').on(table.match_id, table.seq),
	],
)

export const match_coaches = pgTable(
	'match_coaches',
	{
		match_id: bigint({ mode: 'number' })
			.notNull()
			.references(() => matches.match_id, { onDelete: 'cascade' }),
		account_id: bigint({ mode: 'number' }).notNull(),
		coach_name: text(),
		coach_rating: integer(),
		coach_team: integer(),
		coach_party_id: bigint({ mode: 'number' }),
		is_private_coach: boolean(),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		id: bigserial({ mode: 'number' }).primaryKey(),
	},
	(table) => [
		unique('match_coaches_match_id_account_id_key').on(
			table.match_id,
			table.account_id,
		),
	],
)

export const match_draft = pgTable(
	'match_draft',
	{
		match_id: bigint({ mode: 'number' })
			.notNull()
			.references(() => matches.match_id, { onDelete: 'cascade' }),
		ord: integer().notNull(),
		is_pick: boolean().notNull(),
		hero_id: integer().notNull(),
		team: smallint().notNull(),
		player_slot: integer(),
		clock: integer(),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		id: bigserial({ mode: 'number' }).primaryKey(),
	},
	(table) => [
		unique('match_draft_match_id_ord_key').on(table.match_id, table.ord),
	],
)

export const match_objectives = pgTable(
	'match_objectives',
	{
		match_id: bigint({ mode: 'number' })
			.notNull()
			.references(() => matches.match_id, { onDelete: 'cascade' }),
		seq: integer().notNull(),
		time: integer().notNull(),
		kind: text().notNull(),
		team: smallint(),
		slot: integer(),
		key: text(),
		value: integer(),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		id: bigserial({ mode: 'number' }).primaryKey(),
	},
	(table) => [
		unique('match_objectives_match_id_seq_key').on(table.match_id, table.seq),
	],
)

export const match_player_ability_upgrades = pgTable(
	'match_player_ability_upgrades',
	{
		match_id: bigint({ mode: 'number' })
			.notNull()
			.references(() => matches.match_id, { onDelete: 'cascade' }),
		player_slot: integer().notNull(),
		seq: integer().notNull(),
		ability_id: integer().notNull(),
		time: integer(),
		level: integer(),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		id: bigserial({ mode: 'number' }).primaryKey(),
	},
	(table) => [
		unique('match_player_ability_upgrades_match_slot_seq_key').on(
			table.match_id,
			table.player_slot,
			table.seq,
		),
	],
)

export const match_player_buffs = pgTable(
	'match_player_buffs',
	{
		match_id: bigint({ mode: 'number' })
			.notNull()
			.references(() => matches.match_id, { onDelete: 'cascade' }),
		player_slot: integer().notNull(),
		buff_id: integer().notNull(),
		stacks: integer().default(1).notNull(),
		grant_time: integer(),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		id: bigserial({ mode: 'number' }).primaryKey(),
	},
	(table) => [
		unique('match_player_buffs_match_slot_buff_key').on(
			table.match_id,
			table.player_slot,
			table.buff_id,
		),
	],
)

export const match_player_damage_breakdown = pgTable(
	'match_player_damage_breakdown',
	{
		match_id: bigint({ mode: 'number' })
			.notNull()
			.references(() => matches.match_id, { onDelete: 'cascade' }),
		player_slot: integer().notNull(),
		direction: text().notNull(),
		damage_type: integer().notNull(),
		pre_reduction: integer(),
		post_reduction: integer(),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		id: bigserial({ mode: 'number' }).primaryKey(),
	},
	(table) => [
		unique('match_player_damage_breakdown_natural_key').on(
			table.match_id,
			table.player_slot,
			table.direction,
			table.damage_type,
		),
	],
)

export const match_player_units = pgTable(
	'match_player_units',
	{
		match_id: bigint({ mode: 'number' })
			.notNull()
			.references(() => matches.match_id, { onDelete: 'cascade' }),
		player_slot: integer().notNull(),
		unit_name: text().notNull(),
		item_0: integer(),
		item_1: integer(),
		item_2: integer(),
		item_3: integer(),
		item_4: integer(),
		item_5: integer(),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		id: bigserial({ mode: 'number' }).primaryKey(),
	},
	(table) => [
		unique('match_player_units_match_slot_unit_key').on(
			table.match_id,
			table.player_slot,
			table.unit_name,
		),
	],
)

export const match_players = pgTable(
	'match_players',
	{
		match_id: bigint({ mode: 'number' })
			.notNull()
			.references(() => matches.match_id, { onDelete: 'cascade' }),
		account_id: bigint({ mode: 'number' }).notNull(),
		player_slot: integer().notNull(),
		hero_id: integer().default(0).notNull(),
		player_name: text(),
		team_number: integer(),
		team_slot: integer(),
		side: text(),
		kills: integer(),
		deaths: integer(),
		assists: integer(),
		last_hits: integer(),
		denies: integer(),
		gold: integer(),
		level: integer(),
		gold_per_min: integer(),
		xp_per_min: integer(),
		net_worth: integer(),
		hero_variant: integer(),
		gold_spent: integer(),
		hero_damage: integer(),
		tower_damage: integer(),
		hero_healing: integer(),
		scaled_hero_damage: integer(),
		scaled_tower_damage: integer(),
		scaled_hero_healing: integer(),
		item_0: integer(),
		item_1: integer(),
		item_2: integer(),
		item_3: integer(),
		item_4: integer(),
		item_5: integer(),
		item_neutral: integer(),
		backpack_0: integer(),
		backpack_1: integer(),
		backpack_2: integer(),
		backpack_3: integer(),
		ability_upgrades: integer().array(),
		leaver_status: integer(),
		party_id: bigint({ mode: 'number' }),
		party_size: integer(),
		lane: integer(),
		lane_role: integer(),
		is_roaming: boolean(),
		stuns: real(),
		teamfight_participation: real(),
		towers_killed: integer(),
		roshans_killed: integer(),
		observers_placed: integer(),
		sentries_placed: integer(),
		camps_stacked: integer(),
		creeps_stacked: integer(),
		rune_pickups: integer(),
		firstblood_claimed: integer(),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		item_neutral2: integer(),
		item_6: integer(),
		item_7: integer(),
		item_8: integer(),
		item_9: integer(),
		item_10: integer(),
		item_10_lvl: integer(),
		selected_facet: integer(),
		aghanims_scepter: integer(),
		aghanims_shard: integer(),
		moonshard: integer(),
		claimed_farm_gold: integer(),
		support_gold: integer(),
		claimed_denies: integer(),
		claimed_misses: integer(),
		misses: integer(),
		support_ability_value: integer(),
		scaled_kills: real(),
		scaled_deaths: real(),
		scaled_assists: real(),
		hero_pick_order: integer(),
		hero_was_randomed: boolean(),
		seconds_dead: integer(),
		gold_lost_to_death: integer(),
		lane_selection_flags: integer(),
		bounty_runes: integer(),
		outposts_captured: integer(),
		disable_duration: integer(),
		pro_name: text(),
		real_name: text(),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		id: bigserial({ mode: 'number' }).primaryKey(),
	},
	(table) => [
		unique('match_players_match_id_player_slot_key').on(
			table.match_id,
			table.player_slot,
		),
	],
)

export const match_replays = pgTable(
	'match_replays',
	{
		match_id: bigint({ mode: 'number' })
			.notNull()
			.references(() => matches.match_id, { onDelete: 'cascade' }),
		status: replay_status().default('pending').notNull(),
		priority: replay_priority().default('historical').notNull(),
		cluster: integer(),
		replay_salt: bigint({ mode: 'number' }),
		replay_state: integer(),
		source_url: text(),
		s3_bucket: text(),
		s3_key: text(),
		bytes: bigint({ mode: 'number' }),
		attempts: integer().default(0).notNull(),
		last_error: text(),
		last_error_at: timestamp({ withTimezone: true }),
		next_attempt_at: timestamp({ withTimezone: true }),
		steam_account_id: bigint({ mode: 'number' }).references(
			() => steam_accounts.id,
			{ onDelete: 'set null' },
		),
		proxy_id: bigint({ mode: 'number' }).references(() => proxies.id, {
			onDelete: 'set null',
		}),
		parser_version: integer(),
		parsed_at: timestamp({ withTimezone: true }),
		stored_at: timestamp({ withTimezone: true }),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		id: bigserial({ mode: 'number' }).primaryKey(),
		parse_run_id: bigint({ mode: 'number' }),
	},
	(table) => [
		index('match_replays_status_idx').using(
			'btree',
			table.status.asc().nullsLast(),
		),
		unique('match_replays_match_id_key').on(table.match_id),
	],
)

export const matches = pgTable(
	'matches',
	{
		match_id: bigint({ mode: 'number' }).notNull(),
		league_id: integer().references(() => leagues.league_id, {
			onDelete: 'set null',
		}),
		match_seq_num: bigint({ mode: 'number' }),
		start_time: bigint({ mode: 'number' }),
		duration: integer(),
		pre_game_duration: integer(),
		radiant_win: boolean(),
		lobby_type: integer(),
		game_mode: integer(),
		cluster: integer(),
		replay_salt: bigint({ mode: 'number' }),
		series_id: bigint({ mode: 'number' }).references(() => series.series_id, {
			onDelete: 'set null',
		}),
		series_type: integer(),
		radiant_series_wins: integer(),
		dire_series_wins: integer(),
		radiant_team_id: integer().references(() => teams.team_id, {
			onDelete: 'set null',
		}),
		dire_team_id: integer().references(() => teams.team_id, {
			onDelete: 'set null',
		}),
		league_node_id: integer(),
		stream_delay_s: integer(),
		phase: match_phase().default('discovered').notNull(),
		source: match_source().default('historical').notNull(),
		live_seen_at: timestamp({ withTimezone: true }),
		live_disappeared_at: timestamp({ withTimezone: true }),
		live_disappeared_count: integer().default(0).notNull(),
		details_fetched_at: timestamp({ withTimezone: true }),
		finished_at: timestamp({ withTimezone: true }),
		replay_available_at: timestamp({ withTimezone: true }),
		radiant_score: integer(),
		dire_score: integer(),
		tower_status_radiant: integer(),
		tower_status_dire: integer(),
		barracks_status_radiant: integer(),
		barracks_status_dire: integer(),
		first_blood_time: integer(),
		engine: integer(),
		human_players: integer(),
		radiant_team_name: text(),
		dire_team_name: text(),
		radiant_team_complete: smallint(),
		dire_team_complete: smallint(),
		radiant_captain: bigint({ mode: 'number' }),
		dire_captain: bigint({ mode: 'number' }),
		positive_votes: integer(),
		negative_votes: integer(),
		patch: text().references(() => patches.patch, { onDelete: 'set null' }),
		last_error: text(),
		last_error_at: timestamp({ withTimezone: true }),
		last_api_key_id: bigint({ mode: 'number' }).references(
			() => steam_api_keys.id,
			{ onDelete: 'set null' },
		),
		last_steam_account_id: bigint({ mode: 'number' }).references(
			() => steam_accounts.id,
			{ onDelete: 'set null' },
		),
		last_proxy_id: bigint({ mode: 'number' }).references(() => proxies.id, {
			onDelete: 'set null',
		}),
		attempts: integer().default(0).notNull(),
		next_attempt_at: timestamp({ withTimezone: true }),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		lobby_id: bigint({ mode: 'number' }),
		match_flags: integer(),
		match_outcome: integer(),
		game_balance: real(),
		radiant_team_logo: bigint({ mode: 'number' }),
		dire_team_logo: bigint({ mode: 'number' }),
		radiant_team_logo_url: text(),
		dire_team_logo_url: text(),
		radiant_team_tag: text(),
		dire_team_tag: text(),
		radiant_guild_id: integer(),
		dire_guild_id: integer(),
		tournament_id: integer(),
		tournament_round: integer(),
		league_series_id: integer(),
		league_game_id: integer(),
		game_number: integer(),
		stage_name: text(),
		league_tier: integer(),
		id: bigserial({ mode: 'number' }).primaryKey(),
		ingest_sources: text().array().default([]).notNull(),
		waiting_for: text(),
		last_error_kind: text(),
		server_steam_id: bigint({ mode: 'number' }),
		live_league_missed_polls: integer().default(0).notNull(),
		top_live_missed_polls: integer().default(0).notNull(),
		history_poll_fast_count: integer().default(0).notNull(),
		history_poll_slow_count: integer().default(0).notNull(),
		history_last_polled_at: timestamp({ withTimezone: true }),
		history_next_poll_at: timestamp({ withTimezone: true }),
		seq_fetched_at: timestamp({ withTimezone: true }),
		last_realtime_at: timestamp({ withTimezone: true }),
		live_duration_max: real().default(0).notNull(),
	},
	(table) => [
		index('matches_history_poll_idx')
			.using(
				'btree',
				table.league_id.asc().nullsLast(),
				table.history_next_poll_at.asc().nullsLast(),
			)
			.where(sql`(phase = 'awaiting_history'::match_phase)`),
		index('matches_league_idx').using(
			'btree',
			table.league_id.asc().nullsLast(),
		),
		index('matches_phase_idx').using('btree', table.phase.asc().nullsLast()),
		index('matches_realtime_idx')
			.using('btree', table.last_realtime_at.asc().nullsLast())
			.where(
				sql`((phase = 'live'::match_phase) AND (server_steam_id IS NOT NULL))`,
			),
		index('matches_replay_available_idx')
			.using('btree', table.replay_available_at.asc().nullsLast())
			.where(
				sql`(phase = ANY (ARRAY['details_ready'::match_phase, 'awaiting_replay'::match_phase]))`,
			),
		index('matches_seq_idx').using(
			'btree',
			table.match_seq_num.asc().nullsLast(),
		),
		index('matches_source_phase_idx').using(
			'btree',
			table.source.asc().nullsLast(),
			table.phase.asc().nullsLast(),
		),
		index('matches_start_time_idx').using(
			'btree',
			table.league_id.asc().nullsLast(),
			table.start_time.desc().nullsFirst(),
		),
		unique('matches_match_id_key').on(table.match_id),
		check(
			'matches_last_error_kind_check',
			sql`((last_error_kind IS NULL) OR (last_error_kind = ANY (ARRAY['network'::text, 'rate_limit'::text, 'auth'::text, 'not_ready'::text, 'unavailable'::text, 'history_timeout'::text, 'not_started'::text, 'other'::text])))`,
		),
		check(
			'matches_waiting_for_check',
			sql`((waiting_for IS NULL) OR (waiting_for = ANY (ARRAY['live_end'::text, 'history'::text, 'seq'::text, 'gc'::text, 'replay'::text, 'parse'::text])))`,
		),
	],
)

export const patches = pgTable(
	'patches',
	{
		patch: text().notNull(),
		released_at: timestamp({ withTimezone: true }).notNull(),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		id: bigserial({ mode: 'number' }).primaryKey(),
	},
	(table) => [unique('patches_patch_key').on(table.patch)],
)

export const permanent_buffs = pgTable(
	'permanent_buffs',
	{
		buff_id: integer().notNull(),
		name: text().notNull(),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		id: bigserial({ mode: 'number' }).primaryKey(),
	},
	(table) => [unique('permanent_buffs_buff_id_key').on(table.buff_id)],
)

export const players = pgTable(
	'players',
	{
		account_id: bigint({ mode: 'number' }).notNull(),
		steam_id: text(),
		persona_name: text(),
		is_pro: boolean().default(false).notNull(),
		current_team_id: integer().references(() => teams.team_id, {
			onDelete: 'set null',
		}),
		last_match_id: bigint({ mode: 'number' }),
		last_match_at: timestamp({ withTimezone: true }),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		id: bigserial({ mode: 'number' }).primaryKey(),
	},
	(table) => [unique('players_account_id_key').on(table.account_id)],
)

export const proxies = pgTable(
	'proxies',
	{
		id: bigserial({ mode: 'number' }).primaryKey(),
		name: text().notNull(),
		url: text().notNull(),
		kind: proxy_kind().default('http').notNull(),
		purpose: proxy_purpose().default('both').notNull(),
		region: text(),
		supports_udp: boolean().default(false).notNull(),
		status: resource_status().default('ready').notNull(),
		rate_limited_until: timestamp({ withTimezone: true }),
		last_error: text(),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		retest_count: integer().default(0).notNull(),
	},
	(table) => [unique('proxies_url_key').on(table.url)],
)

export const regions = pgTable(
	'regions',
	{
		region: integer().notNull(),
		name: text().notNull(),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		id: bigserial({ mode: 'number' }).primaryKey(),
	},
	(table) => [unique('regions_region_key').on(table.region)],
)

export const resource_attempts = pgTable(
	'resource_attempts',
	{
		id: bigserial({ mode: 'number' }).primaryKey(),
		kind: resource_kind().notNull(),
		resource_id: bigint({ mode: 'number' }).notNull(),
		ok: boolean().notNull(),
		error: text(),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
	},
	(table) => [
		index('resource_attempts_kind_id_idx').using(
			'btree',
			table.kind.asc().nullsLast(),
			table.resource_id.asc().nullsLast(),
			table.id.desc().nullsFirst(),
		),
	],
)

export const series = pgTable(
	'series',
	{
		series_id: bigint({ mode: 'number' }).notNull(),
		league_id: integer().references(() => leagues.league_id, {
			onDelete: 'set null',
		}),
		radiant_team_id: integer().references(() => teams.team_id, {
			onDelete: 'set null',
		}),
		dire_team_id: integer().references(() => teams.team_id, {
			onDelete: 'set null',
		}),
		series_type: integer().default(0).notNull(),
		radiant_wins: integer().default(0).notNull(),
		dire_wins: integer().default(0).notNull(),
		first_match_id: bigint({ mode: 'number' }),
		last_match_id: bigint({ mode: 'number' }),
		started_at: timestamp({ withTimezone: true }),
		ended_at: timestamp({ withTimezone: true }),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		id: bigserial({ mode: 'number' }).primaryKey(),
	},
	(table) => [
		index('series_league_idx').using(
			'btree',
			table.league_id.asc().nullsLast(),
		),
		unique('series_series_id_key').on(table.series_id),
	],
)

export const settings = pgTable(
	'settings',
	{
		key: text().notNull(),
		value: text().notNull(),
		description: text().notNull(),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		id: bigserial({ mode: 'number' }).primaryKey(),
	},
	(table) => [unique('settings_key_key').on(table.key)],
)

export const steam_accounts = pgTable(
	'steam_accounts',
	{
		id: bigserial({ mode: 'number' }).primaryKey(),
		login: text().notNull(),
		password: text().notNull(),
		shared_secret: text(),
		identity_secret: text(),
		steam_id: text(),
		proxy_id: bigint({ mode: 'number' }).references(() => proxies.id, {
			onDelete: 'set null',
		}),
		status: resource_status().default('ready').notNull(),
		rate_limited_until: timestamp({ withTimezone: true }),
		last_login_at: timestamp({ withTimezone: true }),
		last_error: text(),
		shared_secret_broken: boolean().default(false).notNull(),
		email: text(),
		email_password: text(),
		email_imap_host: text(),
		refresh_token: text(),
		refresh_token_expires_at: timestamp({ withTimezone: true }),
		machine_auth_token: text(),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		retest_count: integer().default(0).notNull(),
	},
	(table) => [unique('steam_accounts_login_key').on(table.login)],
)

export const steam_api_keys = pgTable(
	'steam_api_keys',
	{
		id: bigserial({ mode: 'number' }).primaryKey(),
		account_id: bigint({ mode: 'number' })
			.notNull()
			.references(() => steam_accounts.id, { onDelete: 'cascade' }),
		api_key: text().notNull(),
		proxy_id: bigint({ mode: 'number' }).references(() => proxies.id, {
			onDelete: 'set null',
		}),
		status: resource_status().default('ready').notNull(),
		daily_quota: integer(),
		rate_limited_until: timestamp({ withTimezone: true }),
		last_used_at: timestamp({ withTimezone: true }),
		last_called_at: timestamp({ withTimezone: true }),
		last_error: text(),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		retest_count: integer().default(0).notNull(),
	},
	(table) => [unique('steam_api_keys_api_key_key').on(table.api_key)],
)

export const teams = pgTable(
	'teams',
	{
		team_id: integer().notNull(),
		name: text().notNull(),
		tag: text(),
		logo_url: text(),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		id: bigserial({ mode: 'number' }).primaryKey(),
	},
	(table) => [unique('teams_team_id_key').on(table.team_id)],
)

export const xp_levels = pgTable(
	'xp_levels',
	{
		level: integer().notNull(),
		xp: integer().notNull(),
		created_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		updated_at: timestamp({ withTimezone: true }).default(sql`now()`).notNull(),
		id: bigserial({ mode: 'number' }).primaryKey(),
	},
	(table) => [unique('xp_levels_level_key').on(table.level)],
)
