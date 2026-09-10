
--
-- Database schema
--

CREATE DATABASE IF NOT EXISTS dota;

CREATE TABLE dota.live_match_ticks
(
    `match_id` UInt64 CODEC(Delta(8), ZSTD(1)),
    `captured_at` DateTime64(3, 'UTC') CODEC(DoubleDelta, ZSTD(1)),
    `league_id` UInt32,
    `duration` Float32 CODEC(Gorilla, ZSTD(1)),
    `radiant_score` UInt16,
    `dire_score` UInt16,
    `spectators` UInt32,
    `tower_state_radiant` UInt32,
    `tower_state_dire` UInt32,
    `barracks_state_radiant` UInt32,
    `barracks_state_dire` UInt32,
    `roshan_respawn_timer` UInt16,
    `series_type` UInt8,
    `radiant_series_wins` UInt8,
    `dire_series_wins` UInt8,
    `stream_delay_s` UInt16,
    `source` LowCardinality(String),
    `lobby_id` UInt64 DEFAULT 0,
    `game_number` UInt8 DEFAULT 0,
    `league_series_id` UInt32 DEFAULT 0,
    `league_game_id` UInt32 DEFAULT 0,
    `league_tier` UInt8 DEFAULT 0,
    `game_state` UInt8 DEFAULT 0,
    `server_steam_id` UInt64 DEFAULT 0
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(captured_at)
ORDER BY (match_id, captured_at)
SETTINGS index_granularity = 8192;

CREATE TABLE dota.live_player_ticks
(
    `match_id` UInt64 CODEC(Delta(8), ZSTD(1)),
    `captured_at` DateTime64(3, 'UTC') CODEC(DoubleDelta, ZSTD(1)),
    `player_slot` UInt8,
    `account_id` UInt64 CODEC(Delta(8), ZSTD(1)),
    `hero_id` Int32,
    `kills` UInt16,
    `deaths` UInt16,
    `assists` UInt16,
    `last_hits` UInt32 CODEC(Delta(4), ZSTD(1)),
    `denies` UInt16,
    `gold` UInt32 CODEC(Delta(4), ZSTD(1)),
    `net_worth` UInt32 CODEC(Delta(4), ZSTD(1)),
    `level` UInt8,
    `gold_per_min` UInt16,
    `xp_per_min` UInt16,
    `x` Float32 CODEC(Gorilla, ZSTD(1)),
    `y` Float32 CODEC(Gorilla, ZSTD(1)),
    `source` LowCardinality(String),
    `item0` UInt32 DEFAULT 0,
    `item1` UInt32 DEFAULT 0,
    `item2` UInt32 DEFAULT 0,
    `item3` UInt32 DEFAULT 0,
    `item4` UInt32 DEFAULT 0,
    `item5` UInt32 DEFAULT 0,
    `ultimate_state` UInt8 DEFAULT 0,
    `ultimate_cooldown` UInt16 DEFAULT 0,
    `respawn_timer` UInt16 DEFAULT 0,
    `item6` UInt32 DEFAULT 0,
    `item7` UInt32 DEFAULT 0,
    `item8` UInt32 DEFAULT 0
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(captured_at)
ORDER BY (match_id, captured_at, player_slot)
SETTINGS index_granularity = 8192;

CREATE TABLE dota.replay_ability_levels
(
    `match_id` UInt64 CODEC(Delta(8), ZSTD(1)),
    `start_time` DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),
    `time` Int32 CODEC(Delta(4), ZSTD(1)),
    `tick` UInt32 CODEC(Delta(4), ZSTD(1)),
    `slot` Int8,
    `parser_version` UInt16,
    `ability_id` String CODEC(ZSTD(1)),
    `ability_level` UInt8,
    `target` String CODEC(ZSTD(1)),
    `parse_run_id` UInt64 DEFAULT 0,
    `account_id` UInt32 DEFAULT 0
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, time, tick)
SETTINGS index_granularity = 8192;

CREATE TABLE dota.replay_actions
(
    `match_id` UInt64 CODEC(Delta(8), ZSTD(1)),
    `start_time` DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),
    `time` Int32 CODEC(Delta(4), ZSTD(1)),
    `tick` UInt32 CODEC(Delta(4), ZSTD(1)),
    `slot` Int8,
    `parser_version` UInt16,
    `order_type` UInt16,
    `parse_run_id` UInt64 DEFAULT 0,
    `unit_index` Int32 DEFAULT -1,
    `target_index` Int32 DEFAULT -1,
    `ability_id` Int32 DEFAULT -1,
    `pos_x` Float32 DEFAULT 0 CODEC(Gorilla, ZSTD(1)),
    `pos_y` Float32 DEFAULT 0 CODEC(Gorilla, ZSTD(1)),
    `pos_z` Float32 DEFAULT 0 CODEC(Gorilla, ZSTD(1)),
    `queued` UInt8 DEFAULT 0,
    `account_id` UInt32 DEFAULT 0
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, time, tick)
SETTINGS index_granularity = 8192;

