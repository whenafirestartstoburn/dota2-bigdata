
--
-- Database schema
--

CREATE DATABASE IF NOT EXISTS dota;

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
    `slot` Int8 CODEC(T64, ZSTD(1)),
    `parser_version` UInt16,
    `order_type` UInt16 CODEC(T64, ZSTD(1)),
    `unit_index` Int32 DEFAULT -1 CODEC(T64, ZSTD(1)),
    `target_index` Int32 DEFAULT -1 CODEC(T64, ZSTD(1)),
    `ability_id` Int32 DEFAULT -1 CODEC(T64, ZSTD(1)),
    `pos_x` Float32 DEFAULT 0 CODEC(ZSTD(1)),
    `pos_y` Float32 DEFAULT 0 CODEC(ZSTD(1)),
    `pos_z` Float32 DEFAULT 0 CODEC(ZSTD(1)),
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
    `slot` Int8 CODEC(T64, ZSTD(1)),
    `parser_version` UInt16,
    `type` LowCardinality(String),
    `attacker` LowCardinality(String) CODEC(ZSTD(1)),
    `target` LowCardinality(String) CODEC(ZSTD(1)),
    `inflictor` LowCardinality(String) CODEC(ZSTD(1)),
    `attacker_slot` Int8 CODEC(T64, ZSTD(1)),
    `target_slot` Int8 CODEC(T64, ZSTD(1)),
    `value` Int32 CODEC(T64, ZSTD(1)),
    `value_name` LowCardinality(String),
    `gold_reason` UInt16,
    `xp_reason` UInt16,
    `attacker_hero` UInt8 CODEC(T64, ZSTD(1)),
    `target_hero` UInt8 CODEC(T64, ZSTD(1)),
    `attacker_illusion` UInt8,
    `target_illusion` UInt8,
    `stun_duration` Float32 CODEC(Gorilla, ZSTD(1)),
    `slow_duration` Float32 CODEC(Gorilla, ZSTD(1)),
    `sourcename` LowCardinality(String) DEFAULT '' CODEC(ZSTD(1)),
    `targetsourcename` LowCardinality(String) DEFAULT '' CODEC(ZSTD(1)),
    `health` Int32 DEFAULT 0 CODEC(T64, ZSTD(1)),
    `ability_level` UInt8 DEFAULT 0,
    `location_x` Float32 DEFAULT 0 CODEC(Gorilla, ZSTD(1)),
    `location_y` Float32 DEFAULT 0 CODEC(Gorilla, ZSTD(1)),
    `modifier_duration` Float32 DEFAULT 0 CODEC(Gorilla, ZSTD(1)),
    `last_hits` UInt32 DEFAULT 0 CODEC(Delta(4), ZSTD(1)),
    `attacker_team` UInt8 DEFAULT 0 CODEC(T64, ZSTD(1)),
    `target_team` UInt8 DEFAULT 0 CODEC(T64, ZSTD(1)),
    `stack_count` UInt16 DEFAULT 0 CODEC(T64, ZSTD(1)),
    `is_target_building` UInt8 DEFAULT 0,
    `rune_type` UInt16 DEFAULT 0,
    `networth` UInt32 DEFAULT 0 CODEC(Delta(4), ZSTD(1)),
    `visible_radiant` UInt8 DEFAULT 0 CODEC(T64, ZSTD(1)),
    `visible_dire` UInt8 DEFAULT 0 CODEC(T64, ZSTD(1)),
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
    `target_is_self` UInt8 DEFAULT 0 CODEC(T64, ZSTD(1)),
    `damage_type` UInt16 DEFAULT 0 CODEC(T64, ZSTD(1)),
    `invisibility_modifier` UInt8 DEFAULT 0,
    `damage_category` UInt16 DEFAULT 0 CODEC(T64, ZSTD(1)),
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
    `modifier_ability` UInt32 DEFAULT 0 CODEC(T64, ZSTD(1)),
    `modifier_hidden` UInt8 DEFAULT 0,
    `inflictor_is_stolen_ability` UInt8 DEFAULT 0,
    `kill_eater_event` UInt32 DEFAULT 0,
    `unit_status_label` UInt32 DEFAULT 0,
    `spell_generated_attack` UInt8 DEFAULT 0 CODEC(T64, ZSTD(1)),
    `at_night_time` UInt8 DEFAULT 0 CODEC(T64, ZSTD(1)),
    `attacker_has_scepter` UInt8 DEFAULT 0,
    `neutral_camp_team` UInt16 DEFAULT 0,
    `regenerated_health` Float32 DEFAULT 0 CODEC(Gorilla, ZSTD(1)),
    `will_reincarnate` UInt8 DEFAULT 0,
    `uses_charges` UInt8 DEFAULT 0,
    `tracked_stat_id` UInt32 DEFAULT 0,
    `modifier_purged_duration` Float32 DEFAULT 0 CODEC(Gorilla, ZSTD(1)),
    `heal_from_regen` UInt8 DEFAULT 0,
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
    `account_id` UInt32 DEFAULT 0
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, time, tick)
SETTINGS index_granularity = 8192;

