package store

import (
	"testing"

	"dota2-collector/parser/internal/model"
)

func TestDraftLooksComplete(t *testing.T) {
	t.Parallel()
	if !draftLooksComplete(24, 10) {
		t.Fatal("official 24-row draft")
	}
	if draftLooksComplete(85, 12) {
		t.Fatal("gamerules poll must not look complete")
	}
	if draftLooksComplete(24, 4) {
		t.Fatal("too few picks")
	}
}

func TestCompactDraftKeepsFirstUnique(t *testing.T) {
	t.Parallel()
	rows := []model.Draft{
		{HeroID: 1, IsPick: 0},
		{HeroID: 1, IsPick: 0},
		{HeroID: 2, IsPick: 1},
		{HeroID: 2, IsPick: 1},
		{HeroID: 3, IsPick: 1},
	}
	got := compactDraft(rows)
	if len(got) != 3 {
		t.Fatalf("len %d", len(got))
	}
	if got[0].HeroID != 1 || got[0].IsPick != 0 || got[1].HeroID != 2 {
		t.Fatalf("order %+v", got)
	}
}

func TestDraftSequenceOK(t *testing.T) {
	t.Parallel()
	var rows []model.Draft
	for i := 0; i < 24; i++ {
		isPick := uint8(0)
		if i >= 14 {
			isPick = 1
		}
		rows = append(rows, model.Draft{HeroID: int32(i + 1), IsPick: isPick})
	}
	if !draftSequenceOK(rows) {
		t.Fatal("24-row fileinfo sequence")
	}
	if draftSequenceOK(rows[:5]) {
		t.Fatal("short sequence")
	}
}
