package replay

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"dota2-collector/parser/internal/valve"
)

const (
	modelLeaf = iota
	modelFixedArr
	modelFixedTab
	modelVarArr
	modelVarTab
)

type kind struct {
	base    string
	generic *kind
	ptr     bool
	count   int
}

var kindRe = regexp.MustCompile(`([^\<\[\*]+)(\<\s(.*)\s\>)?(\*)?(\[(.*)\])?`)

var arrayLens = map[string]int{
	"MAX_ITEM_STOCKS":             8,
	"MAX_ABILITY_DRAFT_ABILITIES": 48,
}

var embeddedPtr = map[string]bool{
	"PhysicsRagdollPose_t":       true,
	"CBodyComponent":             true,
	"CEntityIdentity":            true,
	"CPhysicsComponent":          true,
	"CRenderComponent":           true,
	"CDOTAGamerules":             true,
	"CDOTAGameManager":           true,
	"CDOTASpectatorGraphManager": true,
	"CPlayerLocalData":           true,
	"CPlayer_CameraServices":     true,
	"CDOTAGameRules":             true,
}

func parseKind(name string) *kind {
	m := kindRe.FindStringSubmatch(name)
	if len(m) != 7 {
		die("unparseable sendtable type %q", name)
	}
	k := &kind{base: m[1], ptr: m[4] == "*"}
	if m[3] != "" {
		k.generic = parseKind(m[3])
	}
	if n, ok := arrayLens[m[6]]; ok {
		k.count = n
	} else if n, _ := strconv.Atoi(m[6]); n > 0 {
		k.count = n
	} else if m[6] != "" {
		k.count = 1024
	}
	return k
}

type prop struct {
	parent   string
	name     string
	typ      string
	node     string
	serName  string
	serVer   int32
	encoder  string
	flags    *int32
	bits     *int32
	low      *float32
	high     *float32
	kind     *kind
	layout   *layout
	model    int
	dec      decoder
	baseDec  decoder
	childDec decoder
}

func newProp(ser *valve.CSVCMsg_FlattenedSerializer, f *valve.ProtoFlattenedSerializerFieldT) *prop {
	sym := func(p *int32) string {
		if p == nil {
			return ""
		}
		return ser.GetSymbols()[*p]
	}
	p := &prop{
		name:    sym(f.VarNameSym),
		typ:     sym(f.VarTypeSym),
		node:    sym(f.SendNodeSym),
		serName: sym(f.FieldSerializerNameSym),
		serVer:  f.GetFieldSerializerVersion(),
		encoder: sym(f.VarEncoderSym),
		flags:   f.EncodeFlags,
		bits:    f.BitCount,
		low:     f.LowValue,
		high:    f.HighValue,
		model:   modelLeaf,
	}
	if p.node == "(root)" {
		p.node = ""
	}
	return p
}

func (p *prop) setModel(m int) {
	p.model = m
	switch m {
	case modelFixedArr:
		p.dec = decoderFor(p)
	case modelFixedTab:
		p.baseDec = decodeBool
	case modelVarArr:
		if p.kind.generic == nil {
			die("variable array %s has no element type", p.name)
		}
		p.baseDec = decodeU32
		p.childDec = decoderByBase(p.kind.generic.base)
	case modelVarTab:
		p.baseDec = decodeU32
	case modelLeaf:
		p.dec = decoderFor(p)
	}
}

func (p *prop) decoderAt(c *cursor, pos int) decoder {
	switch p.model {
	case modelFixedArr:
		return p.dec
	case modelFixedTab:
		if c.last == pos-1 {
			return p.baseDec
		}
		return p.layout.decoderAt(c, pos)
	case modelVarArr:
		if c.last == pos {
			return p.childDec
		}
		return p.baseDec
	case modelVarTab:
		if c.last >= pos+1 {
			return p.layout.decoderAt(c, pos+1)
		}
		return p.baseDec
	}
	return p.dec
}

