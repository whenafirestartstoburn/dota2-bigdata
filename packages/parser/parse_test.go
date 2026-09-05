package parser_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"dota2-collector/parser/internal/parse"
)

func TestParseAttachedDemos(t *testing.T) {
	t.Parallel()
	demos := findDemos(t, "testdata/demos")
	if len(demos) == 0 {
		t.Skip("no testdata/demos/*.dem.bz2 — copy the attached replays there")
	}
	for _, path := range demos {
		path := path
		t.Run(filepath.Base(path), func(t *testing.T) {
			t.Parallel()
			matchID := matchIDFromName(filepath.Base(path))
			ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
			defer cancel()
			res, err := parse.ParseFile(ctx, parse.Job{
				MatchID:   matchID,
				StartTime: time.Unix(1_725_000_000, 0).UTC(),
			}, path)
			if err != nil {
				t.Fatal(err)
			}
			if res.ParseRunID == 0 {
				t.Fatal("parse_run_id is 0")
			}
			if len(res.CombatLog) < 100 {
				t.Fatalf("combat log too small: %d", len(res.CombatLog))
			}
			if len(res.Intervals) < 50 {
				t.Fatalf("intervals too small: %d", len(res.Intervals))
			}
			if n := len(res.AbilityLevels); n > 5_000 {
				t.Fatalf("ability levels look like a per-tick dump: %d", n)
			}
			seenType := false
			for _, row := range res.CombatLog {
				if row.Type == "" {
					t.Fatal("empty combat-log type")
				}
				if row.ParseRunID != res.ParseRunID {
					t.Fatal("combat-log parse_run_id mismatch")
				}
				seenType = true
				break
			}
			if !seenType {
				t.Fatal("no combat-log types")
			}
			t.Logf("%s counts=%v", filepath.Base(path), res.Counts())
		})
	}
}

func findDemos(t *testing.T, dir string) []string {
	t.Helper()
	root := testdataRoot(t)
	abs := filepath.Join(root, dir)
	matches, _ := filepath.Glob(filepath.Join(abs, "*.dem.bz2"))
	raw, _ := filepath.Glob(filepath.Join(abs, "*.dem"))
	return append(matches, raw...)
}

func testdataRoot(t *testing.T) string {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	return wd
}

func matchIDFromName(name string) uint64 {
	name = strings.TrimSuffix(name, ".bz2")
	name = strings.TrimSuffix(name, ".dem")
	if i := strings.IndexByte(name, '_'); i > 0 {
		name = name[:i]
	}
	var n uint64
	for _, c := range name {
		if c < '0' || c > '9' {
			break
		}
		n = n*10 + uint64(c-'0')
	}
	return n
}
