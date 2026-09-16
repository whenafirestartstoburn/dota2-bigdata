package parser_test

import (
	"testing"

	"dota2-collector/parser/internal/model"
	"dota2-collector/parser/internal/version"
)

func TestResultCounts(t *testing.T) {
	res := &model.Result{
		MatchID:       1,
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
