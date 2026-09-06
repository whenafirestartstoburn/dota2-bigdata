package replay

import (
	"dota2-collector/parser/internal/valve"

	"github.com/golang/snappy"
)

const keyHist = 32

type tableSet struct {
	byID   map[int32]*strTable
	names  map[string]int32
	next   int32
}

type strTable struct {
	id        int32
	name      string
	items     map[int32]*strItem
	fixed     bool
	sizeBits  int32
	flags     int32
	varBits   bool
}

type strItem struct {
	index int32
	key   string
	val   []byte
}

func newTableSet() *tableSet {
	return &tableSet{
		byID:  map[int32]*strTable{},
		names: map[string]int32{},
	}
}

func (t *tableSet) byName(name string) (*strTable, bool) {
	i, ok := t.names[name]
	if !ok {
		return nil, false
	}
	tab, ok := t.byID[i]
	return tab, ok
}

func inflateTable(buf []byte) ([]byte, error) {
	if len(buf) >= 4 && string(buf[:4]) == "LZSS" {
		return unlzss(buf)
	}
	return snappy.Decode(nil, buf)
}

func unlzss(buf []byte) ([]byte, error) {
	r := newBits(buf)
	if r.cstrN(4) != "LZSS" {
		return nil, fail("missing LZSS header")
	}
	need := int(r.le32())
	out := make([]byte, 0, need)
	var cmd, step byte
	for {
		if step == 0 {
			cmd = r.byte()
		}
		step = (step + 1) & 0x07
		if cmd&1 != 0 {
			a, b := r.byte(), r.byte()
			pos := (int(a) << 4) | (int(b) >> 4)
			n := int((b & 0x0F) + 1)
			if n == 1 {
				break
			}
			src := len(out) - pos - 1
			for i := 0; i < n; i++ {
				out = append(out, out[src+i])
			}
		} else {
			out = append(out, r.byte())
		}
		cmd >>= 1
	}
	if len(out) != need {
		return nil, fail("LZSS size mismatch")
	}
	return out, nil
}

func (s *Session) onCreateTable(m *valve.CSVCMsg_CreateStringTable) error {
	tab := &strTable{
		id:       s.tables.next,
		name:     m.GetName(),
		items:    map[int32]*strItem{},
		fixed:    m.GetUserDataFixedSize(),
		sizeBits: m.GetUserDataSizeBits(),
		flags:    m.GetFlags(),
		varBits:  m.GetUsingVarintBitcounts(),
	}
	s.tables.next++
	buf := m.GetStringData()
	if m.GetDataCompressed() {
		var err error
		buf, err = inflateTable(buf)
		if err != nil {
			return err
		}
	}
	items, err := parseTable(buf, m.GetNumEntries(), tab)
	if err != nil {
		return err
	}
	for _, it := range items {
		tab.items[it.index] = it
	}
	s.tables.byID[tab.id] = tab
	s.tables.names[tab.name] = tab.id
	if tab.name == "instancebaseline" {
		s.refreshBaselines()
	}
	return nil
}

func (s *Session) onUpdateTable(m *valve.CSVCMsg_UpdateStringTable) error {
	tab, ok := s.tables.byID[m.GetTableId()]
	if !ok {
		die("unknown string table %d", m.GetTableId())
	}
	items, err := parseTable(m.GetStringData(), m.GetNumChangedEntries(), tab)
	if err != nil {
		return err
	}
	for _, it := range items {
		if cur, ok := tab.items[it.index]; ok {
			if it.key != "" && it.key != cur.key {
				cur.key = it.key
			}
			if len(it.val) > 0 {
				cur.val = it.val
			}
		} else {
			tab.items[it.index] = it
		}
	}
	if tab.name == "instancebaseline" {
		s.refreshBaselines()
	}
	return nil
}

func parseTable(buf []byte, n int32, tab *strTable) (items []*strItem, err error) {
	defer func() {
		if rec := recover(); rec != nil {
			if e, ok := rec.(error); ok {
				err = e
			} else {
				err = fail("string table decode")
			}
		}
	}()
	if len(buf) == 0 {
		return nil, nil
	}
	r := newBits(buf)
	index := int32(-1)
	keys := make([]string, 0, keyHist)
	for i := 0; i < int(n); i++ {
		if r.bit() {
			index++
		} else {
			index += int32(r.var32()) + 2
		}
		key := ""
		if r.bit() {
			if r.bit() {
				pos := r.u(5)
				size := r.u(5)
				if int(pos) >= len(keys) {
					key += r.cstr()
				} else {
					s := keys[pos]
					if int(size) > len(s) {
						key += s + r.cstr()
					} else {
						key += s[:size] + r.cstr()
					}
				}
			} else {
				key = r.cstr()
			}
			if len(keys) >= keyHist {
				copy(keys[0:], keys[1:])
				keys[len(keys)-1] = ""
				keys = keys[:len(keys)-1]
			}
			keys = append(keys, key)
		}
		var val []byte
		if r.bit() {
			var bits uint32
			zip := false
			if tab.fixed {
				bits = uint32(tab.sizeBits)
			} else {
				if tab.flags&1 != 0 {
					zip = r.bit()
				}
				if tab.varBits {
					bits = r.uBitVar() * 8
				} else {
					bits = r.u(17) * 8
				}
			}
			val = r.bitBytes(bits)
			if zip {
				dec, e := snappy.Decode(nil, val)
				if e != nil {
					die("snappy string-table item: %v", e)
				}
				val = dec
			}
		}
		items = append(items, &strItem{index, key, val})
	}
	return items, nil
}

// LookupString returns the key at index in a named string table.
func (s *Session) LookupString(table string, index int32) (string, bool) {
	tab, ok := s.tables.byName(table)
	if !ok {
		return "", false
	}
	it, ok := tab.items[index]
	if !ok {
		return "", false
	}
	return it.key, true
}
