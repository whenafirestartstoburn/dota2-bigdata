package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"dota2-collector/parser/internal/app"
	"dota2-collector/parser/internal/config"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	cfg, err := config.FromEnv()
	if err != nil {
		log.Error("config", "err", err)
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	svc, err := app.New(ctx, cfg, log)
	if err != nil {
		log.Error("startup", "err", err)
		os.Exit(1)
	}
	defer svc.Close()

	srv := &http.Server{Addr: cfg.ListenAddr, Handler: svc.Handler()}
	go func() {
		log.Info("parser listening", "addr", cfg.ListenAddr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Error("http", "err", err)
		}
	}()
	go func() {
		if err := svc.Run(ctx); err != nil && ctx.Err() == nil {
			log.Error("run", "err", err)
		}
	}()
	<-ctx.Done()
	shutdown, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdown)
}
