-- migrate:up

ALTER TABLE match_players
	ADD COLUMN player_id BIGINT REFERENCES players (id) ON DELETE SET NULL,
	ADD COLUMN team_id INTEGER REFERENCES teams (team_id) ON DELETE SET NULL;

ALTER TABLE match_player_buffs
	ADD COLUMN account_id BIGINT NOT NULL DEFAULT 0,
	ADD COLUMN player_id BIGINT REFERENCES players (id) ON DELETE SET NULL,
	ADD COLUMN team_id INTEGER REFERENCES teams (team_id) ON DELETE SET NULL;

ALTER TABLE match_player_ability_upgrades
	ADD COLUMN account_id BIGINT NOT NULL DEFAULT 0,
	ADD COLUMN player_id BIGINT REFERENCES players (id) ON DELETE SET NULL,
	ADD COLUMN team_id INTEGER REFERENCES teams (team_id) ON DELETE SET NULL;

ALTER TABLE match_player_damage_breakdown
	ADD COLUMN account_id BIGINT NOT NULL DEFAULT 0,
	ADD COLUMN player_id BIGINT REFERENCES players (id) ON DELETE SET NULL,
	ADD COLUMN team_id INTEGER REFERENCES teams (team_id) ON DELETE SET NULL;

ALTER TABLE match_player_units
	ADD COLUMN account_id BIGINT NOT NULL DEFAULT 0,
	ADD COLUMN player_id BIGINT REFERENCES players (id) ON DELETE SET NULL,
	ADD COLUMN team_id INTEGER REFERENCES teams (team_id) ON DELETE SET NULL;

ALTER TABLE match_draft
	ADD COLUMN account_id BIGINT,
	ADD COLUMN player_id BIGINT REFERENCES players (id) ON DELETE SET NULL,
	ADD COLUMN team_id INTEGER REFERENCES teams (team_id) ON DELETE SET NULL;

ALTER TABLE match_objectives
	ADD COLUMN account_id BIGINT,
	ADD COLUMN player_id BIGINT REFERENCES players (id) ON DELETE SET NULL,
	ADD COLUMN team_id INTEGER REFERENCES teams (team_id) ON DELETE SET NULL;

ALTER TABLE match_coaches
	ADD COLUMN player_id BIGINT REFERENCES players (id) ON DELETE SET NULL,
	ADD COLUMN team_id INTEGER REFERENCES teams (team_id) ON DELETE SET NULL;

ALTER TABLE match_broadcasters
	ADD COLUMN player_id BIGINT REFERENCES players (id) ON DELETE SET NULL;

ALTER TABLE matches
	ADD COLUMN radiant_captain_player_id BIGINT
		REFERENCES players (id) ON DELETE SET NULL,
	ADD COLUMN dire_captain_player_id BIGINT
		REFERENCES players (id) ON DELETE SET NULL;

UPDATE match_players mp
SET player_id = p.id
FROM players p
WHERE mp.player_id IS NULL
	AND mp.account_id > 0
	AND p.account_id = mp.account_id;

UPDATE match_players mp
SET team_id = CASE
	WHEN mp.player_slot < 128 THEN m.radiant_team_id
	ELSE m.dire_team_id
END
FROM matches m
WHERE mp.match_id = m.match_id
	AND mp.team_id IS NULL
	AND CASE
		WHEN mp.player_slot < 128 THEN m.radiant_team_id
		ELSE m.dire_team_id
	END IS NOT NULL;

DELETE FROM match_player_buffs b
WHERE NOT EXISTS (
	SELECT 1
	FROM match_players mp
	WHERE mp.match_id = b.match_id
		AND mp.player_slot = b.player_slot
);

DELETE FROM match_player_ability_upgrades u
WHERE NOT EXISTS (
	SELECT 1
	FROM match_players mp
	WHERE mp.match_id = u.match_id
		AND mp.player_slot = u.player_slot
);

DELETE FROM match_player_damage_breakdown d
WHERE NOT EXISTS (
	SELECT 1
	FROM match_players mp
	WHERE mp.match_id = d.match_id
		AND mp.player_slot = d.player_slot
);

