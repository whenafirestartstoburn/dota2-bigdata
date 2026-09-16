package parse

import (
	"fmt"
	"strings"

	"github.com/dotabuff/manta"
)

func pad4(i int) string {
	return fmt.Sprintf("%04d", i)
}

func unzigzag32(raw uint32) int32 {
	return int32(raw>>1) ^ -int32(raw&1)
}

func asInt32(v any) (int32, bool) {
	switch x := v.(type) {
	case int32:
		return x, true
	case int:
		return int32(x), true
	case uint32:
		return int32(x), true
	case uint64:
		return int32(x), true
	case int64:
		return int32(x), true
	case float32:
		return int32(x), true
	case float64:
		return int32(x), true
	default:
		return 0, false
	}
}

func asUint32(v any) (uint32, bool) {
	switch x := v.(type) {
	case uint32:
		return x, true
	case uint64:
		return uint32(x), true
	case int32:
		return uint32(x), true
	case int:
		return uint32(x), true
	case float32:
		return uint32(x), true
	default:
		return 0, false
	}
}

func asUint64(v any) (uint64, bool) {
	switch x := v.(type) {
	case uint64:
		return x, true
	case uint32:
		return uint64(x), true
	case int32:
		return uint64(x), true
	case int64:
		return uint64(x), true
	default:
		return 0, false
	}
}

func asFloat32(v any) (float32, bool) {
	switch x := v.(type) {
	case float32:
		return x, true
	case float64:
		return float32(x), true
	case int32:
		return float32(x), true
	case uint32:
		return float32(x), true
	default:
		return 0, false
	}
}

func asBool(v any) (bool, bool) {
	switch x := v.(type) {
	case bool:
		return x, true
	case int32:
		return x != 0, true
	case uint32:
		return x != 0, true
	default:
		return false, false
	}
}

func getAny(e *manta.Entity, names ...string) any {
	if e == nil {
		return nil
	}
	for _, name := range names {
		if v := e.Get(name); v != nil {
			return v
		}
	}
	return nil
}

func getInt(e *manta.Entity, names ...string) int32 {
	v, ok := asInt32(getAny(e, names...))
	if !ok {
		return 0
	}
	return v
}

func getUint(e *manta.Entity, names ...string) uint32 {
	v, ok := asUint32(getAny(e, names...))
	if !ok {
		return 0
	}
	return v
}

func getUint64(e *manta.Entity, names ...string) uint64 {
	v, ok := asUint64(getAny(e, names...))
	if !ok {
		return 0
	}
	return v
}

func getFloat(e *manta.Entity, names ...string) float32 {
	v, ok := asFloat32(getAny(e, names...))
	if !ok {
		return 0
	}
	return v
}

func getBool(e *manta.Entity, names ...string) bool {
	v, ok := asBool(getAny(e, names...))
	if !ok {
		return false
	}
	return v
}

func getString(e *manta.Entity, names ...string) string {
	switch x := getAny(e, names...).(type) {
	case string:
		return x
	case []byte:
		return string(x)
	default:
		return ""
	}
}

func rulesPath(suffix string) []string {
	return []string{
		"m_pGameRules." + suffix,
		"dota_gamerules_data." + suffix,
	}
}

func rulesInt(e *manta.Entity, suffix string) int32 {
	return getInt(e, rulesPath(suffix)...)
}

func rulesUint(e *manta.Entity, suffix string) uint32 {
	return getUint(e, rulesPath(suffix)...)
}

func rulesFloat(e *manta.Entity, suffix string) float32 {
	return getFloat(e, rulesPath(suffix)...)
}

func rulesBool(e *manta.Entity, suffix string) bool {
	return getBool(e, rulesPath(suffix)...)
}

func vecPath(prefix string, i int, field string) string {
	return prefix + "." + pad4(i) + "." + field
}

func handleIndex(h uint64) int32 {
	if h == 0 || h == 0xFFFFFFFFFFFFFFFF {
		return -1
	}
	return int32(h & 0x3FFF)
}

func cellCoord(cell int32, vec float32) float32 {
	return float32(cell) + vec/128
}

