package replay

import (
	"bytes"
	"fmt"
	"io"
	"sort"

	"dota2-collector/parser/internal/valve"

	"github.com/golang/snappy"
	"google.golang.org/protobuf/proto"
)

var magicS2 = []byte{'P', 'B', 'D', 'E', 'M', 'S', '2', 0}

// Hooks are optional extract callbacks. Decoder state is updated first.
type Hooks struct {
	ServerInfo     func(*valve.CSVCMsg_ServerInfo) error
	Tick           func(*valve.CNETMsg_Tick) error
	PacketEntities func(*valve.CSVCMsg_PacketEntities) error
	CombatLog      func(*valve.CMsgDOTACombatLogEntry) error
	UnitOrders     func(*valve.CDOTAUserMsg_SpectatorPlayerUnitOrders) error
	LocationPing   func(*valve.CDOTAUserMsg_LocationPing) error
	Minimap        func(*valve.CDOTAUserMsg_MinimapEvent) error
	ChatEvent      func(*valve.CDOTAUserMsg_ChatEvent) error
	ChatMessage    func(*valve.CDOTAUserMsg_ChatMessage) error
	ChatWheel      func(*valve.CDOTAUserMsg_ChatWheel) error
	SayText2       func(*valve.CUserMessageSayText2) error
	GamerulesState func(*valve.CDOTAUserMsg_GamerulesStateChanged) error
	NeutralFound   func(*valve.CDOTAUserMsg_FoundNeutralItem) error
	FileInfo       func(*valve.CDemoFileInfo) error
	Metadata       func(*valve.CDOTAMatchMetadataFile) error
	// UserMessage is unmatched DOTA_UM_* payloads (alerts, item sold, …).
	UserMessage func(kind int32, buf []byte) error
}

// Session is our Source 2 demo decoder. It does not import any third-party
// replay parser; Valve protobuf types live in internal/valve.
type Session struct {
	Tick      uint32
	NetTick   uint32
	GameBuild uint32
	Hooks     Hooks

	stream *wire
	stop   bool
	snap   []byte

	layouts       map[string]*layout
	classByID     map[int32]*class
	classByName   map[string]*class
	classBits     uint32
	haveClasses   bool
	baselines     map[int32][]byte
	baselineState map[int32]*tree
	ents          map[int32]*Entity
	entHooks      []func(*Entity, Op) error
	tables        *tableSet
	fullPackets   int
	entBits       bits
	pathBuf       []cursor
	pendingSend   []byte
	pendingClass  []byte
}

// New starts a decoder on a Source 2 (PBDEMS2) stream.
func New(r io.Reader) (*Session, error) {
	s := &Session{
		stream:        newWire(r),
		layouts:       map[string]*layout{},
		classByID:     map[int32]*class{},
		classByName:   map[string]*class{},
		baselines:     map[int32][]byte{},
		baselineState: map[int32]*tree{},
		ents:          map[int32]*Entity{},
		tables:        newTableSet(),
	}
	magic, err := s.stream.bytes(8)
	if err != nil {
		return nil, err
	}
	if !bytes.Equal(magic, magicS2) {
		return nil, fmt.Errorf("not a Source 2 demo (got %q)", magic)
	}
	if _, err := s.stream.bytes(8); err != nil {
		return nil, err
	}
	return s, nil
}

// Start consumes the demo until stop or EOF.
func (s *Session) Start() (err error) {
	defer func() {
		if rec := recover(); rec != nil {
			if e, ok := rec.(error); ok {
				err = e
			} else {
				err = fmt.Errorf("%v", rec)
			}
		}
	}()
	for !s.stop {
		kind, tick, payload, err := s.nextOuter()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		s.Tick = tick
		if err := s.dispatchDemo(kind, payload); err != nil {
			return err
		}
	}
	return nil
}

