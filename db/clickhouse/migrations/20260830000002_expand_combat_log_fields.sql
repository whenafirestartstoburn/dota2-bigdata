-- Remaining CMsgDOTACombatLogEntry scalars, plus chat channel and
-- announcement extras the demo parser now keeps.
-- One statement per migrate:up: ClickHouse does not batch queries.

-- migrate:up transaction:false

ALTER TABLE replay_combat_log
	ADD COLUMN health Int32 DEFAULT 0 Codec(T64, ZSTD(1)),
	ADD COLUMN ability_level UInt8 DEFAULT 0,
	ADD COLUMN location_x Float32 DEFAULT 0 Codec(Gorilla, ZSTD(1)),
	ADD COLUMN location_y Float32 DEFAULT 0 Codec(Gorilla, ZSTD(1)),
	ADD COLUMN modifier_duration Float32 DEFAULT 0 Codec(Gorilla, ZSTD(1)),
	ADD COLUMN last_hits UInt32 DEFAULT 0,
	ADD COLUMN attacker_team UInt8 DEFAULT 0,
	ADD COLUMN target_team UInt8 DEFAULT 0,
	ADD COLUMN stack_count UInt16 DEFAULT 0,
	ADD COLUMN is_target_building UInt8 DEFAULT 0,
	ADD COLUMN rune_type UInt16 DEFAULT 0,
	ADD COLUMN networth UInt32 DEFAULT 0 Codec(Delta(4), ZSTD(1)),
	ADD COLUMN visible_radiant UInt8 DEFAULT 0,
	ADD COLUMN visible_dire UInt8 DEFAULT 0,
	ADD COLUMN is_ability_toggle_on UInt8 DEFAULT 0,
	ADD COLUMN is_ability_toggle_off UInt8 DEFAULT 0,
	ADD COLUMN timestamp_raw Float32 DEFAULT 0 Codec(Gorilla, ZSTD(1)),
	ADD COLUMN obs_wards_placed UInt16 DEFAULT 0,
	ADD COLUMN assist_player0 UInt32 DEFAULT 0,
	ADD COLUMN assist_player1 UInt32 DEFAULT 0,
	ADD COLUMN assist_player2 UInt32 DEFAULT 0,
	ADD COLUMN assist_player3 UInt32 DEFAULT 0,
	ADD COLUMN assist_players Array(Int32) DEFAULT [],
	ADD COLUMN hidden_modifier UInt8 DEFAULT 0,
	ADD COLUMN neutral_camp_type UInt16 DEFAULT 0,
	ADD COLUMN is_heal_save UInt8 DEFAULT 0,
	ADD COLUMN is_ultimate_ability UInt8 DEFAULT 0,
	ADD COLUMN attacker_hero_level UInt16 DEFAULT 0,
	ADD COLUMN target_hero_level UInt16 DEFAULT 0,
	ADD COLUMN xpm UInt32 DEFAULT 0,
	ADD COLUMN gpm UInt32 DEFAULT 0,
	ADD COLUMN event_location UInt16 DEFAULT 0,
	ADD COLUMN target_is_self UInt8 DEFAULT 0,
	ADD COLUMN damage_type UInt16 DEFAULT 0,
	ADD COLUMN invisibility_modifier UInt8 DEFAULT 0,
	ADD COLUMN damage_category UInt16 DEFAULT 0,
	ADD COLUMN building_type UInt16 DEFAULT 0,
	ADD COLUMN modifier_elapsed_duration Float32 DEFAULT 0 Codec(Gorilla, ZSTD(1)),
	ADD COLUMN silence_modifier UInt8 DEFAULT 0,
	ADD COLUMN heal_from_lifesteal UInt8 DEFAULT 0,
	ADD COLUMN modifier_purged UInt8 DEFAULT 0,
	ADD COLUMN spell_evaded UInt8 DEFAULT 0,
	ADD COLUMN motion_controller_modifier UInt8 DEFAULT 0,
	ADD COLUMN long_range_kill UInt8 DEFAULT 0,
	ADD COLUMN modifier_purge_ability UInt32 DEFAULT 0,
	ADD COLUMN modifier_purge_npc UInt32 DEFAULT 0,
	ADD COLUMN root_modifier UInt8 DEFAULT 0,
	ADD COLUMN total_unit_death_count UInt32 DEFAULT 0,
	ADD COLUMN aura_modifier UInt8 DEFAULT 0,
	ADD COLUMN armor_debuff_modifier UInt8 DEFAULT 0,
	ADD COLUMN no_physical_damage_modifier UInt8 DEFAULT 0,
	ADD COLUMN modifier_ability UInt32 DEFAULT 0,
	ADD COLUMN modifier_hidden UInt8 DEFAULT 0,
	ADD COLUMN inflictor_is_stolen_ability UInt8 DEFAULT 0,
	ADD COLUMN kill_eater_event UInt32 DEFAULT 0,
	ADD COLUMN unit_status_label UInt32 DEFAULT 0,
	ADD COLUMN spell_generated_attack UInt8 DEFAULT 0,
	ADD COLUMN at_night_time UInt8 DEFAULT 0,
	ADD COLUMN attacker_has_scepter UInt8 DEFAULT 0,
	ADD COLUMN neutral_camp_team UInt16 DEFAULT 0,
	ADD COLUMN regenerated_health Float32 DEFAULT 0 Codec(Gorilla, ZSTD(1)),
	ADD COLUMN will_reincarnate UInt8 DEFAULT 0,
	ADD COLUMN uses_charges UInt8 DEFAULT 0,
	ADD COLUMN tracked_stat_id UInt32 DEFAULT 0,
	ADD COLUMN modifier_purged_duration Float32 DEFAULT 0 Codec(Gorilla, ZSTD(1)),
	ADD COLUMN heal_from_regen UInt8 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE replay_combat_log
	DROP COLUMN IF EXISTS health,
	DROP COLUMN IF EXISTS ability_level,
	DROP COLUMN IF EXISTS location_x,
	DROP COLUMN IF EXISTS location_y,
	DROP COLUMN IF EXISTS modifier_duration,
	DROP COLUMN IF EXISTS last_hits,
	DROP COLUMN IF EXISTS attacker_team,
	DROP COLUMN IF EXISTS target_team,
	DROP COLUMN IF EXISTS stack_count,
	DROP COLUMN IF EXISTS is_target_building,
	DROP COLUMN IF EXISTS rune_type,
	DROP COLUMN IF EXISTS networth,
	DROP COLUMN IF EXISTS visible_radiant,
	DROP COLUMN IF EXISTS visible_dire,
	DROP COLUMN IF EXISTS is_ability_toggle_on,
	DROP COLUMN IF EXISTS is_ability_toggle_off,
	DROP COLUMN IF EXISTS timestamp_raw,
	DROP COLUMN IF EXISTS obs_wards_placed,
	DROP COLUMN IF EXISTS assist_player0,
	DROP COLUMN IF EXISTS assist_player1,
	DROP COLUMN IF EXISTS assist_player2,
	DROP COLUMN IF EXISTS assist_player3,
	DROP COLUMN IF EXISTS assist_players,
	DROP COLUMN IF EXISTS hidden_modifier,
	DROP COLUMN IF EXISTS neutral_camp_type,
	DROP COLUMN IF EXISTS is_heal_save,
	DROP COLUMN IF EXISTS is_ultimate_ability,
	DROP COLUMN IF EXISTS attacker_hero_level,
	DROP COLUMN IF EXISTS target_hero_level,
	DROP COLUMN IF EXISTS xpm,
	DROP COLUMN IF EXISTS gpm,
	DROP COLUMN IF EXISTS event_location,
	DROP COLUMN IF EXISTS target_is_self,
	DROP COLUMN IF EXISTS damage_type,
	DROP COLUMN IF EXISTS invisibility_modifier,
	DROP COLUMN IF EXISTS damage_category,
	DROP COLUMN IF EXISTS building_type,
	DROP COLUMN IF EXISTS modifier_elapsed_duration,
	DROP COLUMN IF EXISTS silence_modifier,
	DROP COLUMN IF EXISTS heal_from_lifesteal,
	DROP COLUMN IF EXISTS modifier_purged,
	DROP COLUMN IF EXISTS spell_evaded,
	DROP COLUMN IF EXISTS motion_controller_modifier,
	DROP COLUMN IF EXISTS long_range_kill,
	DROP COLUMN IF EXISTS modifier_purge_ability,
	DROP COLUMN IF EXISTS modifier_purge_npc,
	DROP COLUMN IF EXISTS root_modifier,
	DROP COLUMN IF EXISTS total_unit_death_count,
	DROP COLUMN IF EXISTS aura_modifier,
	DROP COLUMN IF EXISTS armor_debuff_modifier,
	DROP COLUMN IF EXISTS no_physical_damage_modifier,
	DROP COLUMN IF EXISTS modifier_ability,
	DROP COLUMN IF EXISTS modifier_hidden,
	DROP COLUMN IF EXISTS inflictor_is_stolen_ability,
	DROP COLUMN IF EXISTS kill_eater_event,
	DROP COLUMN IF EXISTS unit_status_label,
	DROP COLUMN IF EXISTS spell_generated_attack,
	DROP COLUMN IF EXISTS at_night_time,
	DROP COLUMN IF EXISTS attacker_has_scepter,
	DROP COLUMN IF EXISTS neutral_camp_team,
	DROP COLUMN IF EXISTS regenerated_health,
	DROP COLUMN IF EXISTS will_reincarnate,
	DROP COLUMN IF EXISTS uses_charges,
	DROP COLUMN IF EXISTS tracked_stat_id,
	DROP COLUMN IF EXISTS modifier_purged_duration,
	DROP COLUMN IF EXISTS heal_from_regen;

-- migrate:up transaction:false

ALTER TABLE replay_announcements
	ADD COLUMN player3 Int16 DEFAULT -1,
	ADD COLUMN value2 UInt32 DEFAULT 0,
	ADD COLUMN value3 UInt32 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE replay_announcements
	DROP COLUMN IF EXISTS player3,
	DROP COLUMN IF EXISTS value2,
	DROP COLUMN IF EXISTS value3;

-- migrate:up transaction:false

ALTER TABLE replay_chat
	ADD COLUMN channel UInt8 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE replay_chat
	DROP COLUMN IF EXISTS channel;
