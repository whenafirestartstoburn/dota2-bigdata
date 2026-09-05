package sink

import (
	"context"
	"fmt"
	"time"

	"dota2-collector/parser/internal/model"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
)

var replayTables = []string{
	"replay_combat_log",
	"replay_intervals",
	"replay_actions",
	"replay_pings",
	"replay_wards",
	"replay_chat",
	"replay_announcements",
	"replay_draft",
	"replay_ability_levels",
	"replay_inventory",
	"replay_neutrals",
	"replay_cosmetics",
	"replay_epilogue",
}

type ClickHouse struct {
	conn driver.Conn
}

func Open(addr, user, password, database string) (*ClickHouse, error) {
	conn, err := clickhouse.Open(&clickhouse.Options{
		Addr: []string{addr},
		Auth: clickhouse.Auth{
			Database: database,
			Username: user,
			Password: password,
		},
		Settings: clickhouse.Settings{
			"async_insert":          0,
			"wait_for_async_insert": 1,
		},
		DialTimeout: 10 * time.Second,
		Compression: &clickhouse.Compression{Method: clickhouse.CompressionLZ4},
	})
	if err != nil {
		return nil, err
	}
	return &ClickHouse{conn: conn}, nil
}

func (c *ClickHouse) Ping(ctx context.Context) error {
	return c.conn.Ping(ctx)
}

func (c *ClickHouse) Close() error {
	return c.conn.Close()
}

// Commit inserts every table. On any error it deletes the run from all
// replay tables so MergeTree does not keep a partial match.
func (c *ClickHouse) Commit(ctx context.Context, res *model.Result) error {
	if err := c.insertAll(ctx, res); err != nil {
		_ = c.Abort(ctx, res.ParseRunID)
		return err
	}
	return nil
}

func (c *ClickHouse) insertAll(ctx context.Context, res *model.Result) error {
	type job struct {
		table string
		fn    func(context.Context) error
	}
	jobs := []job{
		{"replay_combat_log", func(ctx context.Context) error {
			return insert(ctx, c.conn, "replay_combat_log", res.CombatLog)
		}},
		{"replay_intervals", func(ctx context.Context) error {
			return insert(ctx, c.conn, "replay_intervals", res.Intervals)
		}},
		{"replay_actions", func(ctx context.Context) error {
			return insert(ctx, c.conn, "replay_actions", res.Actions)
		}},
		{"replay_pings", func(ctx context.Context) error {
			return insert(ctx, c.conn, "replay_pings", res.Pings)
		}},
		{"replay_wards", func(ctx context.Context) error {
			return insert(ctx, c.conn, "replay_wards", res.Wards)
		}},
		{"replay_chat", func(ctx context.Context) error {
			return insert(ctx, c.conn, "replay_chat", res.Chat)
		}},
		{"replay_announcements", func(ctx context.Context) error {
			return insert(ctx, c.conn, "replay_announcements", res.Announcements)
		}},
		{"replay_draft", func(ctx context.Context) error {
			return insert(ctx, c.conn, "replay_draft", res.Draft)
		}},
		{"replay_ability_levels", func(ctx context.Context) error {
			return insert(ctx, c.conn, "replay_ability_levels", res.AbilityLevels)
		}},
		{"replay_inventory", func(ctx context.Context) error {
			return insert(ctx, c.conn, "replay_inventory", res.Inventory)
		}},
		{"replay_neutrals", func(ctx context.Context) error {
			return insert(ctx, c.conn, "replay_neutrals", res.Neutrals)
		}},
		{"replay_cosmetics", func(ctx context.Context) error {
			return insert(ctx, c.conn, "replay_cosmetics", res.Cosmetics)
		}},
		{"replay_epilogue", func(ctx context.Context) error {
			return insert(ctx, c.conn, "replay_epilogue", res.Epilogue)
		}},
	}
	errCh := make(chan error, len(jobs))
	for _, j := range jobs {
		j := j
		go func() {
			errCh <- j.fn(ctx)
		}()
	}
	var first error
	for range jobs {
		if err := <-errCh; err != nil && first == nil {
			first = err
		}
	}
	return first
}

func insert[T any](ctx context.Context, conn driver.Conn, table string, rows []T) error {
	if len(rows) == 0 {
		return nil
	}
	batch, err := conn.PrepareBatch(ctx, "INSERT INTO "+table)
	if err != nil {
		return fmt.Errorf("%s prepare: %w", table, err)
	}
	for i := range rows {
		if err := batch.AppendStruct(&rows[i]); err != nil {
			return fmt.Errorf("%s append %d: %w", table, i, err)
		}
	}
	if err := batch.Send(); err != nil {
		return fmt.Errorf("%s send: %w", table, err)
	}
	return nil
}

func (c *ClickHouse) Abort(ctx context.Context, parseRunID uint64) error {
	var first error
	for _, table := range replayTables {
		q := fmt.Sprintf("ALTER TABLE %s DELETE WHERE parse_run_id = %d", table, parseRunID)
		if err := c.conn.Exec(ctx, q); err != nil && first == nil {
			first = fmt.Errorf("%s delete: %w", table, err)
		}
	}
	return first
}

func (c *ClickHouse) DropPrevious(ctx context.Context, matchID, keepRun uint64) error {
	var first error
	for _, table := range replayTables {
		q := fmt.Sprintf(
			"ALTER TABLE %s DELETE WHERE match_id = %d AND parse_run_id != %d AND parse_run_id != 0",
			table, matchID, keepRun,
		)
		if err := c.conn.Exec(ctx, q); err != nil && first == nil {
			first = err
		}
	}
	return first
}
