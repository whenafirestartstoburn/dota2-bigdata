package app

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"dota2-collector/parser/internal/config"
	"dota2-collector/parser/internal/parse"
	"dota2-collector/parser/internal/s3store"
	"dota2-collector/parser/internal/sink"
	"dota2-collector/parser/internal/store"
	"dota2-collector/parser/internal/version"
)

type App struct {
	cfg   config.Config
	pg    *store.Store
	ch    *sink.ClickHouse
	s3    *s3store.Client
	log   *slog.Logger
	inflight atomic.Int32
}

func New(ctx context.Context, cfg config.Config, log *slog.Logger) (*App, error) {
	pg, err := store.Open(ctx, cfg.PGURI)
	if err != nil {
		return nil, err
	}
	ch, err := sink.Open(cfg.ClickHouseAddr, cfg.ClickHouseUser, cfg.ClickHousePassword, cfg.ClickHouseDatabase)
	if err != nil {
		pg.Close()
		return nil, err
	}
	s3c, err := s3store.Open(ctx, cfg.S3Endpoint, cfg.S3Region, cfg.S3Bucket, cfg.S3AccessKey, cfg.S3SecretKey, cfg.S3ForcePathStyle)
	if err != nil {
		pg.Close()
		_ = ch.Close()
		return nil, err
	}
	return &App{cfg: cfg, pg: pg, ch: ch, s3: s3c, log: log}, nil
}

func (a *App) Close() {
	a.pg.Close()
	_ = a.ch.Close()
}

func (a *App) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("content-type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":         "ok",
			"parser_version": version.Schema,
			"inflight":       a.inflight.Load(),
		})
	})
	mux.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := a.pg.Ping(ctx); err != nil {
			http.Error(w, "postgres", http.StatusServiceUnavailable)
			return
		}
		if err := a.ch.Ping(ctx); err != nil {
			http.Error(w, "clickhouse", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("content-type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ready"})
	})
	return mux
}

func (a *App) Run(ctx context.Context) error {
	ticker := time.NewTicker(a.cfg.PollInterval)
	defer ticker.Stop()
	sem := make(chan struct{}, 1)
	var mu sync.Mutex
	n := 1
	for {
		if p, err := a.pg.Parallelism(ctx); err == nil && p > 0 {
			mu.Lock()
			if p != n {
				n = p
				sem = make(chan struct{}, n)
				a.log.Info("parser parallelism", "n", n)
			}
			mu.Unlock()
		}
		_, _ = a.pg.ReclaimStale(ctx, a.cfg.StaleParsingAfter)
		a.fill(ctx, sem)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func (a *App) fill(ctx context.Context, sem chan struct{}) {
	for {
		select {
		case sem <- struct{}{}:
		default:
			return
		}
		job, err := a.pg.Claim(ctx)
		if err != nil {
			a.log.Error("claim", "err", err)
			<-sem
			return
		}
		if job == nil {
			<-sem
			return
		}
		go func() {
			defer func() { <-sem }()
			a.handle(ctx, job)
		}()
	}
}

func (a *App) handle(ctx context.Context, job *store.Claimed) {
	a.inflight.Add(1)
	defer a.inflight.Add(-1)
	start := time.Now()
	a.log.Info("parse start", "match_id", job.MatchID, "key", job.S3Key)
	body, err := a.s3.Get(ctx, job.S3Bucket, job.S3Key)
	if err != nil {
		a.log.Error("s3", "match_id", job.MatchID, "err", err)
		_ = a.pg.Fail(ctx, job.MatchID, err)
		return
	}
	defer body.Close()
	res, err := parse.ParseReader(ctx, parse.Job{
		MatchID:   job.MatchID,
		StartTime: job.StartTime,
	}, body)
	if err != nil {
		a.log.Error("parse", "match_id", job.MatchID, "err", err)
		_ = a.pg.Fail(ctx, job.MatchID, err)
		return
	}
	if err := a.ch.Commit(ctx, res); err != nil {
		a.log.Error("clickhouse", "match_id", job.MatchID, "err", err)
		_ = a.pg.Fail(ctx, job.MatchID, err)
		return
	}
	if err := a.pg.Publish(ctx, res); err != nil {
		_ = a.ch.Abort(ctx, res.ParseRunID)
		a.log.Error("publish", "match_id", job.MatchID, "err", err)
		_ = a.pg.Fail(ctx, job.MatchID, err)
		return
	}
	_ = a.ch.DropPrevious(ctx, res.MatchID, res.ParseRunID)
	a.log.Info("parsed",
		"match_id", job.MatchID,
		"run", res.ParseRunID,
		"elapsed_ms", time.Since(start).Milliseconds(),
		"counts", res.Counts(),
	)
}
