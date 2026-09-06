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

// TestParseMajorPatches walks testdata/patches/<patch>/*.dem* and asserts
// the decoder still produces combat log + intervals. Fetch fixtures with:
//
//	bun run parser:fetch-patches
func TestParseMajorPatches(t *testing.T) {
	root := filepath.Join(testdataRoot(t), "testdata", "patches")
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Skip("testdata/patches missing — run bun run parser:fetch-patches")
	}
	var patches []string
	for _, e := range entries {
		if e.IsDir() {
			patches = append(patches, e.Name())
		}
	}
	if len(patches) == 0 {
		t.Skip("no patch fixtures")
	}
	for _, patch := range patches {
		patch := patch
		t.Run(patch, func(t *testing.T) {
			t.Parallel()
			files, _ := filepath.Glob(filepath.Join(root, patch, "*.dem*"))
			if len(files) == 0 {
				t.Skip("no demo for " + patch)
			}
			path := files[0]
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()
			res, err := parse.ParseFile(ctx, parse.Job{
				MatchID:   matchIDFromName(filepath.Base(path)),
				StartTime: time.Unix(1_500_000_000, 0).UTC(),
			}, path)
			if err != nil {
				t.Fatalf("patch %s: %v", patch, err)
			}
			if len(res.CombatLog) == 0 {
				t.Fatalf("patch %s: empty combat log", patch)
			}
			if len(res.Intervals) == 0 {
				t.Fatalf("patch %s: empty intervals", patch)
			}
			for _, row := range res.CombatLog {
				if strings.TrimSpace(row.Type) == "" {
					t.Fatalf("patch %s: blank combat type", patch)
				}
			}
			t.Logf("patch %s counts=%v", patch, res.Counts())
		})
	}
}
