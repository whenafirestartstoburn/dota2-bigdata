package parse

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"

	"dota2-collector/parser/internal/model"
	"dota2-collector/parser/internal/version"

	"github.com/dotabuff/manta"
	"github.com/dotabuff/manta/dota"
)

const intervalSeconds = 1

// Job is enough match metadata to stamp ClickHouse partitions.
type Job struct {
	MatchID   uint64
	StartTime time.Time
}

type player struct {
	index      int
	team       int32
	teamSlot   int32
	slot       int8  // 0-9 for ClickHouse Int8
	valveSlot  int32 // 0-4 radiant / 128-132 dire
	steamID    uint64
	heroID     int32
	heroClass  string
	heroNPC    string
	handle     uint64
	variant    int16
	facetHero  int32
	laneVotes  [5]int // mid, radiant-safe, radiant-off, dire-safe, dire-off — we collapse later
	posSamples [][2]float32
}

type wardWatch struct {
	kind   string
	slot   int8
	x, y, z float32
	alive  bool
}

type Session struct {
	job    Job
	runID  uint64
	parser *manta.Parser

	out *model.Result

	tickInterval float32
	gameStart    float32
	gameTime     float32
	nextInterval float32
	intervalInit bool
	serverTick   uint32
	gameState    int32

	playerResource *manta.Entity
	gamerules      *manta.Entity
	radiantData    *manta.Entity
	direData       *manta.Entity
	players        [24]*player
	playerCount    int
	playersReady   bool
	nameToSlot     map[string]int8
	idToSlot       map[int]int8

	draftSeen   [48]int32
	draftOrd    uint16
	abilitySeen map[string]uint8
	startItems  [10]bool

	wards map[int32]*wardWatch

	cosmetics map[uint64]struct{}

	laneUntil int32
}

func newRunID() uint64 {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return uint64(time.Now().UnixNano())
	}
	id := binary.LittleEndian.Uint64(b[:])
	if id == 0 {
		return 1
	}
	return id
}

// ParseReader consumes a (possibly compressed) demo stream.
func ParseReader(ctx context.Context, job Job, r io.Reader) (*model.Result, error) {
	stream, err := wrapDemo(r)
	if err != nil {
		return nil, err
	}
	return parseStream(ctx, job, stream)
}

// ParseFile opens path (.dem / .dem.bz2 / .dem.zst) and parses it.
func ParseFile(ctx context.Context, job Job, path string) (*model.Result, error) {
	r, closer, err := OpenDemo(path)
	if err != nil {
		return nil, err
	}
	defer closer.Close()
	return parseStream(ctx, job, r)
}

func parseStream(ctx context.Context, job Job, r io.Reader) (*model.Result, error) {
	if job.StartTime.IsZero() {
		job.StartTime = time.Unix(0, 0).UTC()
	}
	p, err := manta.NewStreamParser(r)
	if err != nil {
		return nil, fmt.Errorf("manta: %w", err)
	}
	s := &Session{
		job:         job,
		runID:       newRunID(),
		parser:      p,
		tickInterval: 1.0 / 30.0,
		nameToSlot:  make(map[string]int8, 32),
		idToSlot:    make(map[int]int8, 24),
		abilitySeen: make(map[string]uint8, 128),
		wards:       make(map[int32]*wardWatch, 64),
		cosmetics:   make(map[uint64]struct{}, 64),
		laneUntil:   600,
		out: &model.Result{
			MatchID:       job.MatchID,
			StartTime:     job.StartTime,
			ParseRunID:    0,
			ParserVersion: version.Schema,
			CombatLog:     make([]model.CombatLog, 0, 80_000),
			Intervals:     make([]model.Interval, 0, 20_000),
			Actions:       make([]model.Action, 0, 40_000),
			Pings:         make([]model.Ping, 0, 2_000),
			Wards:         make([]model.Ward, 0, 128),
			Chat:          make([]model.Chat, 0, 256),
			Announcements: make([]model.Announcement, 0, 128),
			Draft:         make([]model.Draft, 0, 24),
			AbilityLevels: make([]model.AbilityLevel, 0, 200),
			Inventory:     make([]model.Inventory, 0, 80),
			Neutrals:      make([]model.Neutral, 0, 64),
			Cosmetics:     make([]model.Cosmetic, 0, 64),
			Epilogue:      make([]model.Epilogue, 0, 16),
			Objectives:    make([]model.Objective, 0, 32),
		},
	}
	s.out.ParseRunID = s.runID
	s.wire()
	if err := p.Start(); err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("parse match %d: %w", job.MatchID, err)
	}
	s.finishSummaries()
	return s.out, nil
}

