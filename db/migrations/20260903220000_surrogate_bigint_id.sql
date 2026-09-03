-- migrate:up

-- UUID / Valve `id` columns keep their values under a natural-key name.
ALTER TABLE marketplace_orders RENAME COLUMN id TO order_id;
ALTER TABLE league_ingest_runs RENAME COLUMN id TO run_id;
ALTER TABLE heroes RENAME COLUMN id TO hero_id;
ALTER TABLE items RENAME COLUMN id TO item_id;

-- bigserial: create sequence, DEFAULT nextval, NOT NULL, backfill existing rows.
ALTER TABLE heroes ADD COLUMN id bigserial;
ALTER TABLE ingest_cursors ADD COLUMN id bigserial;
ALTER TABLE items ADD COLUMN id bigserial;
ALTER TABLE league_ingest_runs ADD COLUMN id bigserial;
ALTER TABLE leagues ADD COLUMN id bigserial;
ALTER TABLE marketplace_orders ADD COLUMN id bigserial;
ALTER TABLE match_broadcasters ADD COLUMN id bigserial;
ALTER TABLE match_coaches ADD COLUMN id bigserial;
ALTER TABLE match_draft ADD COLUMN id bigserial;
ALTER TABLE match_objectives ADD COLUMN id bigserial;
ALTER TABLE match_player_ability_upgrades ADD COLUMN id bigserial;
ALTER TABLE match_player_buffs ADD COLUMN id bigserial;
ALTER TABLE match_player_damage_breakdown ADD COLUMN id bigserial;
ALTER TABLE match_player_units ADD COLUMN id bigserial;
ALTER TABLE match_players ADD COLUMN id bigserial;
ALTER TABLE match_replays ADD COLUMN id bigserial;
ALTER TABLE matches ADD COLUMN id bigserial;
ALTER TABLE patches ADD COLUMN id bigserial;
ALTER TABLE players ADD COLUMN id bigserial;
ALTER TABLE series ADD COLUMN id bigserial;
ALTER TABLE settings ADD COLUMN id bigserial;
ALTER TABLE teams ADD COLUMN id bigserial;

ALTER TABLE match_broadcasters DROP CONSTRAINT match_broadcasters_match_id_fkey;
ALTER TABLE match_coaches DROP CONSTRAINT match_coaches_match_id_fkey;
ALTER TABLE match_draft DROP CONSTRAINT match_draft_match_id_fkey;
ALTER TABLE match_objectives DROP CONSTRAINT match_objectives_match_id_fkey;
ALTER TABLE match_player_ability_upgrades
	DROP CONSTRAINT match_player_ability_upgrades_match_id_fkey;
ALTER TABLE match_player_buffs DROP CONSTRAINT match_player_buffs_match_id_fkey;
ALTER TABLE match_player_damage_breakdown
	DROP CONSTRAINT match_player_damage_breakdown_match_id_fkey;
ALTER TABLE match_player_units DROP CONSTRAINT match_player_units_match_id_fkey;
ALTER TABLE match_players DROP CONSTRAINT match_players_match_id_fkey;
ALTER TABLE match_replays DROP CONSTRAINT match_replays_match_id_fkey;
ALTER TABLE matches DROP CONSTRAINT matches_league_id_fkey;
ALTER TABLE matches DROP CONSTRAINT matches_series_id_fkey;
ALTER TABLE matches DROP CONSTRAINT matches_radiant_team_id_fkey;
ALTER TABLE matches DROP CONSTRAINT matches_dire_team_id_fkey;
ALTER TABLE matches DROP CONSTRAINT matches_patch_fkey;
ALTER TABLE series DROP CONSTRAINT series_league_id_fkey;
ALTER TABLE series DROP CONSTRAINT series_radiant_team_id_fkey;
ALTER TABLE series DROP CONSTRAINT series_dire_team_id_fkey;
ALTER TABLE players DROP CONSTRAINT players_current_team_id_fkey;

ALTER TABLE heroes DROP CONSTRAINT heroes_pkey;
ALTER TABLE heroes ADD CONSTRAINT heroes_hero_id_key UNIQUE (hero_id);
ALTER TABLE heroes ADD CONSTRAINT heroes_pkey PRIMARY KEY (id);