func (p *prop) nameAt(c *cursor, pos int) []string {
	out := []string{p.name}
	switch p.model {
	case modelFixedArr, modelVarArr:
		if c.last == pos {
			out = append(out, fmt.Sprintf("%04d", c.idx[pos]))
		}
	case modelFixedTab:
		if c.last >= pos {
			out = append(out, p.layout.nameAt(c, pos)...)
		}
	case modelVarTab:
		if c.last != pos-1 {
			out = append(out, fmt.Sprintf("%04d", c.idx[pos]))
			if c.last != pos {
				out = append(out, p.layout.nameAt(c, pos+1)...)
			}
		}
	}
	return out
}

func (p *prop) pathForName(c *cursor, name string) bool {
	switch p.model {
	case modelFixedArr, modelVarArr:
		n, err := strconv.Atoi(name)
		if err != nil || len(name) != 4 {
			return false
		}
		c.idx[c.last] = n
		return true
	case modelFixedTab:
		return p.layout.pathForName(c, name)
	case modelVarTab:
		if len(name) < 6 {
			return false
		}
		n, err := strconv.Atoi(name[:4])
		if err != nil {
			return false
		}
		c.idx[c.last] = n
		c.last++
		return p.layout.pathForName(c, name[5:])
	}
	return false
}

func (p *prop) walk(c *cursor, t *tree) []*cursor {
	switch p.model {
	case modelFixedArr, modelVarArr:
		sub, ok := t.get(c).(*tree)
		if !ok {
			return nil
		}
		c.last++
		var out []*cursor
		for i, v := range sub.vals {
			if v != nil {
				c.idx[c.last] = i
				out = append(out, c.copy())
			}
		}
		c.last--
		return out
	case modelFixedTab:
		sub, ok := t.get(c).(*tree)
		if !ok {
			return nil
		}
		c.last++
		out := p.layout.walk(c, sub)
		c.last--
		return out
	case modelVarTab:
		sub, ok := t.get(c).(*tree)
		if !ok {
			return nil
		}
		c.last += 2
		var out []*cursor
		for i, v := range sub.vals {
			if child, ok := v.(*tree); ok {
				c.idx[c.last-1] = i
				out = append(out, p.layout.walk(c, child)...)
			}
		}
		c.last -= 2
		return out
	}
	return []*cursor{c.copy()}
}

type layout struct {
	name   string
	ver    int32
	fields []*prop
}

func (l *layout) decoderAt(c *cursor, pos int) decoder {
	i := c.idx[pos]
	if i >= len(l.fields) {
		die("layout %s: path index %d out of range", l.name, i)
	}
	return l.fields[i].decoderAt(c, pos+1)
}

func (l *layout) nameAt(c *cursor, pos int) []string {
	return l.fields[c.idx[pos]].nameAt(c, pos+1)
}

func (l *layout) pathForName(c *cursor, name string) bool {
	for i, f := range l.fields {
		if name == f.name {
			c.idx[c.last] = i
			return true
		}
		if strings.HasPrefix(name, f.name+".") {
			c.idx[c.last] = i
			c.last++
			return f.pathForName(c, name[len(f.name)+1:])
		}
	}
	return false
}

func (l *layout) walk(c *cursor, t *tree) []*cursor {
	var out []*cursor
	for i, f := range l.fields {
		c.idx[c.last] = i
		out = append(out, f.walk(c, t)...)
	}
	return out
}

type class struct {
	id     int32
	name   string
	layout *layout
	cache  map[string]*cursor
	miss   map[string]bool
}

func (c *class) nameOf(cur *cursor) string {
	return strings.Join(c.layout.nameAt(cur, 0), ".")
}

func (c *class) decoderOf(cur *cursor) decoder {
	return c.layout.decoderAt(cur, 0)
}

func (c *class) pathOf(name string) (*cursor, bool) {
	if fp, ok := c.cache[name]; ok {
		return fp, true
	}
	if c.miss[name] {
		return nil, false
	}
	fp := newCursor()
	if !c.layout.pathForName(fp, name) {
		c.miss[name] = true
		return nil, false
	}
	c.cache[name] = fp
	return fp, true
}