func (s *Session) header(clock int32, slot int8) model.Header {
	return model.Header{
		MatchID:       s.job.MatchID,
		StartTime:     s.job.StartTime,
		Time:          clock,
		Tick:          uint32(s.parser.Tick),
		Slot:          slot,
		ParserVersion: version.Schema,
		ParseRunID:    s.runID,
	}
}

func (s *Session) clock() int32 {
	return int32(s.gameTime)
}

func (s *Session) wire() {
	s.parser.Callbacks.OnCSVCMsg_ServerInfo(func(m *dota.CSVCMsg_ServerInfo) error {
		if m.GetTickInterval() > 0 {
			s.tickInterval = m.GetTickInterval()
		}
		return nil
	})
	s.parser.Callbacks.OnCNETMsg_Tick(func(m *dota.CNETMsg_Tick) error {
		s.serverTick = m.GetTick()
		return nil
	})
	s.parser.OnEntity(s.onEntity)
	s.parser.Callbacks.OnCSVCMsg_PacketEntities(func(_ *dota.CSVCMsg_PacketEntities) error {
		s.tickWorld()
		return nil
	})
	s.parser.Callbacks.OnCMsgDOTACombatLogEntry(s.onCombat)
	s.parser.Callbacks.OnCDOTAUserMsg_SpectatorPlayerUnitOrders(s.onOrder)
	s.parser.Callbacks.OnCDOTAUserMsg_LocationPing(s.onLocationPing)
	s.parser.Callbacks.OnCDOTAUserMsg_MinimapEvent(s.onMinimap)
	s.parser.Callbacks.OnCDOTAUserMsg_ChatEvent(s.onChatEvent)
	s.parser.Callbacks.OnCDOTAUserMsg_ChatMessage(s.onChatMessage)
	s.parser.Callbacks.OnCDOTAUserMsg_ChatWheel(s.onChatWheel)
	s.parser.Callbacks.OnCUserMessageSayText2(s.onSayText2)
	s.parser.Callbacks.OnCDOTAUserMsg_GamerulesStateChanged(func(m *dota.CDOTAUserMsg_GamerulesStateChanged) error {
		s.gameState = int32(m.GetState())
		return nil
	})
	s.parser.Callbacks.OnCDOTAUserMsg_FoundNeutralItem(s.onNeutralFound)
	s.parser.Callbacks.OnCDemoFileInfo(s.onFileInfo)
	s.parser.Callbacks.OnCDOTAMatchMetadataFile(s.onMetadata)
}

func (s *Session) onEntity(e *manta.Entity, op manta.EntityOp) error {
	if e == nil {
		return nil
	}
	class := e.GetClassName()
	switch {
	case class == "CDOTA_PlayerResource":
		if op.Flag(manta.EntityOpDeleted) {
			if s.playerResource == e {
				s.playerResource = nil
			}
			return nil
		}
		s.playerResource = e
	case class == "CDOTAGamerulesProxy" || class == "CDOTA_GamerulesProxy":
		if !op.Flag(manta.EntityOpDeleted) {
			s.gamerules = e
		}
	case class == "CDOTA_DataRadiant":
		if !op.Flag(manta.EntityOpDeleted) {
			s.radiantData = e
		}
	case class == "CDOTA_DataDire":
		if !op.Flag(manta.EntityOpDeleted) {
			s.direData = e
		}
	case strings.Contains(class, "Observer_Ward") || strings.HasSuffix(class, "_ObserverWard") ||
		strings.Contains(class, "SentryWard") || strings.Contains(class, "Sentry_Ward"):
		s.trackWard(e, op, class)
	case class == "CDOTAWearableItem":
		s.trackCosmetic(e)
	case strings.HasPrefix(class, "CDOTA_Item_"):
		s.trackNeutralItem(e, op)
	}
	return nil
}