CREATE TABLE dota.replay_intervals
(
    `match_id` UInt64 CODEC(Delta(8), ZSTD(1)),
    `start_time` DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),
    `time` Int32 CODEC(Delta(4), ZSTD(1)),
    `tick` UInt32 CODEC(Delta(4), ZSTD(1)),
    `slot` Int8 CODEC(T64, ZSTD(1)),
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
    `unit` LowCardinality(String) DEFAULT '' CODEC(ZSTD(1)),
    `facet_hero_id` Int32 DEFAULT 0,
    `repicked` UInt8 DEFAULT 0,
    `randomed` UInt8 DEFAULT 0,
    `pred_vict` UInt8 DEFAULT 0,
    `hp` UInt32 DEFAULT 0 CODEC(Delta(4), ZSTD(1)),
    `max_hp` UInt32 DEFAULT 0 CODEC(Delta(4), ZSTD(1)),
    `mana` UInt32 DEFAULT 0 CODEC(Delta(4), ZSTD(1)),
    `max_mana` UInt32 DEFAULT 0 CODEC(Delta(4), ZSTD(1)),
    `respawn` UInt16 DEFAULT 0 CODEC(T64, ZSTD(1)),
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
    `account_id` UInt32 DEFAULT 0
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, time, tick)
SETTINGS index_granularity = 8192;

CREATE TABLE dota.replay_meta
(
    `match_id` UInt64 CODEC(Delta(8), ZSTD(1)),
    `start_time` DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),
    `time` Int32 CODEC(Delta(4), ZSTD(1)),
    `tick` UInt32 CODEC(Delta(4), ZSTD(1)),
    `slot` Int8 CODEC(T64, ZSTD(1)),
    `parser_version` UInt16,
    `account_id` UInt32 DEFAULT 0,
    `playback_time` Float32 CODEC(Gorilla, ZSTD(1)),
    `playback_ticks` UInt32,
    `playback_frames` UInt32,
    `game_winner` UInt8,
    `radiant_team_id` UInt32,
    `dire_team_id` UInt32,
    `metadata_version` Int32,
    `lobby_id` UInt64
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, time, tick)
SETTINGS index_granularity = 8192;

CREATE TABLE dota.replay_meta_inventory
(
    `match_id` UInt64 CODEC(Delta(8), ZSTD(1)),
    `start_time` DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),
    `time` Int32 CODEC(Delta(4), ZSTD(1)),
    `tick` UInt32 CODEC(Delta(4), ZSTD(1)),
    `slot` Int8 CODEC(T64, ZSTD(1)),
    `parser_version` UInt16,
    `account_id` UInt32 DEFAULT 0,
    `item_ids` Array(Int32),
    `backpack_item_ids` Array(Int32),
    `neutral_item_id` Int32,
    `neutral_enhancement_id` Int32,
    `kills` UInt32,
    `deaths` UInt32,
    `assists` UInt32,
    `level` UInt32,
    `last_hits` UInt32,
    `denies` UInt32,
    `flags` UInt32
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, time, slot)
SETTINGS index_granularity = 8192;

CREATE TABLE dota.replay_meta_kills
(
    `match_id` UInt64 CODEC(Delta(8), ZSTD(1)),
    `start_time` DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),
    `time` Int32 CODEC(Delta(4), ZSTD(1)),
    `tick` UInt32 CODEC(Delta(4), ZSTD(1)),
    `slot` Int8 CODEC(T64, ZSTD(1)),
    `parser_version` UInt16,
    `account_id` UInt32 DEFAULT 0,
    `team` UInt8,
    `kill_type` LowCardinality(String),
    `victim_slot` UInt8,
    `killer_slots` Array(UInt8),
    `bounty` Int32 CODEC(T64, ZSTD(1))
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, time, slot)
SETTINGS index_granularity = 8192;

