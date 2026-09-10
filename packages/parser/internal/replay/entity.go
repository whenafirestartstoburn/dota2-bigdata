package replay

import "dota2-collector/parser/internal/valve"

const (
	indexBits  = 14
	handleMask = (1 << indexBits) - 1
)

// Op is a bitmask for one entity mutation in a PacketEntities message.
type Op int

const (
	OpCreated Op = 1 << iota
	OpUpdated
	OpDeleted
	OpEntered
	OpLeft
)

func (o Op) Has(p Op) bool { return o&p != 0 }

// Entity is one networked object in the current snapshot.
type Entity struct {
	index     int32
	serial    int32
	class     *class
	active    bool
	discarded bool
	state     *tree
}

// Discarded is true when the bitstream was consumed but the property
// tree was dropped (creeps, projectiles, …).
func (e *Entity) Discarded() bool {
	return e == nil || e.discarded
}

func (e *Entity) GetIndex() int32  { return e.index }
func (e *Entity) GetSerial() int32 { return e.serial }
func (e *Entity) GetClassName() string {
	if e == nil || e.class == nil {
		return ""
	}
	return e.class.name
}

// Get returns the current value of a dotted sendtable path, or nil.
func (e *Entity) Get(name string) any {
	if e == nil || e.class == nil || e.state == nil {
		return nil
	}
	fp, ok := e.class.pathOf(name)
	if !ok {
		return nil
	}
	return e.state.get(fp)
}

func (s *Session) FindEntity(index int32) *Entity {
	return s.ents[index]
}

func (s *Session) FindEntityByHandle(handle uint64) *Entity {
	e := s.ents[int32(handle&handleMask)]
	if e != nil && e.serial != int32(handle>>indexBits) {
		return nil
	}
	return e
}

func (s *Session) baselineFor(id int32, cl *class) *tree {
	if t := s.baselineState[id]; t != nil {
		return t
	}
	raw := s.baselines[id]
	if raw == nil {
		die("missing instance baseline for class %d", id)
	}
	t := newTree()
	s.pathBuf = applyPaths(newBits(raw), cl.layout, t, s.pathBuf)
	s.baselineState[id] = t
	return t
}

func (s *Session) onPacketEntities(m *valve.CSVCMsg_PacketEntities) error {
	if err := s.flushSerializers(); err != nil {
		return err
	}
	r := &s.entBits
	r.reset(m.GetEntityData())
	index := int32(-1)
	n := int(m.GetUpdatedEntries())
	if !m.GetLegacyIsDelta() {
		if s.fullPackets > 0 {
			if s.Hooks.PacketEntities != nil {
				return s.Hooks.PacketEntities(m)
			}
			return nil
		}
		s.fullPackets++
	}
	type pair struct {
		e  *Entity
		op Op
	}
	seen := make([]pair, 0, n)
	for ; n > 0; n-- {
		var e *Entity
		var op Op
		index, e, op = s.readEntity(r, index)
		seen = append(seen, pair{e, op})
	}
	for _, h := range s.entHooks {
		for _, p := range seen {
			if err := h(p.e, p.op); err != nil {
				return err
			}
		}
	}
	if s.Hooks.PacketEntities != nil {
		return s.Hooks.PacketEntities(m)
	}
	return nil
}

func (s *Session) readEntity(r *bits, index int32) (next int32, e *Entity, op Op) {
	defer func() {
		if rec := recover(); rec != nil {
			name := ""
			if e != nil && e.class != nil {
				name = e.class.name
			}
			die("%v (tick=%d ent=%d class=%s %d/%d)", rec, s.Tick, next, name, r.pos, r.size)
		}
	}()
	next = index + int32(r.uBitVar()) + 1
	cmd := r.u(2)
	if cmd&0x01 == 0 {
		if cmd&0x02 != 0 {
			classID := int32(r.u(s.classBits))
			serial := int32(r.u(17))
			r.var32()
			cl := s.classByID[classID]
			if cl == nil {
				die("unknown class id %d", classID)
			}
			if !KeepClass(cl.name) {
				e = &Entity{
					index:     next,
					serial:    serial,
					class:     cl,
					active:    true,
					discarded: true,
				}
				s.ents[next] = e
				s.pathBuf = skipPaths(r, cl.layout, s.pathBuf)
				op = OpCreated | OpEntered
				return next, e, op
			}
			e = &Entity{
				index:  next,
				serial: serial,
				class:  cl,
				active: true,
				state:  s.baselineFor(classID, cl).clone(),
			}
			s.ents[next] = e
			s.pathBuf = applyPaths(r, cl.layout, e.state, s.pathBuf)
			op = OpCreated | OpEntered
			return next, e, op
		}
		e = s.ents[next]
		if e == nil {
			die("update of missing entity %d", next)
		}
		op = OpUpdated
		if !e.active {
			e.active = true
			op |= OpEntered
		}
		if e.discarded {
			s.pathBuf = skipPaths(r, e.class.layout, s.pathBuf)
			return next, e, op
		}
		s.pathBuf = applyPaths(r, e.class.layout, e.state, s.pathBuf)
		return next, e, op
	}
	e = s.ents[next]
	if e == nil {
		die("leave of missing entity %d", next)
	}
	op = OpLeft
	if cmd&0x02 != 0 {
		op |= OpDeleted
		s.ents[next] = nil
	}
	return next, e, op
}

// OnEntity registers a handler for create/update/leave/delete.
func (s *Session) OnEntity(fn func(*Entity, Op) error) {
	s.entHooks = append(s.entHooks, fn)
}