ALTER TABLE ingest_cursors DROP CONSTRAINT ingest_cursors_pkey;
ALTER TABLE ingest_cursors ADD CONSTRAINT ingest_cursors_key_key UNIQUE (key);
ALTER TABLE ingest_cursors ADD CONSTRAINT ingest_cursors_pkey PRIMARY KEY (id);

ALTER TABLE items DROP CONSTRAINT items_pkey;
ALTER TABLE items ADD CONSTRAINT items_item_id_key UNIQUE (item_id);
ALTER TABLE items ADD CONSTRAINT items_pkey PRIMARY KEY (id);

ALTER TABLE league_ingest_runs DROP CONSTRAINT league_ingest_runs_pkey;
ALTER TABLE league_ingest_runs
	ADD CONSTRAINT league_ingest_runs_run_id_key UNIQUE (run_id);
ALTER TABLE league_ingest_runs ADD CONSTRAINT league_ingest_runs_pkey PRIMARY KEY (id);

ALTER TABLE leagues DROP CONSTRAINT leagues_pkey;
ALTER TABLE leagues ADD CONSTRAINT leagues_league_id_key UNIQUE (league_id);
ALTER TABLE leagues ADD CONSTRAINT leagues_pkey PRIMARY KEY (id);

ALTER TABLE marketplace_orders DROP CONSTRAINT marketplace_orders_pkey;
ALTER TABLE marketplace_orders
	ADD CONSTRAINT marketplace_orders_order_id_key UNIQUE (order_id);
ALTER TABLE marketplace_orders ADD CONSTRAINT marketplace_orders_pkey PRIMARY KEY (id);

ALTER TABLE match_broadcasters DROP CONSTRAINT match_broadcasters_pkey;
ALTER TABLE match_broadcasters
	ADD CONSTRAINT match_broadcasters_match_id_seq_key UNIQUE (match_id, seq);
ALTER TABLE match_broadcasters ADD CONSTRAINT match_broadcasters_pkey PRIMARY KEY (id);

ALTER TABLE match_coaches DROP CONSTRAINT match_coaches_pkey;
ALTER TABLE match_coaches
	ADD CONSTRAINT match_coaches_match_id_account_id_key UNIQUE (match_id, account_id);
ALTER TABLE match_coaches ADD CONSTRAINT match_coaches_pkey PRIMARY KEY (id);

ALTER TABLE match_draft DROP CONSTRAINT match_draft_pkey;
ALTER TABLE match_draft
	ADD CONSTRAINT match_draft_match_id_ord_key UNIQUE (match_id, ord);
ALTER TABLE match_draft ADD CONSTRAINT match_draft_pkey PRIMARY KEY (id);

ALTER TABLE match_objectives DROP CONSTRAINT match_objectives_pkey;
ALTER TABLE match_objectives
	ADD CONSTRAINT match_objectives_match_id_seq_key UNIQUE (match_id, seq);
ALTER TABLE match_objectives ADD CONSTRAINT match_objectives_pkey PRIMARY KEY (id);

ALTER TABLE match_player_ability_upgrades
	DROP CONSTRAINT match_player_ability_upgrades_pkey;
ALTER TABLE match_player_ability_upgrades
	ADD CONSTRAINT match_player_ability_upgrades_match_slot_seq_key
	UNIQUE (match_id, player_slot, seq);
ALTER TABLE match_player_ability_upgrades
	ADD CONSTRAINT match_player_ability_upgrades_pkey PRIMARY KEY (id);

ALTER TABLE match_player_buffs DROP CONSTRAINT match_player_buffs_pkey;
ALTER TABLE match_player_buffs
	ADD CONSTRAINT match_player_buffs_match_slot_buff_key
	UNIQUE (match_id, player_slot, buff_id);
ALTER TABLE match_player_buffs ADD CONSTRAINT match_player_buffs_pkey PRIMARY KEY (id);

ALTER TABLE match_player_damage_breakdown
	DROP CONSTRAINT match_player_damage_breakdown_pkey;
