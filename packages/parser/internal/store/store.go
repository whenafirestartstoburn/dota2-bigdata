package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"dota2-collector/parser/internal/model"
	"dota2-collector/parser/internal/version"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	pool *pgxpool.Pool
}

type Claimed struct {
	MatchID       uint64
	StartTime     time.Time
	S3Bucket      string
	S3Key         string
	ParserVersion *int32
	Status        string
}

func Open(ctx context.Context, uri string) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(uri)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 8
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	return &Store{pool: pool}, nil
}

func (s *Store) Close() {
	s.pool.Close()
}

func (s *Store) Ping(ctx context.Context) error {
	return s.pool.Ping(ctx)
}

func (s *Store) CountReplayStatus(ctx context.Context) (map[string]int64, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT status::text, count(*)
		FROM match_replays
		WHERE status IN ('stored', 'parsing', 'failed')
		GROUP BY status
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int64{"stored": 0, "parsing": 0, "failed": 0}
	for rows.Next() {
		var status string
		var n int64
		if err := rows.Scan(&status, &n); err != nil {
			return nil, err
		}
		out[status] = n
	}
	return out, rows.Err()
}

func (s *Store) Parallelism(ctx context.Context) (int, error) {
	var raw string
	err := s.pool.QueryRow(ctx, `SELECT value FROM settings WHERE key = 'parser_parallelism'`).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return 3, nil
	}
	if err != nil {
		return 3, err
	}
	n := 0
	for _, c := range raw {
		if c < '0' || c > '9' {
			continue
		}
		n = n*10 + int(c-'0')
	}
	if n < 1 {
		return 3, nil
	}
	return n, nil
}

func (s *Store) ReclaimStale(ctx context.Context, olderThan time.Duration) (int64, error) {
	tag, err := s.pool.Exec(ctx, `
		UPDATE match_replays
		SET status = 'stored',
			last_error = 'stale parsing claim released',
			updated_at = now()
		WHERE status = 'parsing'
		  AND updated_at < now() - $1::interval
	`, olderThan)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func (s *Store) Claim(ctx context.Context) (*Claimed, error) {
	row := s.pool.QueryRow(ctx, `
		WITH next AS (
			SELECT r.id
			FROM match_replays r
			WHERE r.status = 'stored'
			  AND r.s3_key IS NOT NULL
			  AND r.s3_key <> ''
			ORDER BY r.priority ASC, r.stored_at ASC NULLS LAST, r.id ASC
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		)
		UPDATE match_replays r
		SET status = 'parsing', updated_at = now()
		FROM next
		WHERE r.id = next.id
		RETURNING r.match_id, r.s3_bucket, r.s3_key, r.parser_version, r.status
	`)
	var c Claimed
	var bucket, key *string
	if err := row.Scan(&c.MatchID, &bucket, &key, &c.ParserVersion, &c.Status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if bucket != nil {
		c.S3Bucket = *bucket
	}
	if key != nil {
		c.S3Key = *key
	}
	if c.ParserVersion != nil && uint16(*c.ParserVersion) >= version.Schema {
		// already parsed at this schema — should not happen for status=stored,
		// but keep the row from being double-written if someone reset status.
	}
	_ = s.pool.QueryRow(ctx, `
		SELECT COALESCE(to_timestamp(start_time), to_timestamp(0))
		FROM matches WHERE match_id = $1
	`, c.MatchID).Scan(&c.StartTime)
	if c.StartTime.IsZero() {
		c.StartTime = time.Unix(0, 0).UTC()
	}
	return &c, nil
}

func (s *Store) Fail(ctx context.Context, matchID uint64, err error) error {
	msg := err.Error()
	if len(msg) > 2000 {
		msg = msg[:2000]
	}
	_, e := s.pool.Exec(ctx, `
		UPDATE match_replays
		SET status = 'failed',
			last_error = $2,
			last_error_at = now(),
			attempts = attempts + 1,
			updated_at = now()
		WHERE match_id = $1
	`, matchID, msg)
	return e
}

func (s *Store) Publish(ctx context.Context, res *model.Result) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `DELETE FROM match_objectives WHERE match_id = $1`, res.MatchID); err != nil {
		return err
	}
	for i, o := range res.Objectives {
		if _, err := tx.Exec(ctx, `
			INSERT INTO match_objectives (match_id, seq, time, kind, team, slot, key, value)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		`, res.MatchID, i, o.Time, o.Kind, o.Team, o.Slot, nullStr(o.Key), o.Value); err != nil {
			return fmt.Errorf("match_objectives: %w", err)
		}
	}

	if len(res.Draft) > 0 {
		if _, err := tx.Exec(ctx, `DELETE FROM match_draft WHERE match_id = $1`, res.MatchID); err != nil {
			return err
		}
		for _, d := range res.Draft {
			slot := int32(d.Slot)
			var slotArg any
			if d.Slot < 0 {
				slotArg = nil
			} else {
				slotArg = slot
			}
			clock := d.Clock
			if _, err := tx.Exec(ctx, `
				INSERT INTO match_draft (match_id, ord, is_pick, hero_id, team, player_slot, clock)
				VALUES ($1, $2, $3, $4, $5, $6, $7)
			`, res.MatchID, int(d.Ord), d.IsPick == 1, d.HeroID, int16(d.Team), slotArg, clock); err != nil {
				return fmt.Errorf("match_draft: %w", err)
			}
		}
	}

	for _, p := range res.PlayerSummary {
		if _, err := tx.Exec(ctx, `
			UPDATE match_players SET
				lane = $3,
				lane_role = $4,
				is_roaming = $5,
				stuns = $6,
				teamfight_participation = $7,
				towers_killed = $8,
				roshans_killed = $9,
				observers_placed = $10,
				sentries_placed = $11,
				camps_stacked = $12,
				creeps_stacked = $13,
				rune_pickups = $14,
				firstblood_claimed = $15,
				updated_at = now()
			WHERE match_id = $1 AND player_slot = $2
		`, res.MatchID, p.Slot, p.Lane, p.LaneRole, p.IsRoaming, p.Stuns,
			p.TeamfightParticipation, p.TowersKilled, p.RoshansKilled,
			p.ObserversPlaced, p.SentriesPlaced, p.CampsStacked, p.CreepsStacked,
			p.RunePickups, p.FirstbloodClaimed); err != nil {
			return fmt.Errorf("match_players: %w", err)
		}
	}

	if _, err := tx.Exec(ctx, `
		UPDATE match_replays SET
			status = 'parsed',
			parser_version = $2,
			parse_run_id = $3,
			parsed_at = now(),
			last_error = NULL,
			updated_at = now()
		WHERE match_id = $1
	`, res.MatchID, int32(res.ParserVersion), int64(res.ParseRunID)); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE matches
		SET phase = 'parsed',
			waiting_for = NULL,
			updated_at = now()
		WHERE match_id = $1
		  AND phase IN ('replay_stored', 'awaiting_replay', 'details_ready')
	`, res.MatchID); err != nil {
		return fmt.Errorf("matches.phase: %w", err)
	}

	return tx.Commit(ctx)
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}