DELETE FROM match_player_units u
WHERE NOT EXISTS (
	SELECT 1
	FROM match_players mp
	WHERE mp.match_id = u.match_id
		AND mp.player_slot = u.player_slot
);

UPDATE match_player_buffs b
SET
	account_id = mp.account_id,
	player_id = mp.player_id,
	team_id = mp.team_id
FROM match_players mp
WHERE b.match_id = mp.match_id
	AND b.player_slot = mp.player_slot;

UPDATE match_player_ability_upgrades u
SET
	account_id = mp.account_id,
	player_id = mp.player_id,
	team_id = mp.team_id
FROM match_players mp
WHERE u.match_id = mp.match_id
	AND u.player_slot = mp.player_slot;

UPDATE match_player_damage_breakdown d
SET
	account_id = mp.account_id,
	player_id = mp.player_id,
	team_id = mp.team_id
FROM match_players mp
WHERE d.match_id = mp.match_id
	AND d.player_slot = mp.player_slot;

UPDATE match_player_units u
SET
	account_id = mp.account_id,
	player_id = mp.player_id,
	team_id = mp.team_id
FROM match_players mp
WHERE u.match_id = mp.match_id
	AND u.player_slot = mp.player_slot;

ALTER TABLE match_player_buffs
	ADD CONSTRAINT match_player_buffs_match_player_fkey
	FOREIGN KEY (match_id, player_slot)
	REFERENCES match_players (match_id, player_slot)
	ON DELETE CASCADE;

ALTER TABLE match_player_ability_upgrades
	ADD CONSTRAINT match_player_ability_upgrades_match_player_fkey
	FOREIGN KEY (match_id, player_slot)
	REFERENCES match_players (match_id, player_slot)
	ON DELETE CASCADE;

ALTER TABLE match_player_damage_breakdown
	ADD CONSTRAINT match_player_damage_breakdown_match_player_fkey
	FOREIGN KEY (match_id, player_slot)
	REFERENCES match_players (match_id, player_slot)
	ON DELETE CASCADE;

ALTER TABLE match_player_units
	ADD CONSTRAINT match_player_units_match_player_fkey
	FOREIGN KEY (match_id, player_slot)
	REFERENCES match_players (match_id, player_slot)
	ON DELETE CASCADE;

UPDATE match_draft d
SET
	account_id = mp.account_id,
	player_id = mp.player_id,
	team_id = COALESCE(
		mp.team_id,
		CASE
			WHEN d.team = 0 THEN m.radiant_team_id
			WHEN d.team = 1 THEN m.dire_team_id
		END
	)
FROM matches m
LEFT JOIN match_players mp
	ON mp.match_id = d.match_id
	AND mp.player_slot = d.player_slot
WHERE m.match_id = d.match_id;

UPDATE match_draft d
SET team_id = CASE
	WHEN d.team = 0 THEN m.radiant_team_id
	ELSE m.dire_team_id
END
FROM matches m
WHERE d.match_id = m.match_id
	AND d.team_id IS NULL
	AND CASE
		WHEN d.team = 0 THEN m.radiant_team_id
		ELSE m.dire_team_id
	END IS NOT NULL;

UPDATE match_objectives o
SET
	account_id = mp.account_id,
	player_id = mp.player_id,
	team_id = COALESCE(
		mp.team_id,
		CASE
			WHEN o.team = 0 THEN m.radiant_team_id
			WHEN o.team = 1 THEN m.dire_team_id
		END
	)
FROM matches m
LEFT JOIN match_players mp
	ON mp.match_id = o.match_id
	AND mp.player_slot = CASE
		WHEN o.slot IS NULL THEN NULL
		WHEN o.slot BETWEEN 0 AND 4 THEN o.slot
		WHEN o.slot BETWEEN 5 AND 9 THEN o.slot + 123
		ELSE o.slot
	END
WHERE m.match_id = o.match_id;

