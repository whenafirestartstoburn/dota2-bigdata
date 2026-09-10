package parse

import "testing"

func TestAccountFromSteam(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in   uint64
		want uint32
	}{
		{0, 0},
		{12345, 12345},
		{76561197960265728 + 86745912, 86745912},
		{76561198000000000, 39734272},
	}
	for _, c := range cases {
		if got := AccountFromSteam(c.in); got != c.want {
			t.Fatalf("AccountFromSteam(%d) = %d, want %d", c.in, got, c.want)
		}
	}
}

func TestHeroKey(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in, want string
	}{
		{"", ""},
		{"npc_dota_hero_invoker", "invoker"},
		{"npc_dota_hero_invoker_illusion", "invoker"},
		{"CDOTA_Unit_Hero_Invoker", "invoker"},
		{"npc_dota_hero_nevermore", "nevermore"},
		{"npc_dota_creep_goodguys_melee", "npcdotacreepgoodguysmelee"},
	}
	for _, c := range cases {
		if got := heroKey(c.in); got != c.want {
			t.Fatalf("heroKey(%q) = %q, want %q", c.in, got, c.want)
		}
	}
	if heroKey("npc_dota_hero_invoker") == heroKey("npc_dota_creep_goodguys_melee") {
		t.Fatal("hero and creep collapsed onto the same key")
	}
}

func TestReplaySlot(t *testing.T) {
	t.Parallel()
	slot, valve, ok := replaySlot(2, 0)
	if !ok || slot != 0 || valve != 0 {
		t.Fatalf("radiant 0: %d %d %v", slot, valve, ok)
	}
	slot, valve, ok = replaySlot(3, 2)
	if !ok || slot != 7 || valve != 130 {
		t.Fatalf("dire 2: %d %d %v", slot, valve, ok)
	}
	if _, _, ok := replaySlot(2, 5); ok {
		t.Fatal("teamSlot 5 must be rejected")
	}
	if _, _, ok := replaySlot(14, 0); ok {
		t.Fatal("unassigned team must be rejected")
	}
}
