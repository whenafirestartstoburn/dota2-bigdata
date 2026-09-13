package parse

import (
	"testing"

	"dota2-collector/parser/internal/model"
)

func TestUnknownCL(t *testing.T) {
	t.Parallel()
	if !unknownCL("") || !unknownCL("dota_unknown") || !unknownCL("Unknown") {
		t.Fatal("empty / dota_unknown must be rejected")
	}
	if unknownCL("item_blink") {
		t.Fatal("real item name rejected")
	}
}

func TestInferLane(t *testing.T) {
	t.Parallel()
	mid := repeatXY(128, 128, 12)
	if lane, role, roam := inferLane(mid, 2); lane != 2 || role != 2 || roam {
		t.Fatalf("mid: %d %d %v", lane, role, roam)
	}
	// Radiant safe is bot (y < x)
	safe := repeatXY(170, 80, 12)
	if lane, _, _ := inferLane(safe, 2); lane != 1 {
		t.Fatalf("radiant safe: %d", lane)
	}
	// Dire safe is top (y > x)
	if lane, _, _ := inferLane(repeatXY(80, 170, 12), 3); lane != 1 {
		t.Fatalf("dire safe: %d", lane)
	}
	if lane, _, _ := inferLane(repeatXY(128, 128, 2), 2); lane != 0 {
		t.Fatal("too few samples must stay 0")
	}
}

func TestRaxBitAndBarracks(t *testing.T) {
	t.Parallel()
	dire, bit, ok := raxBit("npc_dota_goodguys_melee_rax_top")
	if !ok || dire || bit != 1 {
		t.Fatalf("radiant melee top: %v %d %v", dire, bit, ok)
	}
	dire, bit, ok = raxBit("npc_dota_badguys_range_rax_bot")
	if !ok || !dire || bit != 32 {
		t.Fatalf("dire ranged bot: %v %d %v", dire, bit, ok)
	}
	rad, dir, known := barracksFromCombat([]model.CombatLog{
		{Type: "DEATH", Target: "npc_dota_goodguys_melee_rax_mid"},
		{Type: "TEAM_BUILDING_KILL", Target: "npc_dota_goodguys_range_rax_mid"},
	})
	if !known {
		t.Fatal("expected known")
	}
	if rad != 63-4-8 {
		t.Fatalf("radiant mask %d", rad)
	}
	if dir != 63 {
		t.Fatalf("dire should stay intact, got %d", dir)
	}
}

func repeatXY(x, y float32, n int) [][2]float32 {
	out := make([][2]float32, n)
	for i := range out {
		out[i] = [2]float32{x, y}
	}
	return out
}