UPDATE match_objectives o
SET team_id = CASE
	WHEN o.team = 0 THEN m.radiant_team_id
	WHEN o.team = 1 THEN m.dire_team_id
END
FROM matches m
WHERE o.match_id = m.match_id
	AND o.team_id IS NULL
	AND CASE
		WHEN o.team = 0 THEN m.radiant_team_id
		WHEN o.team = 1 THEN m.dire_team_id
	END IS NOT NULL;

UPDATE match_coaches c
SET player_id = p.id
FROM players p
WHERE c.player_id IS NULL
	AND c.account_id > 0
	AND p.account_id = c.account_id;

UPDATE match_coaches c
SET team_id = CASE
	WHEN c.coach_team IN (0, 2) THEN m.radiant_team_id
	WHEN c.coach_team IN (1, 3) THEN m.dire_team_id
END
FROM matches m
WHERE c.match_id = m.match_id
	AND c.team_id IS NULL
	AND CASE
		WHEN c.coach_team IN (0, 2) THEN m.radiant_team_id
		WHEN c.coach_team IN (1, 3) THEN m.dire_team_id
	END IS NOT NULL;

UPDATE match_broadcasters b
SET player_id = p.id
FROM players p
WHERE b.player_id IS NULL
	AND b.account_id > 0
	AND p.account_id = b.account_id;

UPDATE matches m
SET radiant_captain_player_id = p.id
FROM players p
WHERE m.radiant_captain_player_id IS NULL
	AND m.radiant_captain > 0
	AND p.account_id = m.radiant_captain;

UPDATE matches m
SET dire_captain_player_id = p.id
FROM players p
WHERE m.dire_captain_player_id IS NULL
	AND m.dire_captain > 0
	AND p.account_id = m.dire_captain;

CREATE INDEX match_players_player_idx
	ON match_players (player_id)
	WHERE player_id IS NOT NULL;
CREATE INDEX match_players_team_idx
	ON match_players (team_id)
	WHERE team_id IS NOT NULL;

CREATE INDEX match_player_buffs_player_idx
	ON match_player_buffs (player_id)
	WHERE player_id IS NOT NULL;
CREATE INDEX match_player_buffs_team_idx
	ON match_player_buffs (team_id)
	WHERE team_id IS NOT NULL;

CREATE INDEX match_player_ability_upgrades_player_idx
	ON match_player_ability_upgrades (player_id)
	WHERE player_id IS NOT NULL;
CREATE INDEX match_player_ability_upgrades_team_idx
	ON match_player_ability_upgrades (team_id)
	WHERE team_id IS NOT NULL;

CREATE INDEX match_player_damage_breakdown_player_idx
	ON match_player_damage_breakdown (player_id)
	WHERE player_id IS NOT NULL;
CREATE INDEX match_player_damage_breakdown_team_idx
	ON match_player_damage_breakdown (team_id)
	WHERE team_id IS NOT NULL;

CREATE INDEX match_player_units_player_idx
	ON match_player_units (player_id)
	WHERE player_id IS NOT NULL;
CREATE INDEX match_player_units_team_idx
	ON match_player_units (team_id)
	WHERE team_id IS NOT NULL;

CREATE INDEX match_draft_player_idx
	ON match_draft (player_id)
	WHERE player_id IS NOT NULL;
CREATE INDEX match_draft_team_idx
	ON match_draft (team_id)
	WHERE team_id IS NOT NULL;

CREATE INDEX match_objectives_player_idx
	ON match_objectives (player_id)
	WHERE player_id IS NOT NULL;
CREATE INDEX match_objectives_team_idx
	ON match_objectives (team_id)
	WHERE team_id IS NOT NULL;

CREATE INDEX match_coaches_player_idx
	ON match_coaches (player_id)
	WHERE player_id IS NOT NULL;
CREATE INDEX match_coaches_team_idx
	ON match_coaches (team_id)
	WHERE team_id IS NOT NULL;

CREATE INDEX match_broadcasters_player_idx
	ON match_broadcasters (player_id)
	WHERE player_id IS NOT NULL;

