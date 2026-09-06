package replay

import "math"

// Build-bounded encoder corrections. Valve changed a handful of field
// encodings across Source 2 builds; the flattened serializer still ships
// the older encoder name, so we rewrite it here.
type buildFix struct {
	lo, hi uint32
	fn     func(*prop)
}

func (f buildFix) applies(build uint32) bool {
	if f.lo == 0 && f.hi == 0 {
		return true
	}
	return build >= f.lo && build <= f.hi
}

func f32p(v float32) *float32 { return &v }

var buildFixes = []buildFix{
	{0, 990, func(p *prop) {
		switch p.name {
		case "angExtraLocalAngles", "angLocalAngles", "m_angInitialAngles",
			"m_angRotation", "m_ragAngles", "m_vLightDirection":
			if p.parent == "CBodyComponentBaseAnimatingOverlay" {
				p.encoder = "qangle_pitch_yaw"
			} else {
				p.encoder = "QAngle"
			}
		case "dirPrimary", "localSound", "m_flElasticity", "m_location",
			"m_poolOrigin", "m_ragPos", "m_vecEndPos", "m_vecLadderDir",
			"m_vecPlayerMountPositionBottom", "m_vecPlayerMountPositionTop",
			"m_viewtarget", "m_WorldMaxs", "m_WorldMins", "origin",
			"vecLocalOrigin":
			p.encoder = "coord"
		case "m_vecLadderNormal":
			p.encoder = "normal"
		}
	}},
	{0, 954, func(p *prop) {
		switch p.name {
		case "m_flMana", "m_flMaxMana":
			if p.high != nil && *p.high == float32(math.MaxFloat32) {
				p.low = nil
				p.high = f32p(8192)
			}
		}
	}},
	{1016, 1027, func(p *prop) {
		switch p.name {
		case "m_bItemWhiteList", "m_bWorldTreeState", "m_iPlayerIDsInControl",
			"m_iPlayerSteamID", "m_ulTeamBannerLogo", "m_ulTeamBaseLogo",
			"m_ulTeamLogo":
			p.encoder = "fixed64"
		}
	}},
	{0, 0, func(p *prop) {
		switch p.name {
		case "m_flSimulationTime", "m_flAnimTime":
			p.encoder = "simtime"
		case "m_flRuneTime":
			if p.low != nil && p.high != nil &&
				*p.low == -float32(math.MaxFloat32) &&
				*p.high == float32(math.MaxFloat32) {
				p.encoder = "runetime"
			}
		}
	}},
}
