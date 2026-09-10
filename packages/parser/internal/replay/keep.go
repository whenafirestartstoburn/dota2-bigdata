package replay

import "strings"

// KeepClass is true for entity classes the extract reads after decode.
// Everything else is bitstream-consumed and then dropped (no baseline
// clone, no property tree).
func KeepClass(name string) bool {
	switch name {
	case "CDOTA_PlayerResource",
		"CDOTAGamerulesProxy", "CDOTA_GamerulesProxy",
		"CDOTA_DataRadiant", "CDOTA_DataDire",
		"CDOTAWearableItem":
		return true
	}
	if strings.HasPrefix(name, "CDOTA_Unit_Hero_") ||
		strings.HasPrefix(name, "C_DOTA_Unit_Hero_") {
		return true
	}
	if strings.HasPrefix(name, "CDOTA_Item_") ||
		strings.HasPrefix(name, "C_DOTA_Item_") {
		return true
	}
	if strings.HasPrefix(name, "CDOTA_Ability_") ||
		strings.HasPrefix(name, "C_DOTA_Ability_") {
		return true
	}
	if strings.Contains(name, "ObserverWard") ||
		strings.Contains(name, "Observer_Ward") ||
		strings.Contains(name, "SentryWard") ||
		strings.Contains(name, "Sentry_Ward") {
		return true
	}
	if strings.Contains(name, "Ability") &&
		(strings.HasPrefix(name, "CDOTA") || strings.HasPrefix(name, "C_DOTA")) {
		return true
	}
	return false
}