func (s *Session) tickWorld() {
	s.updateClock()
	s.discoverPlayers()
	s.pollDraft()
	if s.playersReady && s.intervalInit && s.gameTime+0.001 >= s.nextInterval {
		s.emitIntervals()
		s.nextInterval += intervalSeconds
	}
}

func (s *Session) updateClock() {
	grp := s.gamerules
	if grp == nil {
		return
	}
	if old := rulesFloat(grp, "m_fGameTime"); old != 0 {
		s.gameTime = old
		if s.gameStart == 0 {
			if start := rulesFloat(grp, "m_flGameStartTime"); start != 0 {
				s.gameStart = start
			}
		}
		if s.gameStart != 0 {
			s.gameTime = old - s.gameStart
		}
	} else {
		paused := rulesBool(grp, "m_bGamePaused")
		tick := s.serverTick
		if paused {
			if p := rulesUint(grp, "m_nPauseStartTick"); p > 0 {
				tick = p
			}
		}
		pausedTicks := rulesUint(grp, "m_nTotalPausedTicks")
		interval := s.tickInterval
		if interval <= 0 {
			interval = 1.0 / 30.0
		}
		raw := float32(tick-pausedTicks) * interval
		if s.gameStart == 0 {
			if start := rulesFloat(grp, "m_flGameStartTime"); start != 0 {
				s.gameStart = start
			}
		}
		if s.gameStart != 0 {
			s.gameTime = raw - s.gameStart
		} else {
			s.gameTime = raw
		}
	}
	if st := rulesInt(grp, "m_nGameState"); st != 0 {
		s.gameState = st
	}
	if !s.intervalInit {
		s.nextInterval = s.gameTime
		s.intervalInit = true
	}
}

func (s *Session) discoverPlayers() {
	if s.playersReady || s.playerResource == nil {
		return
	}
	added := 0
	waiting := false
	for i := 0; i < 24 && added < 10; i++ {
		team := getInt(s.playerResource, vecPath("m_vecPlayerData", i, "m_iPlayerTeam"))
		if team == 14 {
			waiting = true
			break
		}
		if team != 2 && team != 3 {
			continue
		}
		teamSlot := getInt(s.playerResource, vecPath("m_vecPlayerTeamData", i, "m_iTeamSlot"))
		steam := getUint64(s.playerResource, vecPath("m_vecPlayerData", i, "m_iPlayerSteamID"))
		valve := int32(teamSlot)
		if team == 3 {
			valve = 128 + teamSlot
		}
		pl := &player{
			index:     i,
			team:      team,
			teamSlot:  teamSlot,
			slot:      int8(added),
			valveSlot: valve,
			steamID:   steam,
		}
		s.players[added] = pl
		s.idToSlot[i] = pl.slot
		added++
	}
	if waiting || added < 10 {
		return
	}
	s.playerCount = added
	s.playersReady = true
}

func (s *Session) playerByIndex(i int) *player {
	for _, pl := range s.players[:s.playerCount] {
		if pl != nil && pl.index == i {
			return pl
		}
	}
	return nil
}

