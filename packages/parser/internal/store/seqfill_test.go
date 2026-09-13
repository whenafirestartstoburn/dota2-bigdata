package store

import (
	"testing"

	"dota2-collector/parser/internal/model"
)

func TestPgPlayerSlot(t *testing.T) {
	t.Parallel()
	slot, ok := pgPlayerSlot(5)
	if !ok || slot != 128 {
		t.Fatalf("linear 5 → %d ok=%v", slot, ok)
	}
	slot, ok = pgPlayerSlot(3)
	if !ok || slot != 3 {
		t.Fatalf("linear 3 → %d ok=%v", slot, ok)
	}
	if _, ok := pgPlayerSlot(-1); ok {
		t.Fatal("unknown slot")
	}
}

func TestCaptainPgSlot(t *testing.T) {
	t.Parallel()
	slot, ok := captainPgSlot(7)
	if !ok || slot != 130 {
		t.Fatalf("captain 7 → %d ok=%v", slot, ok)
	}
	slot, ok = captainPgSlot(128)
	if !ok || slot != 128 {
		t.Fatalf("valve 128 → %d ok=%v", slot, ok)
	}
}

func TestLastInventoryBySlotKeepsNewest(t *testing.T) {
	t.Parallel()
	got := lastInventoryBySlot([]model.MetaInventory{
		{Header: model.Header{Slot: 1, Time: 10}, NeutralItemID: 1},
		{Header: model.Header{Slot: 1, Time: 40}, NeutralItemID: 9},
		{Header: model.Header{Slot: 2, Time: 5}, NeutralItemID: 3},
	})
	if len(got) != 2 {
		t.Fatalf("len %d", len(got))
	}
	bySlot := map[int8]int32{}
	for _, row := range got {
		bySlot[row.Slot] = row.NeutralItemID
	}
	if bySlot[1] != 9 || bySlot[2] != 3 {
		t.Fatalf("%v", bySlot)
	}
}
