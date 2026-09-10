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
	"dota2-collector/parser/internal/replay"
	"dota2-collector/parser/internal/valve"
	"dota2-collector/parser/internal/version"
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
	accountID  uint32
	name       string
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
	kind    string
	slot    int8
	x, y, z float32
	alive   bool
}

type Session struct {
	job    Job
	runID  uint64
	parser *replay.Session

	out  *model.Result
	sink Sink

	tickInterval float32
	gameStart    float32
	gameTime     float32
	nextInterval float32
	intervalInit bool
	serverTick   uint32
	gameState    int32

	playerResource *replay.Entity
	gamerules      *replay.Entity
	radiantData    *replay.Entity
	direData       *replay.Entity
	players        [24]*player
	playerCount    int
	playersReady   bool
	nameToSlot     map[string]int8
	heroKeyToSlot  map[string]int8
	idToSlot       map[int]int8
	accounts       [10]uint32

	draftSeen   [48]int32
	draftOrd    uint16
	abilitySeen map[string]uint8

	wards map[int32]*wardWatch

	cosmetics map[uint64]struct{}
	lastItems [10][21]uint64

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
	return ParseReaderWithSink(ctx, job, r, nil)
}

// ParseReaderWithSink is ParseReader plus mid-decode ClickHouse flushes.
func ParseReaderWithSink(ctx context.Context, job Job, r io.Reader, sink Sink) (*model.Result, error) {
	stream, err := wrapDemo(r)
	if err != nil {
		return nil, err
	}
	return parseStream(ctx, job, stream, sink)
}

// ParseFile opens path (.dem / .dem.bz2 / .dem.zst) and parses it.
func ParseFile(ctx context.Context, job Job, path string) (*model.Result, error) {
	r, closer, err := OpenDemo(path)
	if err != nil {
		return nil, err
	}
	defer closer.Close()
	return parseStream(ctx, job, r, nil)
}

func parseStream(ctx context.Context, job Job, r io.Reader, sink Sink) (*model.Result, error) {
	if job.StartTime.IsZero() {
		job.StartTime = time.Unix(0, 0).UTC()
	}
	p, err := replay.New(r)
	if err != nil {
		return nil, fmt.Errorf("demo: %w", err)
	}
	combatCap, intervalCap, actionCap := 80_000, 20_000, 40_000
	if sink != nil {
		combatCap, intervalCap, actionCap = flushBatch, flushBatch, flushBatch
	}
	s := &Session{
		job:           job,
		runID:         newRunID(),
		parser:        p,
		sink:          sink,
		tickInterval:  1.0 / 30.0,
		nameToSlot:    make(map[string]int8, 32),
		heroKeyToSlot: make(map[string]int8, 16),
		idToSlot:      make(map[int]int8, 24),
		abilitySeen:   make(map[string]uint8, 128),
		wards:         make(map[int32]*wardWatch, 64),
		cosmetics:     make(map[uint64]struct{}, 64),
		laneUntil:     600,
		out: &model.Result{
			MatchID:       job.MatchID,
			StartTime:     job.StartTime,
			ParseRunID:    0,
			ParserVersion: version.Schema,
			CombatLog:     make([]model.CombatLog, 0, combatCap),
			Intervals:     make([]model.Interval, 0, intervalCap),
			Actions:       make([]model.Action, 0, actionCap),
			Pings:         make([]model.Ping, 0, 2_000),
			Wards:         make([]model.Ward, 0, 128),
			Chat:          make([]model.Chat, 0, 256),
			Announcements: make([]model.Announcement, 0, 128),
			Draft:         make([]model.Draft, 0, 24),
			AbilityLevels: make([]model.AbilityLevel, 0, 200),
			Inventory:     make([]model.Inventory, 0, 80),
			Neutrals:      make([]model.Neutral, 0, 64),
			Cosmetics:     make([]model.Cosmetic, 0, 64),
			Alerts:        make([]model.Alert, 0, 256),
			Epilogue:      make([]model.Epilogue, 0, 16),
			Objectives:    make([]model.Objective, 0, 32),
		},
	}
	s.out.ParseRunID = s.runID
	s.wire()
	if err := p.Start(); err != nil {
		if ctx.Err() != nil {
			return s.out, ctx.Err()
		}
		return s.out, fmt.Errorf("parse match %d build %d: %w", job.MatchID, p.GameBuild, err)
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
		AccountID:     s.accountForSlot(slot),
		ParserVersion: version.Schema,
		ParseRunID:    s.runID,
	}
}