CREATE TABLE dota.replay_alerts
(
    `match_id` UInt64 CODEC(Delta(8), ZSTD(1)),
    `start_time` DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),
    `time` Int32 CODEC(Delta(4), ZSTD(1)),
    `tick` UInt32 CODEC(Delta(4), ZSTD(1)),
    `slot` Int8,
    `parser_version` UInt16,
    `parse_run_id` UInt64 DEFAULT 0,
    `kind` LowCardinality(String),
    `player2` Int16 DEFAULT -1,
    `value` Int32 DEFAULT 0 CODEC(T64, ZSTD(1)),
    `value2` Int32 DEFAULT 0,
    `x` Float32 DEFAULT 0 CODEC(Gorilla, ZSTD(1)),
    `y` Float32 DEFAULT 0 CODEC(Gorilla, ZSTD(1)),
    `key` String DEFAULT '' CODEC(ZSTD(1)),
    `account_id` UInt32 DEFAULT 0
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, time, tick)
SETTINGS index_granularity = 8192;

CREATE TABLE dota.replay_announcements
(
    `match_id` UInt64 CODEC(Delta(8), ZSTD(1)),
    `start_time` DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),
    `time` Int32 CODEC(Delta(4), ZSTD(1)),
    `tick` UInt32 CODEC(Delta(4), ZSTD(1)),
    `slot` Int8,
    `parser_version` UInt16,
    `kind` LowCardinality(String),
    `player1` Int16,
    `player2` Int16,
    `value` Int32,
    `player3` Int16 DEFAULT -1,
    `value2` UInt32 DEFAULT 0,
    `value3` UInt32 DEFAULT 0,
    `parse_run_id` UInt64 DEFAULT 0,
    `account_id` UInt32 DEFAULT 0
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, time, tick)
SETTINGS index_granularity = 8192;

CREATE TABLE dota.replay_chat
(
    `match_id` UInt64 CODEC(Delta(8), ZSTD(1)),
    `start_time` DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),
    `time` Int32 CODEC(Delta(4), ZSTD(1)),
    `tick` UInt32 CODEC(Delta(4), ZSTD(1)),
    `slot` Int8,
    `parser_version` UInt16,
    `kind` LowCardinality(String),
    `key` String CODEC(ZSTD(1)),
    `unit` String DEFAULT '' CODEC(ZSTD(1)),
    `channel` UInt8 DEFAULT 0,
    `parse_run_id` UInt64 DEFAULT 0,
    `account_id` UInt32 DEFAULT 0
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, time, tick)
SETTINGS index_granularity = 8192;

