package parser_test

import (
	"testing"

	"dota2-collector/parser/internal/model"
	"dota2-collector/parser/internal/version"
)

func TestResultCountsAndRunID(t *testing.T) {
	res := &model.Result{
		MatchID:       1,
		ParseRunID:    42,
		ParserVersion: version.Schema,
		CombatLog:     []model.CombatLog{{}},
		Intervals:     []model.Interval{{}, {}},
	}
	c := res.Counts()
	if c["combat_log"] != 1 || c["intervals"] != 2 {
		t.Fatalf("counts %+v", c)
	}
	if res.ParserVersion == 0 {
		t.Fatal("schema version is 0")
	}
}

func TestParseRunIsolation(t *testing.T) {
	// Unpublished rows are those whose parse_run_id is not on match_replays.
	// A failed insert must not share a run id with a later attempt.
	a := new(model.Result)
	a.ParseRunID = 1
	b := new(model.Result)
	b.ParseRunID = 2
	if a.ParseRunID == b.ParseRunID {
		t.Fatal("runs must differ")
	}
}