ALTER TABLE match_player_damage_breakdown
	ADD CONSTRAINT match_player_damage_breakdown_natural_key
	UNIQUE (match_id, player_slot, direction, damage_type);
ALTER TABLE match_player_damage_breakdown
	ADD CONSTRAINT match_player_damage_breakdown_pkey PRIMARY KEY (id);

ALTER TABLE match_player_units DROP CONSTRAINT match_player_units_pkey;
ALTER TABLE match_player_units
	ADD CONSTRAINT match_player_units_match_slot_unit_key
	UNIQUE (match_id, player_slot, unit_name);
ALTER TABLE match_player_units ADD CONSTRAINT match_player_units_pkey PRIMARY KEY (id);

ALTER TABLE match_players DROP CONSTRAINT match_players_pkey;
ALTER TABLE match_players
	ADD CONSTRAINT match_players_match_id_player_slot_key UNIQUE (match_id, player_slot);
ALTER TABLE match_players ADD CONSTRAINT match_players_pkey PRIMARY KEY (id);

ALTER TABLE match_replays DROP CONSTRAINT match_replays_pkey;
ALTER TABLE match_replays ADD CONSTRAINT match_replays_match_id_key UNIQUE (match_id);
ALTER TABLE match_replays ADD CONSTRAINT match_replays_pkey PRIMARY KEY (id);

ALTER TABLE matches DROP CONSTRAINT matches_pkey;
ALTER TABLE matches ADD CONSTRAINT matches_match_id_key UNIQUE (match_id);
ALTER TABLE matches ADD CONSTRAINT matches_pkey PRIMARY KEY (id);

ALTER TABLE patches DROP CONSTRAINT patches_pkey;
ALTER TABLE patches ADD CONSTRAINT patches_patch_key UNIQUE (patch);
ALTER TABLE patches ADD CONSTRAINT patches_pkey PRIMARY KEY (id);

ALTER TABLE players DROP CONSTRAINT players_pkey;
ALTER TABLE players ADD CONSTRAINT players_account_id_key UNIQUE (account_id);
ALTER TABLE players ADD CONSTRAINT players_pkey PRIMARY KEY (id);

ALTER TABLE series DROP CONSTRAINT series_pkey;
ALTER TABLE series ADD CONSTRAINT series_series_id_key UNIQUE (series_id);
ALTER TABLE series ADD CONSTRAINT series_pkey PRIMARY KEY (id);

ALTER TABLE settings DROP CONSTRAINT settings_pkey;
ALTER TABLE settings ADD CONSTRAINT settings_key_key UNIQUE (key);
ALTER TABLE settings ADD CONSTRAINT settings_pkey PRIMARY KEY (id);

ALTER TABLE teams DROP CONSTRAINT teams_pkey;
ALTER TABLE teams ADD CONSTRAINT teams_team_id_key UNIQUE (team_id);
ALTER TABLE teams ADD CONSTRAINT teams_pkey PRIMARY KEY (id);

ALTER TABLE match_broadcasters
	ADD CONSTRAINT match_broadcasters_match_id_fkey
	FOREIGN KEY (match_id) REFERENCES matches (match_id) ON DELETE CASCADE;
ALTER TABLE match_coaches
	ADD CONSTRAINT match_coaches_match_id_fkey
	FOREIGN KEY (match_id) REFERENCES matches (match_id) ON DELETE CASCADE;
ALTER TABLE match_draft
	ADD CONSTRAINT match_draft_match_id_fkey
	FOREIGN KEY (match_id) REFERENCES matches (match_id) ON DELETE CASCADE;
ALTER TABLE match_objectives
	ADD CONSTRAINT match_objectives_match_id_fkey
	FOREIGN KEY (match_id) REFERENCES matches (match_id) ON DELETE CASCADE;
ALTER TABLE match_player_ability_upgrades
	ADD CONSTRAINT match_player_ability_upgrades_match_id_fkey
	FOREIGN KEY (match_id) REFERENCES matches (match_id) ON DELETE CASCADE;
ALTER TABLE match_player_buffs
	ADD CONSTRAINT match_player_buffs_match_id_fkey
	FOREIGN KEY (match_id) REFERENCES matches (match_id) ON DELETE CASCADE;