func (s *Session) accountForSlot(slot int8) uint32 {
	if slot < 0 || int(slot) >= len(s.accounts) {
		return 0
	}
	return s.accounts[slot]
}

func (s *Session) clock() int32 {
	return int32(s.gameTime)
}

func (s *Session) wire() {
	s.parser.Hooks.ServerInfo = func(m *valve.CSVCMsg_ServerInfo) error {
		if m.GetTickInterval() > 0 {
			s.tickInterval = m.GetTickInterval()
		}
		return nil
	}
	s.parser.Hooks.Tick = func(m *valve.CNETMsg_Tick) error {
		s.serverTick = m.GetTick()
		return nil
	}
	s.parser.OnEntity(s.onEntity)
	s.parser.Hooks.PacketEntities = func(_ *valve.CSVCMsg_PacketEntities) error {
		return s.tickWorld()
	}
	s.parser.Hooks.CombatLog = s.onCombat
	s.parser.Hooks.UnitOrders = s.onOrder
	s.parser.Hooks.LocationPing = s.onLocationPing
	s.parser.Hooks.Minimap = s.onMinimap
	s.parser.Hooks.ChatEvent = s.onChatEvent
	s.parser.Hooks.ChatMessage = s.onChatMessage
	s.parser.Hooks.ChatWheel = s.onChatWheel
	s.parser.Hooks.SayText2 = s.onSayText2
	s.parser.Hooks.GamerulesState = func(m *valve.CDOTAUserMsg_GamerulesStateChanged) error {
		s.gameState = int32(m.GetState())
		return nil
	}
	s.parser.Hooks.NeutralFound = s.onNeutralFound
	s.parser.Hooks.FileInfo = s.onFileInfo
	s.parser.Hooks.Metadata = s.onMetadata
	s.parser.Hooks.UserMessage = s.onUserMessage
}

