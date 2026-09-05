package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	PGURI              string
	ClickHouseAddr     string
	ClickHouseHTTP     string
	ClickHouseUser     string
	ClickHousePassword string
	ClickHouseDatabase string
	S3Endpoint         string
	S3Region           string
	S3Bucket           string
	S3AccessKey        string
	S3SecretKey        string
	S3ForcePathStyle   bool
	ListenAddr         string
	PollInterval       time.Duration
	StaleParsingAfter  time.Duration
}

func FromEnv() (Config, error) {
	port := envOr("PARSER_PORT", "3002")
	cfg := Config{
		PGURI:              os.Getenv("PGURI"),
		ClickHouseAddr:     envOr("CLICKHOUSE_NATIVE", nativeFromHTTP(os.Getenv("CLICKHOUSE_URL"))),
		ClickHouseHTTP:     envOr("CLICKHOUSE_URL", "http://localhost:8123"),
		ClickHouseUser:     envOr("CLICKHOUSE_USER", "default"),
		ClickHousePassword: os.Getenv("CLICKHOUSE_PASSWORD"),
		ClickHouseDatabase: envOr("CLICKHOUSE_DATABASE", "dota"),
		S3Endpoint:         os.Getenv("S3_ENDPOINT"),
		S3Region:           envOr("S3_REGION", "us-east-1"),
		S3Bucket:           os.Getenv("S3_BUCKET"),
		S3AccessKey:        os.Getenv("S3_ACCESS_KEY"),
		S3SecretKey:        os.Getenv("S3_SECRET_KEY"),
		S3ForcePathStyle:   os.Getenv("S3_FORCE_PATH_STYLE") == "true",
		ListenAddr:         ":" + port,
		PollInterval:       durationMS("PARSER_POLL_MS", 2000),
		StaleParsingAfter:  durationMS("PARSER_STALE_MS", 30*60*1000),
	}
	if cfg.PGURI == "" {
		return cfg, fmt.Errorf("PGURI is required")
	}
	if cfg.S3Bucket == "" {
		return cfg, fmt.Errorf("S3_BUCKET is required")
	}
	return cfg, nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func durationMS(key string, def int) time.Duration {
	raw := os.Getenv(key)
	if raw == "" {
		return time.Duration(def) * time.Millisecond
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 {
		return time.Duration(def) * time.Millisecond
	}
	return time.Duration(n) * time.Millisecond
}

func nativeFromHTTP(url string) string {
	if url == "" {
		return "localhost:9000"
	}
	// http://host:8123 → host:9000
	host := url
	for _, prefix := range []string{"http://", "https://"} {
		if len(host) > len(prefix) && host[:len(prefix)] == prefix {
			host = host[len(prefix):]
			break
		}
	}
	for i := 0; i < len(host); i++ {
		if host[i] == ':' {
			return host[:i] + ":9000"
		}
		if host[i] == '/' {
			return host[:i] + ":9000"
		}
	}
	return host + ":9000"
}