ALTER TABLE match_player_damage_breakdown
	ADD CONSTRAINT match_player_damage_breakdown_match_id_fkey
	FOREIGN KEY (match_id) REFERENCES matches (match_id) ON DELETE CASCADE;
ALTER TABLE match_player_units
	ADD CONSTRAINT match_player_units_match_id_fkey
	FOREIGN KEY (match_id) REFERENCES matches (match_id) ON DELETE CASCADE;
ALTER TABLE match_players
	ADD CONSTRAINT match_players_match_id_fkey
	FOREIGN KEY (match_id) REFERENCES matches (match_id) ON DELETE CASCADE;
ALTER TABLE match_replays
	ADD CONSTRAINT match_replays_match_id_fkey
	FOREIGN KEY (match_id) REFERENCES matches (match_id) ON DELETE CASCADE;
ALTER TABLE matches
	ADD CONSTRAINT matches_league_id_fkey
	FOREIGN KEY (league_id) REFERENCES leagues (league_id) ON DELETE SET NULL;
ALTER TABLE matches
	ADD CONSTRAINT matches_series_id_fkey
	FOREIGN KEY (series_id) REFERENCES series (series_id) ON DELETE SET NULL;
ALTER TABLE matches
	ADD CONSTRAINT matches_radiant_team_id_fkey
	FOREIGN KEY (radiant_team_id) REFERENCES teams (team_id) ON DELETE SET NULL;
ALTER TABLE matches
	ADD CONSTRAINT matches_dire_team_id_fkey
	FOREIGN KEY (dire_team_id) REFERENCES teams (team_id) ON DELETE SET NULL;
ALTER TABLE matches
	ADD CONSTRAINT matches_patch_fkey
	FOREIGN KEY (patch) REFERENCES patches (patch) ON DELETE SET NULL;
ALTER TABLE series
	ADD CONSTRAINT series_league_id_fkey
	FOREIGN KEY (league_id) REFERENCES leagues (league_id) ON DELETE SET NULL;
ALTER TABLE series
	ADD CONSTRAINT series_radiant_team_id_fkey
	FOREIGN KEY (radiant_team_id) REFERENCES teams (team_id) ON DELETE SET NULL;
ALTER TABLE series
	ADD CONSTRAINT series_dire_team_id_fkey
	FOREIGN KEY (dire_team_id) REFERENCES teams (team_id) ON DELETE SET NULL;
ALTER TABLE players
	ADD CONSTRAINT players_current_team_id_fkey
	FOREIGN KEY (current_team_id) REFERENCES teams (team_id) ON DELETE SET NULL;

-- migrate:down

ALTER TABLE match_broadcasters DROP CONSTRAINT match_broadcasters_match_id_fkey;
ALTER TABLE match_coaches DROP CONSTRAINT match_coaches_match_id_fkey;
ALTER TABLE match_draft DROP CONSTRAINT match_draft_match_id_fkey;
ALTER TABLE match_objectives DROP CONSTRAINT match_objectives_match_id_fkey;
ALTER TABLE match_player_ability_upgrades
	DROP CONSTRAINT match_player_ability_upgrades_match_id_fkey;
ALTER TABLE match_player_buffs DROP CONSTRAINT match_player_buffs_match_id_fkey;
ALTER TABLE match_player_damage_breakdown
	DROP CONSTRAINT match_player_damage_breakdown_match_id_fkey;
ALTER TABLE match_player_units DROP CONSTRAINT match_player_units_match_id_fkey;
ALTER TABLE match_players DROP CONSTRAINT match_players_match_id_fkey;
ALTER TABLE match_replays DROP CONSTRAINT match_replays_match_id_fkey;
ALTER TABLE matches DROP CONSTRAINT matches_league_id_fkey;
ALTER TABLE matches DROP CONSTRAINT matches_series_id_fkey;
ALTER TABLE matches DROP CONSTRAINT matches_radiant_team_id_fkey;
ALTER TABLE matches DROP CONSTRAINT matches_dire_team_id_fkey;
ALTER TABLE matches DROP CONSTRAINT matches_patch_fkey;
ALTER TABLE series DROP CONSTRAINT series_league_id_fkey;
ALTER TABLE series DROP CONSTRAINT series_radiant_team_id_fkey;
ALTER TABLE series DROP CONSTRAINT series_dire_team_id_fkey;
ALTER TABLE players DROP CONSTRAINT players_current_team_id_fkey;

