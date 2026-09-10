package parse

import "strings"

// steamID64Base is Universe 1 + account type 1. Steam32 = steam64 − this.
const steamID64Base = 76561197960265728

// AccountFromSteam turns a PlayerResource steam id into Steam32.
// Some patches already store the 32-bit account.
func AccountFromSteam(steam uint64) uint32 {
	if steam == 0 {
		return 0
	}
	if steam >= steamID64Base {
		return uint32(steam - steamID64Base)
	}
	if steam > 0xFFFFFFFF {
		return 0
	}
	return uint32(steam)
}

// heroKey is a prefix-stripped, punctuation-stripped hero token used to
// map combat-log / class names onto a player. Illusions and parenthetical
// copies collapse onto the same key as the real hero.
func heroKey(name string) string {
	if name == "" {
		return ""
	}
	lower := strings.ToLower(name)
	for _, p := range []string{
		"npc_dota_hero_",
		"cdota_unit_hero_",
		"c_dota_unit_hero_",
	} {
		if strings.HasPrefix(lower, p) {
			lower = lower[len(p):]
			break
		}
	}
	if i := strings.Index(lower, "_illusion"); i >= 0 {
		lower = lower[:i]
	}
	if i := strings.Index(lower, "("); i >= 0 {
		lower = lower[:i]
	}
	return canonHero(strings.TrimSpace(lower))
}

func replaySlot(team, teamSlot int32) (slot int8, valve int32, ok bool) {
	if teamSlot < 0 || teamSlot > 4 {
		return 0, 0, false
	}
	switch team {
	case 2:
		return int8(teamSlot), teamSlot, true
	case 3:
		return int8(5 + teamSlot), 128 + teamSlot, true
	default:
		return 0, 0, false
	}
}