CREATE INDEX matches_radiant_captain_player_idx
	ON matches (radiant_captain_player_id)
	WHERE radiant_captain_player_id IS NOT NULL;
CREATE INDEX matches_dire_captain_player_idx
	ON matches (dire_captain_player_id)
	WHERE dire_captain_player_id IS NOT NULL;

-- migrate:down

DROP INDEX IF EXISTS matches_dire_captain_player_idx;
DROP INDEX IF EXISTS matches_radiant_captain_player_idx;
DROP INDEX IF EXISTS match_broadcasters_player_idx;
DROP INDEX IF EXISTS match_coaches_team_idx;
DROP INDEX IF EXISTS match_coaches_player_idx;
DROP INDEX IF EXISTS match_objectives_team_idx;
DROP INDEX IF EXISTS match_objectives_player_idx;
DROP INDEX IF EXISTS match_draft_team_idx;
DROP INDEX IF EXISTS match_draft_player_idx;
DROP INDEX IF EXISTS match_player_units_team_idx;
DROP INDEX IF EXISTS match_player_units_player_idx;
DROP INDEX IF EXISTS match_player_damage_breakdown_team_idx;
DROP INDEX IF EXISTS match_player_damage_breakdown_player_idx;
DROP INDEX IF EXISTS match_player_ability_upgrades_team_idx;
DROP INDEX IF EXISTS match_player_ability_upgrades_player_idx;
DROP INDEX IF EXISTS match_player_buffs_team_idx;
DROP INDEX IF EXISTS match_player_buffs_player_idx;
DROP INDEX IF EXISTS match_players_team_idx;
DROP INDEX IF EXISTS match_players_player_idx;

ALTER TABLE match_player_units
	DROP CONSTRAINT IF EXISTS match_player_units_match_player_fkey;
ALTER TABLE match_player_damage_breakdown
	DROP CONSTRAINT IF EXISTS match_player_damage_breakdown_match_player_fkey;
ALTER TABLE match_player_ability_upgrades
	DROP CONSTRAINT IF EXISTS match_player_ability_upgrades_match_player_fkey;
ALTER TABLE match_player_buffs
	DROP CONSTRAINT IF EXISTS match_player_buffs_match_player_fkey;

ALTER TABLE matches
	DROP COLUMN IF EXISTS dire_captain_player_id,
	DROP COLUMN IF EXISTS radiant_captain_player_id;

ALTER TABLE match_broadcasters
	DROP COLUMN IF EXISTS player_id;

ALTER TABLE match_coaches
	DROP COLUMN IF EXISTS team_id,
	DROP COLUMN IF EXISTS player_id;

ALTER TABLE match_objectives
	DROP COLUMN IF EXISTS team_id,
	DROP COLUMN IF EXISTS player_id,
	DROP COLUMN IF EXISTS account_id;

ALTER TABLE match_draft
	DROP COLUMN IF EXISTS team_id,
	DROP COLUMN IF EXISTS player_id,
	DROP COLUMN IF EXISTS account_id;

ALTER TABLE match_player_units
	DROP COLUMN IF EXISTS team_id,
	DROP COLUMN IF EXISTS player_id,
	DROP COLUMN IF EXISTS account_id;

ALTER TABLE match_player_damage_breakdown
	DROP COLUMN IF EXISTS team_id,
	DROP COLUMN IF EXISTS player_id,
	DROP COLUMN IF EXISTS account_id;

ALTER TABLE match_player_ability_upgrades
	DROP COLUMN IF EXISTS team_id,
	DROP COLUMN IF EXISTS player_id,
	DROP COLUMN IF EXISTS account_id;

ALTER TABLE match_player_buffs
	DROP COLUMN IF EXISTS team_id,
	DROP COLUMN IF EXISTS player_id,
	DROP COLUMN IF EXISTS account_id;

ALTER TABLE match_players
	DROP COLUMN IF EXISTS team_id,
	DROP COLUMN IF EXISTS player_id;
