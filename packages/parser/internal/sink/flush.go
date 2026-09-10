package sink

import (
	"context"

	"dota2-collector/parser/internal/model"
)

// Flusher inserts high-volume tables mid-decode and the rest at Finish.
type Flusher struct {
	ctx context.Context
	ch  *ClickHouse
}

func NewFlusher(ctx context.Context, ch *ClickHouse) *Flusher {
	return &Flusher{ctx: ctx, ch: ch}
}

func (f *Flusher) FlushCombat(rows []model.CombatLog) error {
	return insert(f.ctx, f.ch.conn, "replay_combat_log", rows)
}

func (f *Flusher) FlushIntervals(rows []model.Interval) error {
	return insert(f.ctx, f.ch.conn, "replay_intervals", rows)
}

func (f *Flusher) FlushActions(rows []model.Action) error {
	return insert(f.ctx, f.ch.conn, "replay_actions", rows)
}

func (f *Flusher) Finish(res *model.Result) error {
	if err := f.FlushCombat(res.CombatLog); err != nil {
		return err
	}
	res.CombatLog = res.CombatLog[:0]
	if err := f.FlushIntervals(res.Intervals); err != nil {
		return err
	}
	res.Intervals = res.Intervals[:0]
	if err := f.FlushActions(res.Actions); err != nil {
		return err
	}
	res.Actions = res.Actions[:0]
	small := []struct {
		table string
		fn    func(context.Context) error
	}{
		{"replay_pings", func(ctx context.Context) error {
			return insert(ctx, f.ch.conn, "replay_pings", res.Pings)
		}},
		{"replay_wards", func(ctx context.Context) error {
			return insert(ctx, f.ch.conn, "replay_wards", res.Wards)
		}},
		{"replay_chat", func(ctx context.Context) error {
			return insert(ctx, f.ch.conn, "replay_chat", res.Chat)
		}},
		{"replay_announcements", func(ctx context.Context) error {
			return insert(ctx, f.ch.conn, "replay_announcements", res.Announcements)
		}},
		{"replay_draft", func(ctx context.Context) error {
			return insert(ctx, f.ch.conn, "replay_draft", res.Draft)
		}},
		{"replay_ability_levels", func(ctx context.Context) error {
			return insert(ctx, f.ch.conn, "replay_ability_levels", res.AbilityLevels)
		}},
		{"replay_inventory", func(ctx context.Context) error {
			return insert(ctx, f.ch.conn, "replay_inventory", res.Inventory)
		}},
		{"replay_neutrals", func(ctx context.Context) error {
			return insert(ctx, f.ch.conn, "replay_neutrals", res.Neutrals)
		}},
		{"replay_cosmetics", func(ctx context.Context) error {
			return insert(ctx, f.ch.conn, "replay_cosmetics", res.Cosmetics)
		}},
		{"replay_alerts", func(ctx context.Context) error {
			return insert(ctx, f.ch.conn, "replay_alerts", res.Alerts)
		}},
		{"replay_epilogue", func(ctx context.Context) error {
			return insert(ctx, f.ch.conn, "replay_epilogue", res.Epilogue)
		}},
	}
	errCh := make(chan error, len(small))
	for _, j := range small {
		j := j
		go func() {
			errCh <- j.fn(f.ctx)
		}()
	}
	var first error
	for range small {
		if err := <-errCh; err != nil && first == nil {
			first = err
		}
	}
	return first
}