func (s *Session) slotForName(name string) int8 {
	if name == "" {
		return -1
	}
	if slot, ok := s.nameToSlot[name]; ok {
		return slot
	}
	want := heroSuffixFromNPC(name)
	if want == "" {
		return -1
	}
	for _, pl := range s.players[:s.playerCount] {
		if pl == nil {
			continue
		}
		if pl.heroNPC != "" && heroSuffixFromNPC(pl.heroNPC) == want {
			return pl.slot
		}
		if pl.heroClass != "" && heroSuffixFromClass(pl.heroClass) == want {
			return pl.slot
		}
	}
	return -1
}

func (s *Session) slotForPlayerID(id int32) int8 {
	if id < 0 {
		return -1
	}
	if slot, ok := s.idToSlot[int(id)]; ok {
		return slot
	}
	if int(id) < s.playerCount {
		if pl := s.players[id]; pl != nil {
			return pl.slot
		}
	}
	// fallback: 0-4 radiant, 5-9 dire
	if id <= 9 {
		return int8(id)
	}
	return -1
}

func (s *Session) dataTeam(team int32) *manta.Entity {
	if team == 2 {
		return s.radiantData
	}
	if team == 3 {
		return s.direData
	}
	return nil
}

func (s *Session) onFileInfo(m *dota.CDemoFileInfo) error {
	if m == nil {
		return nil
	}
	s.addEpilogue("playback_time", fmt.Sprintf("%g", m.GetPlaybackTime()))
	s.addEpilogue("playback_ticks", fmt.Sprintf("%d", m.GetPlaybackTicks()))
	s.addEpilogue("playback_frames", fmt.Sprintf("%d", m.GetPlaybackFrames()))
	if gi := m.GetGameInfo(); gi != nil && gi.GetDota() != nil {
		d := gi.GetDota()
		s.addEpilogue("match_id", fmt.Sprintf("%d", d.GetMatchId()))
		s.addEpilogue("game_winner", fmt.Sprintf("%d", d.GetGameWinner()))
		s.addEpilogue("radiant_team_id", fmt.Sprintf("%d", d.GetRadiantTeamId()))
		s.addEpilogue("dire_team_id", fmt.Sprintf("%d", d.GetDireTeamId()))
		if s.job.MatchID == 0 && d.GetMatchId() != 0 {
			s.job.MatchID = d.GetMatchId()
			s.out.MatchID = d.GetMatchId()
		}
		if raw, err := json.Marshal(d.GetPlayerInfo()); err == nil {
			s.addEpilogue("player_info", string(raw))
		}
		if raw, err := json.Marshal(d.GetPicksBans()); err == nil && len(d.GetPicksBans()) > 0 {
			s.addEpilogue("picks_bans", string(raw))
			s.mergeFileInfoDraft(d.GetPicksBans())
		}
	}
	return nil
}

func (s *Session) onMetadata(m *dota.CDOTAMatchMetadataFile) error {
	if m == nil {
		return nil
	}
	s.addEpilogue("metadata_version", fmt.Sprintf("%d", m.GetVersion()))
	if raw, err := json.Marshal(m.GetMetadata()); err == nil {
		s.addEpilogue("match_metadata", string(raw))
	}
	return nil
}

func (s *Session) addEpilogue(key, value string) {
	s.out.Epilogue = append(s.out.Epilogue, model.Epilogue{
		Header: s.header(s.clock(), -1),
		Key:    key,
		Value:  value,
	})
}

func (s *Session) mergeFileInfoDraft(picks []*dota.CGameInfo_CDotaGameInfo_CHeroSelectEvent) {
	if len(s.out.Draft) > 0 || len(picks) == 0 {
		return
	}
	for i, pb := range picks {
		if pb == nil {
			continue
		}
		team := uint8(0)
		if pb.GetTeam() == 3 || pb.GetTeam() == 1 {
			team = 1
		}
		s.out.Draft = append(s.out.Draft, model.Draft{
			Header: s.header(s.clock(), -1),
			IsPick: boolU8(pb.GetIsPick()),
			HeroID: int32(pb.GetHeroId()),
			Team:   team,
			Ord:    uint16(i),
			Clock:  s.clock(),
		})
	}
}