CREATE TABLE dota.replay_combat_log
(
    `match_id` UInt64 CODEC(Delta(8), ZSTD(1)),
    `start_time` DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),
    `time` Int32 CODEC(Delta(4), ZSTD(1)),
    `tick` UInt32 CODEC(Delta(4), ZSTD(1)),
    `slot` Int8,
    `parser_version` UInt16,
    `type` LowCardinality(String),
    `attacker` String CODEC(ZSTD(1)),
    `target` String CODEC(ZSTD(1)),
    `inflictor` String CODEC(ZSTD(1)),
    `attacker_slot` Int8,
    `target_slot` Int8,
    `value` Int32 CODEC(T64, ZSTD(1)),
    `value_name` LowCardinality(String),
    `gold_reason` UInt16,
    `xp_reason` UInt16,
    `attacker_hero` UInt8,
    `target_hero` UInt8,
    `attacker_illusion` UInt8,
    `target_illusion` UInt8,
    `stun_duration` Float32 CODEC(Gorilla, ZSTD(1)),
    `slow_duration` Float32 CODEC(Gorilla, ZSTD(1)),
    `sourcename` String DEFAULT '' CODEC(ZSTD(1)),
    `targetsourcename` String DEFAULT '' CODEC(ZSTD(1)),
    `greevils_greed_stack` UInt16 DEFAULT 0,
    `tracked_death` UInt8 DEFAULT 0,
    `tracked_sourcename` String DEFAULT '' CODEC(ZSTD(1)),
    `health` Int32 DEFAULT 0 CODEC(T64, ZSTD(1)),
    `ability_level` UInt8 DEFAULT 0,
    `location_x` Float32 DEFAULT 0 CODEC(Gorilla, ZSTD(1)),
    `location_y` Float32 DEFAULT 0 CODEC(Gorilla, ZSTD(1)),
    `modifier_duration` Float32 DEFAULT 0 CODEC(Gorilla, ZSTD(1)),
    `last_hits` UInt32 DEFAULT 0,
    `attacker_team` UInt8 DEFAULT 0,
    `target_team` UInt8 DEFAULT 0,
    `stack_count` UInt16 DEFAULT 0,
    `is_target_building` UInt8 DEFAULT 0,
    `rune_type` UInt16 DEFAULT 0,
    `networth` UInt32 DEFAULT 0 CODEC(Delta(4), ZSTD(1)),
    `visible_radiant` UInt8 DEFAULT 0,
    `visible_dire` UInt8 DEFAULT 0,
    `is_ability_toggle_on` UInt8 DEFAULT 0,
    `is_ability_toggle_off` UInt8 DEFAULT 0,
    `timestamp_raw` Float32 DEFAULT 0 CODEC(Gorilla, ZSTD(1)),
    `obs_wards_placed` UInt16 DEFAULT 0,
    `assist_player0` UInt32 DEFAULT 0,
    `assist_player1` UInt32 DEFAULT 0,
    `assist_player2` UInt32 DEFAULT 0,
    `assist_player3` UInt32 DEFAULT 0,
    `assist_players` Array(Int32) DEFAULT [],
    `hidden_modifier` UInt8 DEFAULT 0,
    `neutral_camp_type` UInt16 DEFAULT 0,
    `is_heal_save` UInt8 DEFAULT 0,
    `is_ultimate_ability` UInt8 DEFAULT 0,
    `attacker_hero_level` UInt16 DEFAULT 0,
    `target_hero_level` UInt16 DEFAULT 0,
    `xpm` UInt32 DEFAULT 0,
    `gpm` UInt32 DEFAULT 0,
    `event_location` UInt16 DEFAULT 0,
    `target_is_self` UInt8 DEFAULT 0,
    `damage_type` UInt16 DEFAULT 0,
    `invisibility_modifier` UInt8 DEFAULT 0,
    `damage_category` UInt16 DEFAULT 0,
    `building_type` UInt16 DEFAULT 0,
    `modifier_elapsed_duration` Float32 DEFAULT 0 CODEC(Gorilla, ZSTD(1)),
    `silence_modifier` UInt8 DEFAULT 0,
    `heal_from_lifesteal` UInt8 DEFAULT 0,
    `modifier_purged` UInt8 DEFAULT 0,
    `spell_evaded` UInt8 DEFAULT 0,
    `motion_controller_modifier` UInt8 DEFAULT 0,
    `long_range_kill` UInt8 DEFAULT 0,
    `modifier_purge_ability` UInt32 DEFAULT 0,
    `modifier_purge_npc` UInt32 DEFAULT 0,
    `root_modifier` UInt8 DEFAULT 0,
    `total_unit_death_count` UInt32 DEFAULT 0,
    `aura_modifier` UInt8 DEFAULT 0,
    `armor_debuff_modifier` UInt8 DEFAULT 0,
    `no_physical_damage_modifier` UInt8 DEFAULT 0,
    `modifier_ability` UInt32 DEFAULT 0,
    `modifier_hidden` UInt8 DEFAULT 0,
    `inflictor_is_stolen_ability` UInt8 DEFAULT 0,
    `kill_eater_event` UInt32 DEFAULT 0,
    `unit_status_label` UInt32 DEFAULT 0,
    `spell_generated_attack` UInt8 DEFAULT 0,
    `at_night_time` UInt8 DEFAULT 0,
    `attacker_has_scepter` UInt8 DEFAULT 0,
    `neutral_camp_team` UInt16 DEFAULT 0,
    `regenerated_health` Float32 DEFAULT 0 CODEC(Gorilla, ZSTD(1)),
    `will_reincarnate` UInt8 DEFAULT 0,
    `uses_charges` UInt8 DEFAULT 0,
    `tracked_stat_id` UInt32 DEFAULT 0,
    `modifier_purged_duration` Float32 DEFAULT 0 CODEC(Gorilla, ZSTD(1)),
    `heal_from_regen` UInt8 DEFAULT 0,
    `parse_run_id` UInt64 DEFAULT 0,
    `account_id` UInt32 DEFAULT 0,
    `attacker_account_id` UInt32 DEFAULT 0,
    `target_account_id` UInt32 DEFAULT 0
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, time, tick)
SETTINGS index_granularity = 8192;