ALTER TABLE heroes DROP CONSTRAINT heroes_pkey;
ALTER TABLE heroes DROP CONSTRAINT heroes_hero_id_key;
ALTER TABLE ingest_cursors DROP CONSTRAINT ingest_cursors_pkey;
ALTER TABLE ingest_cursors DROP CONSTRAINT ingest_cursors_key_key;
ALTER TABLE items DROP CONSTRAINT items_pkey;
ALTER TABLE items DROP CONSTRAINT items_item_id_key;
ALTER TABLE league_ingest_runs DROP CONSTRAINT league_ingest_runs_pkey;
ALTER TABLE league_ingest_runs DROP CONSTRAINT league_ingest_runs_run_id_key;
ALTER TABLE leagues DROP CONSTRAINT leagues_pkey;
ALTER TABLE leagues DROP CONSTRAINT leagues_league_id_key;
ALTER TABLE marketplace_orders DROP CONSTRAINT marketplace_orders_pkey;
ALTER TABLE marketplace_orders DROP CONSTRAINT marketplace_orders_order_id_key;
ALTER TABLE match_broadcasters DROP CONSTRAINT match_broadcasters_pkey;
ALTER TABLE match_broadcasters DROP CONSTRAINT match_broadcasters_match_id_seq_key;
ALTER TABLE match_coaches DROP CONSTRAINT match_coaches_pkey;
ALTER TABLE match_coaches DROP CONSTRAINT match_coaches_match_id_account_id_key;
ALTER TABLE match_draft DROP CONSTRAINT match_draft_pkey;
ALTER TABLE match_draft DROP CONSTRAINT match_draft_match_id_ord_key;
ALTER TABLE match_objectives DROP CONSTRAINT match_objectives_pkey;
ALTER TABLE match_objectives DROP CONSTRAINT match_objectives_match_id_seq_key;
ALTER TABLE match_player_ability_upgrades
	DROP CONSTRAINT match_player_ability_upgrades_pkey;
ALTER TABLE match_player_ability_upgrades
	DROP CONSTRAINT match_player_ability_upgrades_match_slot_seq_key;
ALTER TABLE match_player_buffs DROP CONSTRAINT match_player_buffs_pkey;
ALTER TABLE match_player_buffs DROP CONSTRAINT match_player_buffs_match_slot_buff_key;
ALTER TABLE match_player_damage_breakdown
	DROP CONSTRAINT match_player_damage_breakdown_pkey;
ALTER TABLE match_player_damage_breakdown
	DROP CONSTRAINT match_player_damage_breakdown_natural_key;
ALTER TABLE match_player_units DROP CONSTRAINT match_player_units_pkey;
ALTER TABLE match_player_units DROP CONSTRAINT match_player_units_match_slot_unit_key;
ALTER TABLE match_players DROP CONSTRAINT match_players_pkey;
ALTER TABLE match_players DROP CONSTRAINT match_players_match_id_player_slot_key;
ALTER TABLE match_replays DROP CONSTRAINT match_replays_pkey;
ALTER TABLE match_replays DROP CONSTRAINT match_replays_match_id_key;
ALTER TABLE matches DROP CONSTRAINT matches_pkey;
ALTER TABLE matches DROP CONSTRAINT matches_match_id_key;
ALTER TABLE patches DROP CONSTRAINT patches_pkey;
ALTER TABLE patches DROP CONSTRAINT patches_patch_key;
ALTER TABLE players DROP CONSTRAINT players_pkey;
ALTER TABLE players DROP CONSTRAINT players_account_id_key;
ALTER TABLE series DROP CONSTRAINT series_pkey;
ALTER TABLE series DROP CONSTRAINT series_series_id_key;
ALTER TABLE settings DROP CONSTRAINT settings_pkey;
ALTER TABLE settings DROP CONSTRAINT settings_key_key;
ALTER TABLE teams DROP CONSTRAINT teams_pkey;
ALTER TABLE teams DROP CONSTRAINT teams_team_id_key;

