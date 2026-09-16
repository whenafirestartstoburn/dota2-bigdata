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
	"replay_alerts",
	"replay_meta",
	"replay_meta_teams",
	"replay_meta_players",
	"replay_meta_kills",
	"replay_meta_player_kills",
	"replay_meta_purchases",
	"replay_meta_inventory",
	"replay_meta_tips",
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

// Commit inserts every table. On any error it deletes the match from all
// replay tables so MergeTree does not keep a partial write.
func (c *ClickHouse) Commit(ctx context.Context, res *model.Result) error {
	if err := c.insertAll(ctx, res); err != nil {
		_ = c.DeleteMatch(ctx, res.MatchID)
		return err
	}
	return nil
}

type insertJob struct {
	table string
	fn    func(context.Context) error
}

func (c *ClickHouse) insertAll(ctx context.Context, res *model.Result) error {
	jobs := []insertJob{
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
		{"replay_alerts", func(ctx context.Context) error {
			return insert(ctx, c.conn, "replay_alerts", res.Alerts)
		}},
	}
	jobs = append(jobs, metaJobs(c.conn, res)...)
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

func metaJobs(conn driver.Conn, res *model.Result) []insertJob {
	meta := []model.Meta{}
	if res.Meta.MatchID != 0 {
		meta = []model.Meta{res.Meta}
	}
	return []insertJob{
		{"replay_meta", func(ctx context.Context) error {
			return insert(ctx, conn, "replay_meta", meta)
		}},
		{"replay_meta_teams", func(ctx context.Context) error {
			return insert(ctx, conn, "replay_meta_teams", res.MetaTeams)
		}},
		{"replay_meta_players", func(ctx context.Context) error {
			return insert(ctx, conn, "replay_meta_players", res.MetaPlayers)
		}},
		{"replay_meta_kills", func(ctx context.Context) error {
			return insert(ctx, conn, "replay_meta_kills", res.MetaKills)
		}},
		{"replay_meta_player_kills", func(ctx context.Context) error {
			return insert(ctx, conn, "replay_meta_player_kills", res.MetaPlayerKills)
		}},
		{"replay_meta_purchases", func(ctx context.Context) error {
			return insert(ctx, conn, "replay_meta_purchases", res.MetaPurchases)
		}},
		{"replay_meta_inventory", func(ctx context.Context) error {
			return insert(ctx, conn, "replay_meta_inventory", res.MetaInventory)
		}},
		{"replay_meta_tips", func(ctx context.Context) error {
			return insert(ctx, conn, "replay_meta_tips", res.MetaTips)
		}},
	}
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

func (c *ClickHouse) DeleteMatch(ctx context.Context, matchID uint64) error {
	if matchID == 0 {
		return nil
	}
	var first error
	for _, table := range replayTables {
		q := fmt.Sprintf("ALTER TABLE %s DELETE WHERE match_id = %d", table, matchID)
		if err := c.conn.Exec(ctx, q); err != nil && first == nil {
			first = fmt.Errorf("%s delete: %w", table, err)
		}
	}
	return first
}
