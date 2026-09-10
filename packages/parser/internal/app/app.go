package app

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"dota2-collector/parser/internal/config"
	"dota2-collector/parser/internal/metrics"
	"dota2-collector/parser/internal/parse"
	"dota2-collector/parser/internal/s3store"
	"dota2-collector/parser/internal/sink"
	"dota2-collector/parser/internal/store"
	"dota2-collector/parser/internal/version"

	"github.com/prometheus/client_golang/prometheus/promhttp"
)

type App struct {
	cfg      config.Config
	pg       *store.Store
	ch       *sink.ClickHouse
	s3       *s3store.Client
	log      *slog.Logger
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
	mux.Handle("/metrics", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if counts, err := a.pg.CountReplayStatus(ctx); err == nil {
			metrics.SetQueue(counts)
		}
		metrics.Inflight.Set(float64(a.inflight.Load()))
		promhttp.Handler().ServeHTTP(w, r)
	}))
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
	sem := make(chan struct{}, 10)
	var mu sync.Mutex
	n := 10
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
	metrics.Inflight.Set(float64(a.inflight.Load()))
	defer func() {
		a.inflight.Add(-1)
		metrics.Inflight.Set(float64(a.inflight.Load()))
	}()
	start := time.Now()
	log := a.log.With("trace_id", newTraceID(), "match_id", job.MatchID)
	log.Info("parse start", "key", job.S3Key)
	body, err := a.s3.Get(ctx, job.S3Bucket, job.S3Key)
	if err != nil {
		log.Error("s3", "err", err)
		_ = a.pg.Fail(ctx, job.MatchID, err)
		metrics.ObserveJob("s3", time.Since(start).Seconds())
		return
	}
	defer body.Close()
	flush := sink.NewFlusher(ctx, a.ch)
	res, err := parse.ParseReaderWithSink(ctx, parse.Job{
		MatchID:   job.MatchID,
		StartTime: job.StartTime,
	}, body, flush)
	if err != nil {
		if res != nil {
			_ = a.ch.Abort(ctx, res.ParseRunID)
		}
		log.Error("parse", "err", err)
		_ = a.pg.Fail(ctx, job.MatchID, err)
		metrics.ObserveJob("parse", time.Since(start).Seconds())
		return
	}
	if err := flush.Finish(res); err != nil {
		_ = a.ch.Abort(ctx, res.ParseRunID)
		log.Error("clickhouse", "err", err)
		_ = a.pg.Fail(ctx, job.MatchID, err)
		metrics.ObserveJob("clickhouse", time.Since(start).Seconds())
		return
	}
	if err := a.pg.Publish(ctx, res); err != nil {
		_ = a.ch.Abort(ctx, res.ParseRunID)
		log.Error("publish", "err", err)
		_ = a.pg.Fail(ctx, job.MatchID, err)
		metrics.ObserveJob("publish", time.Since(start).Seconds())
		return
	}
	// Empty ALTER DELETE still enqueues a mutation. Skip until a prior
	// publish exists — that queue is what filled the disk at high width.
	if job.ParserVersion != nil {
		_ = a.ch.DropPrevious(ctx, res.MatchID, res.ParseRunID)
	}
	metrics.ObserveJob("success", time.Since(start).Seconds())
	log.Info("parsed",
		"run", res.ParseRunID,
		"elapsed_ms", time.Since(start).Milliseconds(),
		"counts", res.Counts(),
	)
}

func newTraceID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return time.Now().UTC().Format("20060102150405.000000000")
	}
	return hex.EncodeToString(b[:])
}