CREATE TABLE dota.replay_meta_player_kills
(
    `match_id` UInt64 CODEC(Delta(8), ZSTD(1)),
    `start_time` DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),
    `time` Int32 CODEC(Delta(4), ZSTD(1)),
    `tick` UInt32 CODEC(Delta(4), ZSTD(1)),
    `slot` Int8 CODEC(T64, ZSTD(1)),
    `parser_version` UInt16,
    `account_id` UInt32 DEFAULT 0,
    `victim_slot` UInt8,
    `count` UInt32
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, slot, victim_slot)
SETTINGS index_granularity = 8192;

CREATE TABLE dota.replay_meta_players
(
    `match_id` UInt64 CODEC(Delta(8), ZSTD(1)),
    `start_time` DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),
    `time` Int32 CODEC(Delta(4), ZSTD(1)),
    `tick` UInt32 CODEC(Delta(4), ZSTD(1)),
    `slot` Int8 CODEC(T64, ZSTD(1)),
    `parser_version` UInt16,
    `account_id` UInt32 DEFAULT 0,
    `valve_slot` UInt8,
    `team_number` UInt8,
    `team_slot` UInt8,
    `camps_stacked` UInt32,
    `lane_selection_flags` UInt32,
    `rampages` UInt32,
    `triple_kills` UInt32,
    `aegis_snatched` UInt32,
    `rapiers_purchased` UInt32,
    `couriers_killed` UInt32,
    `net_worth_rank` UInt32,
    `support_gold_spent` UInt32,
    `observer_wards_placed` UInt32,
    `sentry_wards_placed` UInt32,
    `wards_dewarded` UInt32,
    `stun_duration` Float32 CODEC(Gorilla, ZSTD(1)),
    `fight_score` Float32 CODEC(Gorilla, ZSTD(1)),
    `farm_score` Float32 CODEC(Gorilla, ZSTD(1)),
    `support_score` Float32 CODEC(Gorilla, ZSTD(1)),
    `push_score` Float32 CODEC(Gorilla, ZSTD(1)),
    `hero_xp` UInt32,
    `ability_upgrades` Array(Int32),
    `level_up_times` Array(UInt32),
    `graph_net_worth` Array(Float32),
    `graph_hero_damage` Array(Float32)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, slot)
SETTINGS index_granularity = 8192;

CREATE TABLE dota.replay_meta_purchases
(
    `match_id` UInt64 CODEC(Delta(8), ZSTD(1)),
    `start_time` DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),
    `time` Int32 CODEC(Delta(4), ZSTD(1)),
    `tick` UInt32 CODEC(Delta(4), ZSTD(1)),
    `slot` Int8 CODEC(T64, ZSTD(1)),
    `parser_version` UInt16,
    `account_id` UInt32 DEFAULT 0,
    `item_id` Int32
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, time, slot)
SETTINGS index_granularity = 8192;

CREATE TABLE dota.replay_meta_teams
(
    `match_id` UInt64 CODEC(Delta(8), ZSTD(1)),
    `start_time` DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),
    `time` Int32 CODEC(Delta(4), ZSTD(1)),
    `tick` UInt32 CODEC(Delta(4), ZSTD(1)),
    `slot` Int8 CODEC(T64, ZSTD(1)),
    `parser_version` UInt16,
    `account_id` UInt32 DEFAULT 0,
    `dota_team` UInt8,
    `cm_first_pick` UInt8,
    `cm_captain_player_id` Int32,
    `cm_penalty` UInt32,
    `graph_experience` Array(Float32),
    `graph_gold_earned` Array(Float32),
    `graph_net_worth` Array(Float32)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, dota_team)
SETTINGS index_granularity = 8192;

CREATE TABLE dota.replay_meta_tips
(
    `match_id` UInt64 CODEC(Delta(8), ZSTD(1)),
    `start_time` DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),
    `time` Int32 CODEC(Delta(4), ZSTD(1)),
    `tick` UInt32 CODEC(Delta(4), ZSTD(1)),
    `slot` Int8 CODEC(T64, ZSTD(1)),
    `parser_version` UInt16,
    `account_id` UInt32 DEFAULT 0,
    `source_slot` UInt8,
    `target_slot` UInt8,
    `tip_amount` UInt32,
    `event_id` UInt32
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, slot)
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
    ('20260911010000'),
    ('20260913020000'),
    ('20260913030000'),
    ('20260915140000'),
    ('20260915180000'),
    ('20260916020000');
