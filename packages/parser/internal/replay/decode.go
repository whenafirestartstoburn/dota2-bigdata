package replay

import "math"

type decoder func(*bits) any

func decodeBool(r *bits) any   { return r.bit() }
func decodeStr(r *bits) any    { return r.cstr() }
func decodeU32(r *bits) any    { return uint64(r.var32()) }
func decodeI32(r *bits) any    { return r.varS32() }
func decodeU64(r *bits) any    { return r.var64() }
func decodeI64(r *bits) any    { return r.varS64() }
func decodeFix64(r *bits) any  { return r.le64() }
func decodeBits1(r *bits) any  { return r.u(1) }
func decodeNoscale(r *bits) any {
	return math.Float32frombits(r.u(32))
}
func decodeCoord(r *bits) any { return r.coord() }
func decodeSim(r *bits) any   { return float32(r.var32()) * (1.0 / 30) }
func decodeRune(r *bits) any  { return math.Float32frombits(r.u(4)) }
func decodeBlood(r *bits) any { return uint64(r.u(8)) }
func decodeSeq(r *bits) any   { return int32(r.var32()) - 1 }
func decodeBlob(r *bits) any {
	n := r.var32()
	b := r.bytes(n)
	out := make([]byte, len(b))
	copy(out, b)
	return out
}
func decodeNorm3(r *bits) any { return r.normal3() }

func pickFloat(p *prop) decoder {
	switch p.encoder {
	case "coord":
		return decodeCoord
	case "simtime":
		return decodeSim
	case "runetime":
		return decodeRune
	}
	if p.bits == nil || *p.bits <= 0 || *p.bits >= 32 {
		return decodeNoscale
	}
	q := newQfloat(p.bits, p.flags, p.low, p.high)
	return func(r *bits) any { return q.read(r) }
}

func pickQuant(p *prop) decoder {
	q := newQfloat(p.bits, p.flags, p.low, p.high)
	return func(r *bits) any { return q.read(r) }
}

func pickU64(p *prop) decoder {
	if p.encoder == "fixed64" {
		return decodeFix64
	}
	return decodeU64
}

func pickVec(n int) func(*prop) decoder {
	return func(p *prop) decoder {
		if n == 3 && p.encoder == "normal" {
			return decodeNorm3
		}
		elem := pickFloat(p)
		return func(r *bits) any {
			out := make([]float32, n)
			for i := 0; i < n; i++ {
				out[i] = elem(r).(float32)
			}
			return out
		}
	}
}

func pickQAngle(p *prop) decoder {
	bc := uint32(0)
	if p.bits != nil {
		bc = uint32(*p.bits)
	}
	switch p.encoder {
	case "qangle_pitch_yaw":
		if bc == 0 || bc == 32 {
			return func(r *bits) any {
				return []float32{
					math.Float32frombits(r.u(32)),
					math.Float32frombits(r.u(32)),
					0,
				}
			}
		}
		return func(r *bits) any {
			return []float32{r.angle(bc), r.angle(bc), 0}
		}
	case "qangle_precise":
		return func(r *bits) any {
			out := make([]float32, 3)
			rx, ry, rz := r.bit(), r.bit(), r.bit()
			if rx {
				out[0] = r.angle(20)
			}
			if ry {
				out[1] = r.angle(20)
			}
			if rz {
				out[2] = r.angle(20)
			}
			return out
		}
	}
	if bc == 32 {
		return func(r *bits) any {
			return []float32{
				math.Float32frombits(r.u(32)),
				math.Float32frombits(r.u(32)),
				math.Float32frombits(r.u(32)),
			}
		}
	}
	if bc != 0 {
		return func(r *bits) any {
			return []float32{r.angle(bc), r.angle(bc), r.angle(bc)}
		}
	}
	return func(r *bits) any {
		out := make([]float32, 3)
		rx, ry, rz := r.bit(), r.bit(), r.bit()
		if rx {
			out[0] = r.coord()
		}
		if ry {
			out[1] = r.coord()
		}
		if rz {
			out[2] = r.coord()
		}
		return out
	}
}

var typeFactory = map[string]func(*prop) decoder{
	"float32":                  pickFloat,
	"CNetworkedQuantizedFloat": pickQuant,
	"Vector":                   pickVec(3),
	"Vector2D":                 pickVec(2),
	"Vector4D":                 pickVec(4),
	"VectorWS":                 pickVec(3),
	"Quaternion":               pickVec(4),
	"uint64":                   pickU64,
	"QAngle":                   pickQAngle,
	"CHandle":                  func(*prop) decoder { return decodeU32 },
	"CStrongHandle":            pickU64,
	"CEntityHandle":            func(*prop) decoder { return decodeU32 },
}

var typeDecode = map[string]decoder{
	"bool":                 decodeBool,
	"char":                 decodeStr,
	"color32":              decodeU32,
	"int16":                decodeI32,
	"int32":                decodeI32,
	"int64":                decodeI64,
	"int8":                 decodeI32,
	"uint16":               decodeU32,
	"uint32":               decodeU32,
	"uint8":                decodeU32,
	"GameTime_t":           decodeNoscale,
	"HeroFacetKey_t":       decodeU64,
	"HeroID_t":             decodeI32,
	"HSequence":            decodeSeq,
	"BloodType":            decodeBlood,
	"CBodyComponent":       decodeBits1,
	"CGameSceneNodeHandle": decodeU32,
	"Color":                decodeU32,
	"CPhysicsComponent":    decodeBits1,
	"CRenderComponent":     decodeBits1,
	"CUtlString":           decodeStr,
	"CUtlStringToken":      decodeU32,
	"CUtlSymbolLarge":      decodeStr,
	"CUtlBinaryBlock":      decodeBlob,
	"CGlobalSymbol":        decodeStr,
	"ResourceId_t":         decodeU64,
}

func decoderFor(p *prop) decoder {
	if fn, ok := typeFactory[p.kind.base]; ok {
		return fn(p)
	}
	if d, ok := typeDecode[p.kind.base]; ok {
		return d
	}
	return decodeU32
}

func decoderByBase(base string) decoder {
	if d, ok := typeDecode[base]; ok {
		return d
	}
	return decodeU32
}