ALTER TABLE heroes DROP COLUMN id;
ALTER TABLE ingest_cursors DROP COLUMN id;
ALTER TABLE items DROP COLUMN id;
ALTER TABLE league_ingest_runs DROP COLUMN id;
ALTER TABLE leagues DROP COLUMN id;
ALTER TABLE marketplace_orders DROP COLUMN id;
ALTER TABLE match_broadcasters DROP COLUMN id;
ALTER TABLE match_coaches DROP COLUMN id;
ALTER TABLE match_draft DROP COLUMN id;
ALTER TABLE match_objectives DROP COLUMN id;
ALTER TABLE match_player_ability_upgrades DROP COLUMN id;
ALTER TABLE match_player_buffs DROP COLUMN id;
ALTER TABLE match_player_damage_breakdown DROP COLUMN id;
ALTER TABLE match_player_units DROP COLUMN id;
ALTER TABLE match_players DROP COLUMN id;
ALTER TABLE match_replays DROP COLUMN id;
ALTER TABLE matches DROP COLUMN id;
ALTER TABLE patches DROP COLUMN id;
ALTER TABLE players DROP COLUMN id;
ALTER TABLE series DROP COLUMN id;
ALTER TABLE settings DROP COLUMN id;
ALTER TABLE teams DROP COLUMN id;

ALTER TABLE heroes RENAME COLUMN hero_id TO id;
ALTER TABLE items RENAME COLUMN item_id TO id;
ALTER TABLE marketplace_orders RENAME COLUMN order_id TO id;
ALTER TABLE league_ingest_runs RENAME COLUMN run_id TO id;

ALTER TABLE heroes ADD CONSTRAINT heroes_pkey PRIMARY KEY (id);
ALTER TABLE ingest_cursors ADD CONSTRAINT ingest_cursors_pkey PRIMARY KEY (key);
ALTER TABLE items ADD CONSTRAINT items_pkey PRIMARY KEY (id);
ALTER TABLE league_ingest_runs ADD CONSTRAINT league_ingest_runs_pkey PRIMARY KEY (id);
ALTER TABLE leagues ADD CONSTRAINT leagues_pkey PRIMARY KEY (league_id);
ALTER TABLE marketplace_orders ADD CONSTRAINT marketplace_orders_pkey PRIMARY KEY (id);
ALTER TABLE match_broadcasters
	ADD CONSTRAINT match_broadcasters_pkey PRIMARY KEY (match_id, seq);
ALTER TABLE match_coaches
	ADD CONSTRAINT match_coaches_pkey PRIMARY KEY (match_id, account_id);
ALTER TABLE match_draft
	ADD CONSTRAINT match_draft_pkey PRIMARY KEY (match_id, ord);
ALTER TABLE match_objectives
	ADD CONSTRAINT match_objectives_pkey PRIMARY KEY (match_id, seq);
ALTER TABLE match_player_ability_upgrades
	ADD CONSTRAINT match_player_ability_upgrades_pkey
	PRIMARY KEY (match_id, player_slot, seq);
ALTER TABLE match_player_buffs
	ADD CONSTRAINT match_player_buffs_pkey PRIMARY KEY (match_id, player_slot, buff_id);
ALTER TABLE match_player_damage_breakdown
	ADD CONSTRAINT match_player_damage_breakdown_pkey
	PRIMARY KEY (match_id, player_slot, direction, damage_type);
ALTER TABLE match_player_units
	ADD CONSTRAINT match_player_units_pkey PRIMARY KEY (match_id, player_slot, unit_name);
ALTER TABLE match_players
	ADD CONSTRAINT match_players_pkey PRIMARY KEY (match_id, player_slot);
ALTER TABLE match_replays ADD CONSTRAINT match_replays_pkey PRIMARY KEY (match_id);
ALTER TABLE matches ADD CONSTRAINT matches_pkey PRIMARY KEY (match_id);
ALTER TABLE patches ADD CONSTRAINT patches_pkey PRIMARY KEY (patch);
ALTER TABLE players ADD CONSTRAINT players_pkey PRIMARY KEY (account_id);
ALTER TABLE series ADD CONSTRAINT series_pkey PRIMARY KEY (series_id);
ALTER TABLE settings ADD CONSTRAINT settings_pkey PRIMARY KEY (key);
ALTER TABLE teams ADD CONSTRAINT teams_pkey PRIMARY KEY (team_id);

