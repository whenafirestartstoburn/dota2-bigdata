-- Always-null on prod: fill what has a source, drop what does not.
-- steam_id is Steam64 text. last_match_seq_num is max seq per league.
-- series.ended_at only for Bo3/Bo5 that already have enough wins.
-- match_draft.player_slot from the pick's hero on match_players.

-- migrate:up

UPDATE players
SET steam_id = (76561197960265728::numeric + account_id)::text
WHERE steam_id IS NULL
	AND account_id > 0;

UPDATE leagues AS l
SET last_match_seq_num = s.max_seq
FROM (
	SELECT league_id, max(match_seq_num) AS max_seq
	FROM matches
	WHERE match_seq_num IS NOT NULL
	GROUP BY league_id
) AS s
WHERE l.league_id = s.league_id
	AND l.last_match_seq_num IS NULL;

UPDATE series AS s
SET ended_at = to_timestamp(
	COALESCE(m.start_time, 0) + COALESCE(m.duration, 0)
)
FROM matches AS m
WHERE s.ended_at IS NULL
	AND m.match_id = s.last_match_id
	AND m.start_time IS NOT NULL
	AND (
		(s.series_type = 1 AND GREATEST(s.radiant_wins, s.dire_wins) >= 2)
		OR (s.series_type = 2 AND GREATEST(s.radiant_wins, s.dire_wins) >= 3)
	);

UPDATE match_draft AS d
SET player_slot = p.player_slot
FROM match_players AS p
WHERE d.player_slot IS NULL
	AND d.is_pick
	AND d.hero_id <> 0
	AND p.match_id = d.match_id
	AND p.hero_id = d.hero_id;

ALTER TABLE match_players
	DROP COLUMN backpack_3,
	DROP COLUMN party_size;

ALTER TABLE matches
	DROP COLUMN positive_votes,
	DROP COLUMN negative_votes,
	DROP COLUMN next_attempt_at;

ALTER TABLE steam_api_keys
	DROP COLUMN daily_quota;

-- migrate:down

ALTER TABLE match_players
	ADD COLUMN backpack_3 integer,
	ADD COLUMN party_size integer;

ALTER TABLE matches
	ADD COLUMN positive_votes integer,
	ADD COLUMN negative_votes integer,
	ADD COLUMN next_attempt_at timestamptz;

ALTER TABLE steam_api_keys
	ADD COLUMN daily_quota integer;

UPDATE players SET steam_id = NULL;
UPDATE leagues SET last_match_seq_num = NULL;
UPDATE series SET ended_at = NULL;
UPDATE match_draft SET player_slot = NULL
WHERE player_slot IS NOT NULL;