func (s *Session) onEntity(e *replay.Entity, op replay.Op) error {
	if e == nil || e.Discarded() {
		return nil
	}
	class := e.GetClassName()
	switch {
	case class == "CDOTA_PlayerResource":
		if op.Has(replay.OpDeleted) {
			if s.playerResource == e {
				s.playerResource = nil
			}
			return nil
		}
		s.playerResource = e
	case class == "CDOTAGamerulesProxy" || class == "CDOTA_GamerulesProxy":
		if !op.Has(replay.OpDeleted) {
			s.gamerules = e
		}
	case class == "CDOTA_DataRadiant":
		if !op.Has(replay.OpDeleted) {
			s.radiantData = e
		}
	case class == "CDOTA_DataDire":
		if !op.Has(replay.OpDeleted) {
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

func (s *Session) tickWorld() error {
	s.updateClock()
	s.discoverPlayers()
	s.pollDraft()
	if s.playersReady && s.intervalInit && s.gameTime+0.001 >= s.nextInterval {
		if err := s.emitIntervals(); err != nil {
			return err
		}
		s.nextInterval += intervalSeconds
	}
	return nil
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
	if s.playerResource == nil {
		return
	}
	if !s.playersReady {
		s.tryBindPlayers()
	}
	s.refreshPlayerIds()
}

func (s *Session) tryBindPlayers() {
	type cand struct {
		index    int
		team     int32
		teamSlot int32
		steam    uint64
		name     string
	}
	var found []cand
	for i := 0; i < 24; i++ {
		team := getInt(s.playerResource, vecPath("m_vecPlayerData", i, "m_iPlayerTeam"))
		if team == 14 {
			return
		}
		if team != 2 && team != 3 {
			continue
		}
		teamSlot := getInt(s.playerResource, vecPath("m_vecPlayerTeamData", i, "m_iTeamSlot"))
		found = append(found, cand{
			index:    i,
			team:     team,
			teamSlot: teamSlot,
			steam:    getUint64(s.playerResource, vecPath("m_vecPlayerData", i, "m_iPlayerSteamID")),
			name: getString(
				s.playerResource,
				vecPath("m_vecPlayerData", i, "m_iszPlayerName"),
				vecPath("m_vecPlayerData", i, "m_iszPlayerNameInternal"),
			),
		})
	}
	var rad, dire []cand
	for _, c := range found {
		if c.team == 2 {
			rad = append(rad, c)
		} else {
			dire = append(dire, c)
		}
	}
	if len(rad) < 5 || len(dire) < 5 {
		return
	}
	rad = rad[:5]
	dire = dire[:5]
	type bound struct {
		cand
		slot  int8
		valve int32
	}
	out := make([]bound, 0, 10)
	var seen [10]bool
	unique := true
	for _, c := range append(append([]cand{}, rad...), dire...) {
		slot, _, ok := replaySlot(c.team, c.teamSlot)
		if !ok || seen[slot] {
			unique = false
			break
		}
		seen[slot] = true
	}
	push := func(c cand, fallback int8, fallbackValve int32) {
		slot, valve := fallback, fallbackValve
		if unique {
			if s, v, ok := replaySlot(c.team, c.teamSlot); ok {
				slot, valve = s, v
			}
		}
		out = append(out, bound{cand: c, slot: slot, valve: valve})
	}
	for i, c := range rad {
		push(c, int8(i), int32(i))
	}
	for i, c := range dire {
		push(c, int8(5+i), 128+int32(i))
	}
	for _, c := range out {
		pl := &player{
			index:     c.index,
			team:      c.team,
			teamSlot:  c.teamSlot,
			slot:      c.slot,
			valveSlot: c.valve,
			steamID:   c.steam,
			accountID: AccountFromSteam(c.steam),
			name:      c.name,
		}
		s.players[c.slot] = pl
		s.idToSlot[c.index] = c.slot
		if c.name != "" {
			s.nameToSlot[c.name] = c.slot
		}
		if pl.accountID != 0 {
			s.accounts[c.slot] = pl.accountID
		}
	}
	s.playerCount = 10
	s.playersReady = true
}

func (s *Session) refreshPlayerIds() {
	if !s.playersReady || s.playerResource == nil {
		return
	}
	for i := 0; i < s.playerCount; i++ {
		pl := s.players[i]
		if pl == nil {
			continue
		}
		steam := getUint64(s.playerResource, vecPath("m_vecPlayerData", pl.index, "m_iPlayerSteamID"))
		if steam != 0 {
			pl.steamID = steam
			pl.accountID = AccountFromSteam(steam)
			s.accounts[pl.slot] = pl.accountID
		}
		if pl.name == "" {
			name := getString(s.playerResource, vecPath("m_vecPlayerData", pl.index, "m_iszPlayerName"))
			if name != "" {
				pl.name = name
				s.nameToSlot[name] = pl.slot
			}
		}
	}
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
	key := heroKey(name)
	if key == "" {
		return -1
	}
	if slot, ok := s.heroKeyToSlot[key]; ok {
		return slot
	}
	for _, pl := range s.players[:s.playerCount] {
		if pl == nil {
			continue
		}
		if pl.heroNPC != "" && heroKey(pl.heroNPC) == key {
			return pl.slot
		}
		if pl.heroClass != "" && heroKey(pl.heroClass) == key {
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
	if id <= 9 && s.playersReady {
		if pl := s.players[id]; pl != nil {
			return pl.slot
		}
	}
	return -1
}

func (s *Session) slotForAccount(acc uint32) int8 {
	if acc == 0 {
		return -1
	}
	for i := 0; i < s.playerCount; i++ {
		if pl := s.players[i]; pl != nil && pl.accountID == acc {
			return pl.slot
		}
	}
	return -1
}

func (s *Session) rememberHero(pl *player) {
	if pl == nil {
		return
	}
	if pl.heroClass != "" {
		if key := heroKey(pl.heroClass); key != "" {
			s.heroKeyToSlot[key] = pl.slot
			s.nameToSlot[pl.heroClass] = pl.slot
		}
	}
	if pl.heroNPC != "" {
		if key := heroKey(pl.heroNPC); key != "" {
			s.heroKeyToSlot[key] = pl.slot
			s.nameToSlot[pl.heroNPC] = pl.slot
		}
	}
}

func (s *Session) dataTeam(team int32) *replay.Entity {
	if team == 2 {
		return s.radiantData
	}
	if team == 3 {
		return s.direData
	}
	return nil
}

func (s *Session) onFileInfo(m *valve.CDemoFileInfo) error {
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

func (s *Session) onMetadata(m *valve.CDOTAMatchMetadataFile) error {
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

func (s *Session) mergeFileInfoDraft(picks []*valve.CGameInfo_CDotaGameInfo_CHeroSelectEvent) {
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
