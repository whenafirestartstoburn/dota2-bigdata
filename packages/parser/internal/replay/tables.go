package replay

import (
	"math"
	"regexp"
	"strconv"

	"dota2-collector/parser/internal/valve"

	"google.golang.org/protobuf/proto"
)

var buildRe = regexp.MustCompile(`/dota_v(\d+)/`)

func (s *Session) setGameBuild(dir string) {
	if g := buildRe.FindStringSubmatch(dir); len(g) >= 2 {
		if n, err := strconv.ParseUint(g[1], 10, 32); err == nil {
			s.GameBuild = uint32(n)
		}
	}
}

func (s *Session) onFileHeader(m *valve.CDemoFileHeader) error {
	s.setGameBuild(m.GetGameDirectory())
	return nil
}

func (s *Session) flushSerializers() error {
	if s.pendingSend != nil {
		msg := &valve.CDemoSendTables{}
		if err := proto.Unmarshal(s.pendingSend, msg); err != nil {
			return err
		}
		s.pendingSend = nil
		if err := s.onSendTables(msg); err != nil {
			return err
		}
	}
	if s.pendingClass != nil {
		msg := &valve.CDemoClassInfo{}
		if err := proto.Unmarshal(s.pendingClass, msg); err != nil {
			return err
		}
		s.pendingClass = nil
		if err := s.onClassInfo(msg); err != nil {
			return err
		}
	}
	return nil
}

func (s *Session) onServerInfo(m *valve.CSVCMsg_ServerInfo) error {
	s.classBits = uint32(math.Log(float64(m.GetMaxClasses()))/math.Log(2)) + 1
	s.setGameBuild(m.GetGameDir())
	if err := s.flushSerializers(); err != nil {
		return err
	}
	if s.Hooks.ServerInfo != nil {
		return s.Hooks.ServerInfo(m)
	}
	return nil
}

func (s *Session) onSendTables(m *valve.CDemoSendTables) error {
	r := newBits(m.GetData())
	raw := r.bytes(r.var32())
	msg := &valve.CSVCMsg_FlattenedSerializer{}
	if err := proto.Unmarshal(raw, msg); err != nil {
		return err
	}
	var fixes []buildFix
	for _, f := range buildFixes {
		if f.applies(s.GameBuild) {
			fixes = append(fixes, f)
		}
	}
	fields := map[int32]*prop{}
	kinds := map[string]*kind{}
	for _, ser := range msg.GetSerializers() {
		lay := &layout{
			name: msg.GetSymbols()[ser.GetSerializerNameSym()],
			ver:  ser.GetSerializerVersion(),
		}
		for _, i := range ser.GetFieldsIndex() {
			if _, ok := fields[i]; !ok {
				p := newProp(msg, msg.GetFields()[i])
				if s.GameBuild <= 990 {
					p.parent = lay.name
				}
				if _, ok := kinds[p.typ]; !ok {
					kinds[p.typ] = parseKind(p.typ)
				}
				p.kind = kinds[p.typ]
				if p.serName != "" {
					p.layout = s.layouts[p.serName]
				}
				for _, f := range fixes {
					f.fn(p)
				}
				switch {
				case p.layout != nil:
					if p.kind.ptr || embeddedPtr[p.kind.base] {
						p.setModel(modelFixedTab)
					} else {
						p.setModel(modelVarTab)
					}
				case p.kind.count > 0 && p.kind.base != "char":
					p.setModel(modelFixedArr)
				case p.kind.base == "CUtlVector" || p.kind.base == "CNetworkUtlVectorBase":
					p.setModel(modelVarArr)
				default:
					p.setModel(modelLeaf)
				}
				fields[i] = p
			}
			lay.fields = append(lay.fields, fields[i])
		}
		s.layouts[lay.name] = lay
		if c, ok := s.classByName[lay.name]; ok {
			c.layout = lay
		}
	}
	return nil
}

func (s *Session) onClassInfo(m *valve.CDemoClassInfo) error {
	for _, c := range m.GetClasses() {
		cl := &class{
			id:     c.GetClassId(),
			name:   c.GetNetworkName(),
			layout: s.layouts[c.GetNetworkName()],
			cache:  map[string]*cursor{},
			miss:   map[string]bool{},
		}
		s.classByID[cl.id] = cl
		s.classByName[cl.name] = cl
	}
	s.haveClasses = true
	s.refreshBaselines()
	return nil
}

func (s *Session) refreshBaselines() {
	if !s.haveClasses {
		return
	}
	tab, ok := s.tables.byName("instancebaseline")
	if !ok {
		return
	}
	for _, item := range tab.items {
		id, err := strconv.ParseInt(item.key, 10, 32)
		if err != nil {
			continue
		}
		s.baselines[int32(id)] = item.val
	}
	clear(s.baselineState)
}