ALTER TABLE match_broadcasters
	ADD CONSTRAINT match_broadcasters_match_id_fkey
	FOREIGN KEY (match_id) REFERENCES matches (match_id) ON DELETE CASCADE;
ALTER TABLE match_coaches
	ADD CONSTRAINT match_coaches_match_id_fkey
	FOREIGN KEY (match_id) REFERENCES matches (match_id) ON DELETE CASCADE;
ALTER TABLE match_draft
	ADD CONSTRAINT match_draft_match_id_fkey
	FOREIGN KEY (match_id) REFERENCES matches (match_id) ON DELETE CASCADE;
ALTER TABLE match_objectives
	ADD CONSTRAINT match_objectives_match_id_fkey
	FOREIGN KEY (match_id) REFERENCES matches (match_id) ON DELETE CASCADE;
ALTER TABLE match_player_ability_upgrades
	ADD CONSTRAINT match_player_ability_upgrades_match_id_fkey
	FOREIGN KEY (match_id) REFERENCES matches (match_id) ON DELETE CASCADE;
ALTER TABLE match_player_buffs
	ADD CONSTRAINT match_player_buffs_match_id_fkey
	FOREIGN KEY (match_id) REFERENCES matches (match_id) ON DELETE CASCADE;
ALTER TABLE match_player_damage_breakdown
	ADD CONSTRAINT match_player_damage_breakdown_match_id_fkey
	FOREIGN KEY (match_id) REFERENCES matches (match_id) ON DELETE CASCADE;
ALTER TABLE match_player_units
	ADD CONSTRAINT match_player_units_match_id_fkey
	FOREIGN KEY (match_id) REFERENCES matches (match_id) ON DELETE CASCADE;
ALTER TABLE match_players
	ADD CONSTRAINT match_players_match_id_fkey
	FOREIGN KEY (match_id) REFERENCES matches (match_id) ON DELETE CASCADE;
ALTER TABLE match_replays
	ADD CONSTRAINT match_replays_match_id_fkey
	FOREIGN KEY (match_id) REFERENCES matches (match_id) ON DELETE CASCADE;
ALTER TABLE matches
	ADD CONSTRAINT matches_league_id_fkey
	FOREIGN KEY (league_id) REFERENCES leagues (league_id) ON DELETE SET NULL;
ALTER TABLE matches
	ADD CONSTRAINT matches_series_id_fkey
	FOREIGN KEY (series_id) REFERENCES series (series_id) ON DELETE SET NULL;
ALTER TABLE matches
	ADD CONSTRAINT matches_radiant_team_id_fkey
	FOREIGN KEY (radiant_team_id) REFERENCES teams (team_id) ON DELETE SET NULL;
ALTER TABLE matches
	ADD CONSTRAINT matches_dire_team_id_fkey
	FOREIGN KEY (dire_team_id) REFERENCES teams (team_id) ON DELETE SET NULL;
ALTER TABLE matches
	ADD CONSTRAINT matches_patch_fkey
	FOREIGN KEY (patch) REFERENCES patches (patch) ON DELETE SET NULL;
ALTER TABLE series
	ADD CONSTRAINT series_league_id_fkey
	FOREIGN KEY (league_id) REFERENCES leagues (league_id) ON DELETE SET NULL;
ALTER TABLE series
	ADD CONSTRAINT series_radiant_team_id_fkey
	FOREIGN KEY (radiant_team_id) REFERENCES teams (team_id) ON DELETE SET NULL;
ALTER TABLE series
	ADD CONSTRAINT series_dire_team_id_fkey
	FOREIGN KEY (dire_team_id) REFERENCES teams (team_id) ON DELETE SET NULL;
ALTER TABLE players
	ADD CONSTRAINT players_current_team_id_fkey
	FOREIGN KEY (current_team_id) REFERENCES teams (team_id) ON DELETE SET NULL;
