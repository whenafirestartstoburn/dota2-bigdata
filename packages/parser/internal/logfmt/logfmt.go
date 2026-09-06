package logfmt

import (
	"log/slog"
	"os"
	"strings"
	"time"
)

func New(service string) *slog.Logger {
	handler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
		ReplaceAttr: func(_ []string, a slog.Attr) slog.Attr {
			switch a.Key {
			case slog.TimeKey:
				return slog.String("time", a.Value.Time().UTC().Format(time.RFC3339Nano))
			case slog.LevelKey:
				return slog.String("level", strings.ToLower(a.Value.String()))
			case slog.MessageKey:
				return slog.String("msg", a.Value.String())
			default:
				return a
			}
		},
	})
	return slog.New(handler.WithAttrs([]slog.Attr{
		slog.String("service", service),
	}))
}