CREATE TABLE dota.replay_cosmetics
(
    `match_id` UInt64 CODEC(Delta(8), ZSTD(1)),
    `start_time` DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),
    `time` Int32 CODEC(Delta(4), ZSTD(1)),
    `tick` UInt32 CODEC(Delta(4), ZSTD(1)),
    `slot` Int8,
    `parser_version` UInt16,
    `item_id` UInt32,
    `parse_run_id` UInt64 DEFAULT 0,
    `account_id` UInt32 DEFAULT 0
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, slot, item_id)
SETTINGS index_granularity = 8192;

CREATE TABLE dota.replay_draft
(
    `match_id` UInt64 CODEC(Delta(8), ZSTD(1)),
    `start_time` DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),
    `time` Int32 CODEC(Delta(4), ZSTD(1)),
    `tick` UInt32 CODEC(Delta(4), ZSTD(1)),
    `slot` Int8,
    `parser_version` UInt16,
    `is_pick` UInt8,
    `hero_id` Int32,
    `team` UInt8,
    `ord` UInt16,
    `clock` Int32,
    `extra_time_radiant` Int32 DEFAULT 0,
    `extra_time_dire` Int32 DEFAULT 0,
    `parse_run_id` UInt64 DEFAULT 0,
    `account_id` UInt32 DEFAULT 0
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, time, tick)
SETTINGS index_granularity = 8192;

CREATE TABLE dota.replay_epilogue
(
    `match_id` UInt64 CODEC(Delta(8), ZSTD(1)),
    `start_time` DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),
    `time` Int32 CODEC(Delta(4), ZSTD(1)),
    `tick` UInt32 CODEC(Delta(4), ZSTD(1)),
    `slot` Int8,
    `parser_version` UInt16,
    `key` LowCardinality(String),
    `value` String CODEC(ZSTD(3)),
    `parse_run_id` UInt64 DEFAULT 0,
    `account_id` UInt32 DEFAULT 0
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, key)
SETTINGS index_granularity = 8192;

CREATE TABLE dota.replay_intervals
(
    `match_id` UInt64 CODEC(Delta(8), ZSTD(1)),
    `start_time` DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),
    `time` Int32 CODEC(Delta(4), ZSTD(1)),
    `tick` UInt32 CODEC(Delta(4), ZSTD(1)),
    `slot` Int8,
    `parser_version` UInt16,
    `hero_id` Int32,
    `variant` Int16,
    `x` Float32 CODEC(Gorilla, ZSTD(1)),
    `y` Float32 CODEC(Gorilla, ZSTD(1)),
    `gold` UInt32 CODEC(Delta(4), ZSTD(1)),
    `lh` UInt32 CODEC(Delta(4), ZSTD(1)),
    `xp` UInt32 CODEC(Delta(4), ZSTD(1)),
    `networth` UInt32 CODEC(Delta(4), ZSTD(1)),
    `denies` UInt16,
    `level` UInt8,
    `kills` UInt16,
    `deaths` UInt16,
    `assists` UInt16,
    `life_state` UInt8,
    `stuns` Float32 CODEC(Gorilla, ZSTD(1)),
    `obs_placed` UInt16,
    `sen_placed` UInt16,
    `creeps_stacked` UInt16,
    `camps_stacked` UInt16,
    `rune_pickups` UInt16,
    `towers_killed` UInt8,
    `roshans_killed` UInt8,
    `teamfight_participation` Float32 CODEC(Gorilla, ZSTD(1)),
    `firstblood_claimed` UInt8,
    `draft_stage` UInt8,
    `unit` String DEFAULT '' CODEC(ZSTD(1)),
    `facet_hero_id` Int32 DEFAULT 0,
    `repicked` UInt8 DEFAULT 0,
    `randomed` UInt8 DEFAULT 0,
    `pred_vict` UInt8 DEFAULT 0,
    `observers_placed` UInt16 DEFAULT 0,
    `parse_run_id` UInt64 DEFAULT 0,
    `hp` UInt32 DEFAULT 0 CODEC(Delta(4), ZSTD(1)),
    `max_hp` UInt32 DEFAULT 0 CODEC(Delta(4), ZSTD(1)),
    `mana` UInt32 DEFAULT 0 CODEC(Delta(4), ZSTD(1)),
    `max_mana` UInt32 DEFAULT 0 CODEC(Delta(4), ZSTD(1)),
    `respawn` UInt16 DEFAULT 0,
    `account_id` UInt32 DEFAULT 0
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, time, tick, slot)
SETTINGS index_granularity = 8192;

