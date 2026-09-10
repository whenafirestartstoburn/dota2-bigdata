package replay

import "testing"

func TestKeepClass(t *testing.T) {
	t.Parallel()
	keep := []string{
		"CDOTA_PlayerResource",
		"CDOTAGamerulesProxy",
		"CDOTA_DataRadiant",
		"CDOTA_Unit_Hero_Invoker",
		"CDOTA_Item_Blink",
		"CDOTA_Ability_Invoker_SunStrike",
		"CDOTA_NPC_Observer_Ward",
		"CDOTA_NPC_SentryWard",
		"CDOTAWearableItem",
	}
	drop := []string{
		"CDOTA_BaseNPC_Creep_Lane",
		"CDOTA_BaseNPC_Tower",
		"CBaseAnimating",
		"CDOTA_Unit_Courier",
		"CParticleSystem",
	}
	for _, name := range keep {
		if !KeepClass(name) {
			t.Fatalf("KeepClass(%q) = false", name)
		}
	}
	for _, name := range drop {
		if KeepClass(name) {
			t.Fatalf("KeepClass(%q) = true", name)
		}
	}
}