func entityPosition(e *manta.Entity) (x, y, z float32, ok bool) {
	if e == nil {
		return 0, 0, 0, false
	}
	cx := getInt(e,
		"CBodyComponent.m_cellX",
		"m_CBodyComponent.m_cellX",
		"CBodyComponentBaseAnimGraph.m_cellX",
		"CBodyComponentBaseAnimating.m_cellX",
		"CBodyComponentBaseAnimatingOverlay.m_cellX",
		"m_cellX",
	)
	cy := getInt(e,
		"CBodyComponent.m_cellY",
		"m_CBodyComponent.m_cellY",
		"CBodyComponentBaseAnimGraph.m_cellY",
		"CBodyComponentBaseAnimating.m_cellY",
		"CBodyComponentBaseAnimatingOverlay.m_cellY",
		"m_cellY",
	)
	cz := getInt(e,
		"CBodyComponent.m_cellZ",
		"m_CBodyComponent.m_cellZ",
		"CBodyComponentBaseAnimGraph.m_cellZ",
		"CBodyComponentBaseAnimating.m_cellZ",
		"CBodyComponentBaseAnimatingOverlay.m_cellZ",
		"m_cellZ",
	)
	if cx == 0 && cy == 0 {
		if sx, ok := findSuffix(e, "m_cellX"); ok {
			cx = asInt32Or(sx)
		}
		if sy, ok := findSuffix(e, "m_cellY"); ok {
			cy = asInt32Or(sy)
		}
		if sz, ok := findSuffix(e, "m_cellZ"); ok {
			cz = asInt32Or(sz)
		}
	}
	vx := getFloat(e,
		"CBodyComponent.m_vecX",
		"m_CBodyComponent.m_vecX",
		"CBodyComponentBaseAnimGraph.m_vecX",
		"m_vecX",
	)
	vy := getFloat(e,
		"CBodyComponent.m_vecY",
		"m_CBodyComponent.m_vecY",
		"CBodyComponentBaseAnimGraph.m_vecY",
		"m_vecY",
	)
	vz := getFloat(e,
		"CBodyComponent.m_vecZ",
		"m_CBodyComponent.m_vecZ",
		"CBodyComponentBaseAnimGraph.m_vecZ",
		"m_vecZ",
	)
	if vx == 0 && vy == 0 {
		if sx, ok := findSuffix(e, "m_vecX"); ok {
			vx = asFloat32Or(sx)
		}
		if sy, ok := findSuffix(e, "m_vecY"); ok {
			vy = asFloat32Or(sy)
		}
		if sz, ok := findSuffix(e, "m_vecZ"); ok {
			vz = asFloat32Or(sz)
		}
	}
	if cx == 0 && cy == 0 && vx == 0 && vy == 0 {
		if ox, oy, oz, ok := originVec(e); ok {
			return ox / 128, oy / 128, oz / 128, true
		}
		return 0, 0, 0, false
	}
	return cellCoord(cx, vx), cellCoord(cy, vy), cellCoord(cz, vz), true
}

func originVec(e *manta.Entity) (x, y, z float32, ok bool) {
	v := getAny(e,
		"CBodyComponent.m_vecOrigin",
		"m_CBodyComponent.m_vecOrigin",
		"CBodyComponent.m_vecAbsOrigin",
	)
	if v == nil {
		if found, foundOK := findSuffix(e, "m_vecAbsOrigin"); foundOK {
			v = found
		} else if found, foundOK := findSuffix(e, "m_vecOrigin"); foundOK {
			v = found
		}
	}
	switch vec := v.(type) {
	case []float32:
		if len(vec) < 2 {
			return 0, 0, 0, false
		}
		z = 0
		if len(vec) > 2 {
			z = vec[2]
		}
		return vec[0], vec[1], z, vec[0] != 0 || vec[1] != 0
	default:
		return 0, 0, 0, false
	}
}

func asInt32Or(v any) int32 {
	n, _ := asInt32(v)
	return n
}

func asFloat32Or(v any) float32 {
	n, _ := asFloat32(v)
	return n
}

func classHasPrefix(e *manta.Entity, prefixes ...string) bool {
	if e == nil {
		return false
	}
	name := e.GetClassName()
	for _, p := range prefixes {
		if strings.HasPrefix(name, p) {
			return true
		}
	}
	return false
}

func canonHero(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c == '_' {
			continue
		}
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		b.WriteByte(c)
	}
	return b.String()
}

func heroSuffixFromClass(class string) string {
	if !strings.Contains(strings.ToLower(class), "hero") {
		return ""
	}
	return heroKey(class)
}

func heroSuffixFromNPC(name string) string {
	lower := strings.ToLower(name)
	if !strings.Contains(lower, "hero") && !strings.HasPrefix(lower, "npc_dota_hero_") {
		return ""
	}
	return heroKey(name)
}

func boolU8(v bool) uint8 {
	if v {
		return 1
	}
	return 0
}

func lookupCL(p *manta.Parser, idx uint32) string {
	if p == nil {
		return ""
	}
	name, ok := p.LookupStringByIndex("CombatLogNames", int32(idx))
	if !ok {
		return ""
	}
	return name
}

func unknownCL(name string) bool {
	n := strings.ToLower(strings.TrimSpace(name))
	return n == "" || n == "dota_unknown" || n == "unknown"
}

func clName(p *manta.Parser, idx uint32) string {
	name := lookupCL(p, idx)
	if unknownCL(name) {
		return ""
	}
	return name
}

func lookupEntityName(p *manta.Parser, idx uint32) string {
	if p == nil {
		return ""
	}
	name, ok := p.LookupStringByIndex("EntityNames", int32(idx))
	if !ok {
		return ""
	}
	return name
}

func findSuffix(e *manta.Entity, suffix string) (any, bool) {
	if e == nil {
		return nil, false
	}
	for k, v := range e.Map() {
		if strings.HasSuffix(k, suffix) && v != nil {
			return v, true
		}
	}
	return nil, false
}