func (s *Session) nextOuter() (int32, uint32, []byte, error) {
	cmd, err := s.stream.var32()
	if err != nil {
		return 0, 0, nil, err
	}
	kind := int32(cmd &^ uint32(valve.EDemoCommands_DEM_IsCompressed))
	zip := cmd&uint32(valve.EDemoCommands_DEM_IsCompressed) != 0
	tick, err := s.stream.var32()
	if err != nil {
		return 0, 0, nil, err
	}
	if tick == 0xFFFFFFFF {
		tick = 0
	}
	n, err := s.stream.var32()
	if err != nil {
		return 0, 0, nil, err
	}
	if n > maxOuterBytes {
		return 0, 0, nil, fmt.Errorf("outer frame %d bytes is too large", n)
	}
	buf, err := s.stream.bytes(n)
	if err != nil {
		return 0, 0, nil, err
	}
	if zip {
		buf, err = snappy.Decode(s.snap[:cap(s.snap)], buf)
		if err != nil {
			return 0, 0, nil, err
		}
		s.snap = buf
	}
	return kind, tick, buf, nil
}

func (s *Session) dispatchDemo(kind int32, buf []byte) error {
	switch valve.EDemoCommands(kind) {
	case valve.EDemoCommands_DEM_Stop:
		s.stop = true
		return nil
	case valve.EDemoCommands_DEM_FileHeader:
		m := &valve.CDemoFileHeader{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		return s.onFileHeader(m)
	case valve.EDemoCommands_DEM_FileInfo:
		m := &valve.CDemoFileInfo{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		if s.Hooks.FileInfo != nil {
			return s.Hooks.FileInfo(m)
		}
		return nil
	case valve.EDemoCommands_DEM_SendTables:
		if s.GameBuild == 0 {
			s.pendingSend = append([]byte(nil), buf...)
			return nil
		}
		m := &valve.CDemoSendTables{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		return s.onSendTables(m)
	case valve.EDemoCommands_DEM_ClassInfo:
		if s.GameBuild == 0 || s.pendingSend != nil {
			s.pendingClass = append([]byte(nil), buf...)
			return nil
		}
		m := &valve.CDemoClassInfo{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		return s.onClassInfo(m)
	case valve.EDemoCommands_DEM_Packet, valve.EDemoCommands_DEM_SignonPacket:
		m := &valve.CDemoPacket{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		return s.onPacket(m)
	case valve.EDemoCommands_DEM_FullPacket:
		m := &valve.CDemoFullPacket{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		if m.GetPacket() != nil {
			return s.onPacket(m.GetPacket())
		}
		return nil
	}
	return nil
}

type inner struct {
	tick uint32
	kind int32
	buf  []byte
}

func packetPri(kind int32) int {
	switch kind {
	case int32(valve.NET_Messages_net_Tick),
		int32(valve.SVC_Messages_svc_CreateStringTable),
		int32(valve.SVC_Messages_svc_UpdateStringTable),
		int32(valve.NET_Messages_net_SpawnGroup_Load):
		return -10
	case int32(valve.SVC_Messages_svc_ServerInfo):
		return -5
	case int32(valve.SVC_Messages_svc_PacketEntities):
		return 5
	case int32(valve.EBaseGameEvents_GE_Source1LegacyGameEvent):
		return 10
	}
	return 0
}

func (s *Session) onPacket(m *valve.CDemoPacket) error {
	r := newBits(m.GetData())
	var ms []inner
	// type tag is 6+ bits and size is a varint; Valve pads the last
	// byte. Do not start another message from leftover padding.
	for r.remainBits() >= 14 {
		kind := int32(r.uBitVar())
		n := r.var32()
		if r.remainBits() < n*8 {
			break
		}
		ms = append(ms, inner{s.Tick, kind, r.bytes(n)})
	}
	sort.SliceStable(ms, func(i, j int) bool {
		if ms[i].tick != ms[j].tick {
			return ms[i].tick < ms[j].tick
		}
		return packetPri(ms[i].kind) < packetPri(ms[j].kind)
	})
	for i := range ms {
		if err := s.dispatchPacket(ms[i].kind, ms[i].buf); err != nil {
			return err
		}
	}
	return nil
}

func (s *Session) dispatchPacket(kind int32, buf []byte) error {
	switch kind {
	case int32(valve.NET_Messages_net_Tick):
		m := &valve.CNETMsg_Tick{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		s.NetTick = m.GetTick()
		if s.Hooks.Tick != nil {
			return s.Hooks.Tick(m)
		}
		return nil
	case int32(valve.SVC_Messages_svc_ServerInfo):
		m := &valve.CSVCMsg_ServerInfo{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		return s.onServerInfo(m)
	case int32(valve.SVC_Messages_svc_CreateStringTable):
		m := &valve.CSVCMsg_CreateStringTable{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		return s.onCreateTable(m)
	case int32(valve.SVC_Messages_svc_UpdateStringTable):
		m := &valve.CSVCMsg_UpdateStringTable{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		return s.onUpdateTable(m)
	case int32(valve.SVC_Messages_svc_PacketEntities):
		m := &valve.CSVCMsg_PacketEntities{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		return s.onPacketEntities(m)
	case int32(valve.SVC_Messages_svc_UserMessage):
		m := &valve.CSVCMsg_UserMessage{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		return s.dispatchPacket(m.GetMsgType(), m.GetMsgData())
	case int32(valve.EBaseUserMessages_UM_SayText2):
		if s.Hooks.SayText2 == nil {
			return nil
		}
		m := &valve.CUserMessageSayText2{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		return s.Hooks.SayText2(m)
	case int32(valve.EDotaUserMessages_DOTA_UM_ChatEvent):
		if s.Hooks.ChatEvent == nil {
			return nil
		}
		m := &valve.CDOTAUserMsg_ChatEvent{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		return s.Hooks.ChatEvent(m)
	case int32(valve.EDotaUserMessages_DOTA_UM_LocationPing):
		if s.Hooks.LocationPing == nil {
			return nil
		}
		m := &valve.CDOTAUserMsg_LocationPing{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		return s.Hooks.LocationPing(m)
	case int32(valve.EDotaUserMessages_DOTA_UM_MinimapEvent):
		if s.Hooks.Minimap == nil {
			return nil
		}
		m := &valve.CDOTAUserMsg_MinimapEvent{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		return s.Hooks.Minimap(m)
	case int32(valve.EDotaUserMessages_DOTA_UM_ChatWheel):
		if s.Hooks.ChatWheel == nil {
			return nil
		}
		m := &valve.CDOTAUserMsg_ChatWheel{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		return s.Hooks.ChatWheel(m)
	case int32(valve.EDotaUserMessages_DOTA_UM_GamerulesStateChanged):
		if s.Hooks.GamerulesState == nil {
			return nil
		}
		m := &valve.CDOTAUserMsg_GamerulesStateChanged{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		return s.Hooks.GamerulesState(m)
	case int32(valve.EDotaUserMessages_DOTA_UM_SpectatorPlayerUnitOrders):
		if s.Hooks.UnitOrders == nil {
			return nil
		}
		m := &valve.CDOTAUserMsg_SpectatorPlayerUnitOrders{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		return s.Hooks.UnitOrders(m)
	case int32(valve.EDotaUserMessages_DOTA_UM_CombatLogDataHLTV):
		if s.Hooks.CombatLog == nil {
			return nil
		}
		m := &valve.CMsgDOTACombatLogEntry{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		return s.Hooks.CombatLog(m)
	case int32(valve.EDotaUserMessages_DOTA_UM_MatchMetadata):
		if s.Hooks.Metadata == nil {
			return nil
		}
		m := &valve.CDOTAMatchMetadataFile{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		return s.Hooks.Metadata(m)
	case int32(valve.EDotaUserMessages_DOTA_UM_FoundNeutralItem):
		if s.Hooks.NeutralFound == nil {
			return nil
		}
		m := &valve.CDOTAUserMsg_FoundNeutralItem{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		return s.Hooks.NeutralFound(m)
	case int32(valve.EDotaUserMessages_DOTA_UM_ChatMessage):
		if s.Hooks.ChatMessage == nil {
			return nil
		}
		m := &valve.CDOTAUserMsg_ChatMessage{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		return s.Hooks.ChatMessage(m)
	}
	if s.Hooks.UserMessage != nil && kind >= 464 && kind <= 636 {
		return s.Hooks.UserMessage(kind, buf)
	}
	return nil
}