CREATE TABLE dota.replay_inventory
(
    `match_id` UInt64 CODEC(Delta(8), ZSTD(1)),
    `start_time` DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),
    `time` Int32 CODEC(Delta(4), ZSTD(1)),
    `tick` UInt32 CODEC(Delta(4), ZSTD(1)),
    `slot` Int8,
    `parser_version` UInt16,
    `item_id` String CODEC(ZSTD(1)),
    `item_slot` Int8,
    `charges` UInt16,
    `secondary_charges` UInt16,
    `parse_run_id` UInt64 DEFAULT 0,
    `account_id` UInt32 DEFAULT 0
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, time, tick)
SETTINGS index_granularity = 8192;

CREATE TABLE dota.replay_neutrals
(
    `match_id` UInt64 CODEC(Delta(8), ZSTD(1)),
    `start_time` DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),
    `time` Int32 CODEC(Delta(4), ZSTD(1)),
    `tick` UInt32 CODEC(Delta(4), ZSTD(1)),
    `slot` Int8,
    `parser_version` UInt16,
    `kind` LowCardinality(String),
    `key` String CODEC(ZSTD(1)),
    `value` Int32,
    `is_neutral_active_drop` UInt8 DEFAULT 0,
    `is_neutral_passive_drop` UInt8 DEFAULT 0,
    `parse_run_id` UInt64 DEFAULT 0,
    `account_id` UInt32 DEFAULT 0
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, time, tick)
SETTINGS index_granularity = 8192;

CREATE TABLE dota.replay_pings
(
    `match_id` UInt64 CODEC(Delta(8), ZSTD(1)),
    `start_time` DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),
    `time` Int32 CODEC(Delta(4), ZSTD(1)),
    `tick` UInt32 CODEC(Delta(4), ZSTD(1)),
    `slot` Int8,
    `parser_version` UInt16,
    `x` Float32 CODEC(Gorilla, ZSTD(1)),
    `y` Float32 CODEC(Gorilla, ZSTD(1)),
    `parse_run_id` UInt64 DEFAULT 0,
    `ping_type` UInt16 DEFAULT 0,
    `target` Int32 DEFAULT -1,
    `account_id` UInt32 DEFAULT 0
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, time, tick)
SETTINGS index_granularity = 8192;

CREATE TABLE dota.replay_wards
(
    `match_id` UInt64 CODEC(Delta(8), ZSTD(1)),
    `start_time` DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),
    `time` Int32 CODEC(Delta(4), ZSTD(1)),
    `tick` UInt32 CODEC(Delta(4), ZSTD(1)),
    `slot` Int8,
    `parser_version` UInt16,
    `kind` LowCardinality(String),
    `is_left` UInt8,
    `x` Float32 CODEC(Gorilla, ZSTD(1)),
    `y` Float32 CODEC(Gorilla, ZSTD(1)),
    `z` Float32 CODEC(Gorilla, ZSTD(1)),
    `ehandle` UInt32,
    `parse_run_id` UInt64 DEFAULT 0,
    `account_id` UInt32 DEFAULT 0
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, time, tick)
SETTINGS index_granularity = 8192;

CREATE TABLE dota.schema_migrations
(
    `version` String,
    `ts` DateTime DEFAULT now(),
    `applied` UInt8 DEFAULT 1
)
ENGINE = ReplacingMergeTree(ts)
PRIMARY KEY version
ORDER BY version
SETTINGS index_granularity = 8192;


--
-- Dbmate schema migrations
--

INSERT INTO dota.schema_migrations (version) VALUES
    ('20260830000000'),
    ('20260830000001'),
    ('20260830000002'),
    ('20260905220000'),
    ('20260905233000'),
    ('20260906010000'),
    ('20260911010000');
