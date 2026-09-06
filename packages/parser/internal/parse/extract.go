package parse

import (
	"strings"

	"dota2-collector/parser/internal/model"
	"dota2-collector/parser/internal/replay"
	"dota2-collector/parser/internal/valve"
)

func stripPrefix(s, prefix string) string {
	if strings.HasPrefix(s, prefix) {
		return s[len(prefix):]
	}
	return s
}

func (s *Session) onCombat(m *valve.CMsgDOTACombatLogEntry) error {
	typ := stripPrefix(m.GetType().String(), "DOTA_COMBATLOG_")
	if typ == "" || typ == "INVALID" {
		typ = m.GetType().String()
	}
	attacker := lookupCL(s.parser, m.GetAttackerName())
	target := lookupCL(s.parser, m.GetTargetName())
	inflictor := lookupCL(s.parser, m.GetInflictorName())
	source := lookupCL(s.parser, m.GetDamageSourceName())
	targetSource := lookupCL(s.parser, m.GetTargetSourceName())
	valueName := ""
	switch typ {
	case "PURCHASE", "ITEM", "BUYBACK":
		valueName = inflictor
		if valueName == "" {
			valueName = lookupCL(s.parser, uint32(m.GetValue()))
		}
	case "MODIFIER_ADD", "MODIFIER_REMOVE":
		valueName = inflictor
	case "GOLD", "XP":
		// amount is Value
	}
	if typ == "GAME_STATE" && m.GetValue() == 5 && s.gameStart == 0 {
		s.gameStart = m.GetTimestamp()
	}
	clock := int32(m.GetTimestamp())
	if s.gameStart != 0 && m.GetTimestamp() > 1000 {
		// some patches stamp absolute game time
		clock = int32(m.GetTimestamp() - s.gameStart)
	}
	attackerSlot := s.slotForName(attacker)
	targetSlot := s.slotForName(target)
	slot := attackerSlot
	if slot < 0 {
		slot = targetSlot
	}
	assist := m.GetAssistPlayers()
	row := model.CombatLog{
		Header:                   s.header(clock, slot),
		Type:                     typ,
		Attacker:                 attacker,
		Target:                   target,
		Inflictor:                inflictor,
		AttackerSlot:             attackerSlot,
		TargetSlot:               targetSlot,
		Value:                    int32(m.GetValue()),
		ValueName:                valueName,
		GoldReason:               uint16(m.GetGoldReason()),
		XpReason:                 uint16(m.GetXpReason()),
		AttackerHero:             boolU8(m.GetIsAttackerHero()),
		TargetHero:               boolU8(m.GetIsTargetHero()),
		AttackerIllusion:         boolU8(m.GetIsAttackerIllusion()),
		TargetIllusion:           boolU8(m.GetIsTargetIllusion()),
		StunDuration:             m.GetStunDuration(),
		SlowDuration:             m.GetSlowDuration(),
		Sourcename:               source,
		Targetsourcename:         targetSource,
		Health:                   m.GetHealth(),
		AbilityLevel:             uint8(m.GetAbilityLevel()),
		LocationX:                m.GetLocationX(),
		LocationY:                m.GetLocationY(),
		ModifierDuration:         m.GetModifierDuration(),
		LastHits:                 uint32(m.GetLastHits()),
		AttackerTeam:             uint8(m.GetAttackerTeam()),
		TargetTeam:               uint8(m.GetTargetTeam()),
		StackCount:               uint16(m.GetStackCount()),
		IsTargetBuilding:         boolU8(m.GetIsTargetBuilding()),
		RuneType:                 uint16(m.GetRuneType()),
		Networth:                 uint32(m.GetNetworth()),
		VisibleRadiant:           boolU8(m.GetIsVisibleRadiant()),
		VisibleDire:              boolU8(m.GetIsVisibleDire()),
		IsAbilityToggleOn:        boolU8(m.GetIsAbilityToggleOn()),
		IsAbilityToggleOff:       boolU8(m.GetIsAbilityToggleOff()),
		TimestampRaw:             m.GetTimestamp(),
		ObsWardsPlaced:           uint16(m.GetObsWardsPlaced()),
		AssistPlayers:            assist,
		HiddenModifier:           boolU8(m.GetHiddenModifier()),
		NeutralCampType:          uint16(m.GetNeutralCampType()),
		IsHealSave:               boolU8(m.GetIsHealSave()),
		IsUltimateAbility:        boolU8(m.GetIsUltimateAbility()),
		AttackerHeroLevel:        uint16(m.GetAttackerHeroLevel()),
		TargetHeroLevel:          uint16(m.GetTargetHeroLevel()),
		Xpm:                      uint32(m.GetXpm()),
		Gpm:                      uint32(m.GetGpm()),
		EventLocation:            uint16(m.GetEventLocation()),
		TargetIsSelf:             boolU8(m.GetTargetIsSelf()),
		DamageType:               uint16(m.GetDamageType()),
		InvisibilityModifier:     boolU8(m.GetInvisibilityModifier()),
		DamageCategory:           uint16(m.GetDamageCategory()),
		BuildingType:             uint16(m.GetBuildingType()),
		ModifierElapsedDuration:  m.GetModifierElapsedDuration(),
		SilenceModifier:          boolU8(m.GetSilenceModifier()),
		HealFromLifesteal:        boolU8(m.GetHealFromLifesteal()),
		ModifierPurged:           boolU8(m.GetModifierPurged()),
		SpellEvaded:              boolU8(m.GetSpellEvaded()),
		MotionControllerModifier: boolU8(m.GetMotionControllerModifier()),
		LongRangeKill:            boolU8(m.GetLongRangeKill()),
		ModifierPurgeAbility:     m.GetModifierPurgeAbility(),
		ModifierPurgeNpc:         m.GetModifierPurgeNpc(),
		RootModifier:             boolU8(m.GetRootModifier()),
		TotalUnitDeathCount:      m.GetTotalUnitDeathCount(),
		AuraModifier:             boolU8(m.GetAuraModifier()),
		ArmorDebuffModifier:      boolU8(m.GetArmorDebuffModifier()),
		NoPhysicalDamageModifier: boolU8(m.GetNoPhysicalDamageModifier()),
		ModifierAbility:          m.GetModifierAbility(),
		ModifierHidden:           boolU8(m.GetModifierHidden()),
		InflictorIsStolenAbility: boolU8(m.GetInflictorIsStolenAbility()),
		KillEaterEvent:           m.GetKillEaterEvent(),
		UnitStatusLabel:          m.GetUnitStatusLabel(),
		SpellGeneratedAttack:     boolU8(m.GetSpellGeneratedAttack()),
		AtNightTime:              boolU8(m.GetAtNightTime()),
		AttackerHasScepter:       boolU8(m.GetAttackerHasScepter()),
		NeutralCampTeam:          uint16(m.GetNeutralCampTeam()),
		RegeneratedHealth:        m.GetRegeneratedHealth(),
		WillReincarnate:          boolU8(m.GetWillReincarnate()),
		UsesCharges:              boolU8(m.GetUsesCharges()),
		TrackedStatID:            m.GetTrackedStatId(),
		ModifierPurgedDuration:   m.GetModifierPurgedDuration(),
		HealFromRegen:            boolU8(m.GetHealFromRegen()),
	}
	if len(assist) > 0 {
		row.AssistPlayer0 = uint32(assist[0])
	}
	if len(assist) > 1 {
		row.AssistPlayer1 = uint32(assist[1])
	}
	if len(assist) > 2 {
		row.AssistPlayer2 = uint32(assist[2])
	}
	if len(assist) > 3 {
		row.AssistPlayer3 = uint32(assist[3])
	}
	s.out.CombatLog = append(s.out.CombatLog, row)

	if typ == "PURCHASE" && clock <= 90 && valueName != "" {
		s.out.Inventory = append(s.out.Inventory, model.Inventory{
			Header:   s.header(clock, slot),
			ItemID:   valueName,
			ItemSlot: -1,
		})
	}
	if typ == "PURCHASE" && (strings.Contains(valueName, "item_tier") ||
		strings.Contains(inflictor, "neutral")) {
		s.out.Neutrals = append(s.out.Neutrals, model.Neutral{
			Header: s.header(clock, slot),
			Kind:   "purchase",
			Key:    valueName,
			Value:  int32(m.GetValue()),
		})
	}
	if typ == "DEATH" && (strings.Contains(target, "roshan") || strings.Contains(target, "fort") ||
		strings.Contains(target, "tower") || strings.Contains(target, "rax") || strings.Contains(target, "barracks")) {
		s.noteObjectiveFromCombat(typ, target, clock, targetSlot)
	}
	if typ == "FIRST_BLOOD" {
		s.addObjective(clock, "first_blood", nil, slotPtr(targetSlot), "", intPtr(int32(m.GetValue())))
	}
	if typ == "BUYBACK" {
		s.addObjective(clock, "buyback", teamPtr(slot), slotPtr(slot), "", nil)
	}
	return nil
}

func (s *Session) emitIntervals() {
	pr := s.playerResource
	if pr == nil {
		return
	}
	clock := s.clock()
	for i := 0; i < s.playerCount; i++ {
		pl := s.players[i]
		if pl == nil {
			continue
		}
		idx := pl.index
		heroRaw := getUint(pr, vecPath("m_vecPlayerTeamData", idx, "m_nSelectedHeroID"))
		heroID := unzigzag32(heroRaw)
		if heroID == 0 {
			heroID = int32(heroRaw)
		}
		handle := getUint64(pr, vecPath("m_vecPlayerTeamData", idx, "m_hSelectedHero"))
		pl.handle = handle
		pl.heroID = heroID
		variant := int16(getInt(pr, vecPath("m_vecPlayerTeamData", idx, "m_nSelectedHeroVariant")))
		data := s.dataTeam(pl.team)
		ts := int(pl.teamSlot)
		row := model.Interval{
			Header:                 s.header(clock, pl.slot),
			HeroID:                 heroID,
			Variant:                variant,
			Repicked:               boolU8(getBool(pr, vecPath("m_vecPlayerTeamData", idx, "m_bHasRepicked"))),
			Randomed:               boolU8(getBool(pr, vecPath("m_vecPlayerTeamData", idx, "m_bHasRandomed"))),
			PredVict:               boolU8(getBool(pr, vecPath("m_vecPlayerTeamData", idx, "m_bHasPredictedVictory"))),
			FirstbloodClaimed:      uint8(getInt(pr, vecPath("m_vecPlayerTeamData", idx, "m_iFirstBloodClaimed"))),
			TeamfightParticipation: getFloat(pr, vecPath("m_vecPlayerTeamData", idx, "m_flTeamFightParticipation")),
			Level:                  uint8(getInt(pr, vecPath("m_vecPlayerTeamData", idx, "m_iLevel"))),
			Kills:                  uint16(getInt(pr, vecPath("m_vecPlayerTeamData", idx, "m_iKills"))),
			Deaths:                 uint16(getInt(pr, vecPath("m_vecPlayerTeamData", idx, "m_iDeaths"))),
			Assists:                uint16(getInt(pr, vecPath("m_vecPlayerTeamData", idx, "m_iAssists"))),
			DraftStage:             uint8(s.gameState),
		}
		if data != nil && ts >= 0 {
			row.Denies = uint16(getInt(data, vecPath("m_vecDataTeam", ts, "m_iDenyCount")))
			row.ObsPlaced = uint16(getInt(data, vecPath("m_vecDataTeam", ts, "m_iObserverWardsPlaced")))
			row.SenPlaced = uint16(getInt(data, vecPath("m_vecDataTeam", ts, "m_iSentryWardsPlaced")))
			row.CreepsStacked = uint16(getInt(data, vecPath("m_vecDataTeam", ts, "m_iCreepsStacked")))
			row.CampsStacked = uint16(getInt(data, vecPath("m_vecDataTeam", ts, "m_iCampsStacked")))
			row.RunePickups = uint16(getInt(data, vecPath("m_vecDataTeam", ts, "m_iRunePickups")))
			row.TowersKilled = uint8(getInt(data, vecPath("m_vecDataTeam", ts, "m_iTowerKills")))
			row.RoshansKilled = uint8(getInt(data, vecPath("m_vecDataTeam", ts, "m_iRoshanKills")))
			row.ObserversPlaced = row.ObsPlaced
			row.Networth = uint32(getInt(data, vecPath("m_vecDataTeam", ts, "m_iNetWorth")))
			row.Gold = uint32(getInt(data, vecPath("m_vecDataTeam", ts, "m_iTotalEarnedGold")))
			row.LH = uint32(getInt(data, vecPath("m_vecDataTeam", ts, "m_iLastHitCount")))
			row.XP = uint32(getInt(data, vecPath("m_vecDataTeam", ts, "m_iTotalEarnedXP")))
			row.Stuns = getFloat(data, vecPath("m_vecDataTeam", ts, "m_fStuns"))
		}
		hero := s.parser.FindEntityByHandle(handle)
		if hero != nil {
			pl.heroClass = hero.GetClassName()
			if suf := heroSuffixFromClass(pl.heroClass); suf != "" {
				pl.heroNPC = "npc_dota_hero_" + suf
				s.nameToSlot["npc_dota_hero_"+suf] = pl.slot
				// also snake_case form
				s.nameToSlot[npcFromClass(pl.heroClass)] = pl.slot
			}
			row.Unit = hero.GetClassName()
			row.LifeState = uint8(getInt(hero, "m_lifeState"))
			if x, y, _, ok := entityPosition(hero); ok {
				row.X = x
				row.Y = y
				if clock >= 0 && clock <= s.laneUntil {
					pl.posSamples = append(pl.posSamples, [2]float32{x, y})
				}
			}
			if key := getUint64(hero, "m_iHeroFacetKey"); key != 0 {
				row.FacetHeroID = int32(key >> 32)
				row.Variant = int16(key & 0xFF)
				pl.facetHero = row.FacetHeroID
				pl.variant = row.Variant
			}
			row.HP = uint32(getInt(hero, "m_iHealth"))
			row.MaxHP = uint32(getInt(hero, "m_iMaxHealth"))
			row.Mana = uint32(getFloat(hero, "m_flMana"))
			row.MaxMana = uint32(getFloat(hero, "m_flMaxMana"))
			if raw := getFloat(hero, "m_flRespawnTime"); raw > s.gameTime+1 {
				row.Respawn = uint16(raw - s.gameTime)
			} else if raw > 0 && raw < 400 {
				row.Respawn = uint16(raw)
			}
			s.emitAbilities(hero, pl, clock)
			s.emitInventoryChanges(hero, pl, clock)
		}
		if row.Variant == 0 {
			row.Variant = variant
		}
		s.out.Intervals = append(s.out.Intervals, row)
	}
}

func npcFromClass(class string) string {
	suf := strings.TrimPrefix(class, "CDOTA_Unit_Hero_")
	var b strings.Builder
	b.WriteString("npc_dota_hero_")
	for i, r := range suf {
		if r >= 'A' && r <= 'Z' {
			if i > 0 {
				b.WriteByte('_')
			}
			b.WriteByte(byte(r - 'A' + 'a'))
			continue
		}
		if r == '_' {
			b.WriteByte('_')
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

func (s *Session) emitAbilities(hero *replay.Entity, pl *player, clock int32) {
	for i := 0; i < 24; i++ {
		h := getUint64(hero, "m_hAbilities."+pad4(i))
		if h == 0 {
			h = getUint64(hero, "m_vecAbilities."+pad4(i))
		}
		if h == 0 || h == 0xFFFFFFFFFFFFFFFF {
			continue
		}
		ent := s.parser.FindEntityByHandle(h)
		name := ""
		level := uint8(0)
		if ent != nil {
			cls := ent.GetClassName()
			if strings.Contains(cls, "Ability") || strings.HasPrefix(cls, "CDOTA_Item") {
				name = cls
				if n := lookupEntityName(s.parser, getUint(ent, "m_pEntity.m_nameStringableIndex")); n != "" {
					name = n
				}
				level = uint8(getInt(ent, "m_iLevel"))
			}
		}
		if name == "" || level == 0 {
			continue
		}
		key := fmtInt(int64(pl.slot)) + ":" + fmtInt(int64(i))
		if prev, ok := s.abilitySeen[key]; ok && level <= prev {
			continue
		}
		s.abilitySeen[key] = level
		s.out.AbilityLevels = append(s.out.AbilityLevels, model.AbilityLevel{
			Header:       s.header(clock, pl.slot),
			AbilityID:    name,
			AbilityLevel: level,
			Target:       pl.heroNPC,
		})
	}
}

func (s *Session) emitInventoryChanges(hero *replay.Entity, pl *player, clock int32) {
	idx := int(pl.slot)
	if idx < 0 || idx >= 10 {
		return
	}
	for i := 0; i < 21; i++ {
		h := getUint64(hero, "m_hItems."+pad4(i), "m_Inventory.m_hItems."+pad4(i))
		if h == 0xFFFFFFFFFFFFFFFF {
			h = 0
		}
		if h == s.lastItems[idx][i] {
			continue
		}
		s.lastItems[idx][i] = h
		name := ""
		var charges, secondary uint16
		if h != 0 {
			ent := s.parser.FindEntityByHandle(h)
			if ent != nil {
				name = ent.GetClassName()
				if n := lookupEntityName(s.parser, getUint(ent, "m_pEntity.m_nameStringableIndex")); n != "" {
					name = n
				}
				charges = uint16(getInt(ent, "m_iCurrentCharges", "m_iCharges"))
				secondary = uint16(getInt(ent, "m_iSecondaryCharges"))
			}
		}
		s.out.Inventory = append(s.out.Inventory, model.Inventory{
			Header:           s.header(clock, pl.slot),
			ItemID:           name,
			ItemSlot:         int8(i),
			Charges:          charges,
			SecondaryCharges: secondary,
		})
	}
}

func (s *Session) pollDraft() {
	grp := s.gamerules
	if grp == nil || s.gameState != 2 {
		return
	}
	type pickban struct {
		hero   int32
		isPick bool
	}
	var seen []pickban
	for i := 0; i < 24; i++ {
		hero := rulesInt(grp, "m_BannedHeroes."+pad4(i))
		if hero == 0 {
			hero = getInt(grp, rulesPath("m_BannedHeroes."+pad4(i))...)
		}
		if hero > 0 {
			seen = append(seen, pickban{hero: hero, isPick: false})
		}
	}
	for i := 0; i < 24; i++ {
		hero := rulesInt(grp, "m_SelectedHeroes."+pad4(i))
		if hero == 0 {
			hero = getInt(grp, rulesPath("m_SelectedHeroes."+pad4(i))...)
		}
		if hero > 0 {
			seen = append(seen, pickban{hero: hero, isPick: true})
		}
	}
	if len(seen) == 0 {
		// captain's mode draft arrays on newer patches
		for i := 0; i < 24; i++ {
			hero := rulesInt(grp, "m_vecDraftHeroes."+pad4(i))
			if hero > 0 {
				seen = append(seen, pickban{hero: unzigzag32(uint32(hero)), isPick: i >= 7})
			}
		}
	}
	for i, pb := range seen {
		if i >= len(s.draftSeen) {
			break
		}
		if s.draftSeen[i] == pb.hero {
			continue
		}
		if pb.hero == 0 {
			continue
		}
		s.draftSeen[i] = pb.hero
		team := uint8(0)
		if active := rulesInt(grp, "m_iActiveTeam"); active == 3 {
			team = 1
		}
		s.out.Draft = append(s.out.Draft, model.Draft{
			Header:           s.header(s.clock(), -1),
			IsPick:           boolU8(pb.isPick),
			HeroID:           pb.hero,
			Team:             team,
			Ord:              s.draftOrd,
			Clock:            s.clock(),
			ExtraTimeRadiant: int32(rulesFloat(grp, "m_fExtraTimeRemaining.0000")),
			ExtraTimeDire:    int32(rulesFloat(grp, "m_fExtraTimeRemaining.0001")),
		})
		s.draftOrd++
	}
}

func (s *Session) trackWard(e *replay.Entity, op replay.Op, class string) {
	kind := "obs"
	if strings.Contains(strings.ToLower(class), "sentry") {
		kind = "sen"
	}
	idx := e.GetIndex()
	x, y, z, _ := entityPosition(e)
	owner := handleIndex(getUint64(e, "m_hOwnerEntity", "m_hOwner"))
	slot := int8(-1)
	if owner >= 0 {
		if hero := s.parser.FindEntity(owner); hero != nil {
			slot = s.slotForName(npcFromClass(hero.GetClassName()))
			if slot < 0 {
				slot = s.slotForName(hero.GetClassName())
			}
		}
	}
	life := getInt(e, "m_lifeState")
	existing, ok := s.wards[idx]
	if op.Has(replay.OpCreated) || op.Has(replay.OpEntered) {
		if !ok || !existing.alive {
			s.out.Wards = append(s.out.Wards, model.Ward{
				Header:  s.header(s.clock(), slot),
				Kind:    kind,
				IsLeft:  0,
				X:       x,
				Y:       y,
				Z:       z,
				Ehandle: uint32(idx),
			})
		}
		s.wards[idx] = &wardWatch{kind: kind, slot: slot, x: x, y: y, z: z, alive: life == 0}
		return
	}
	if ok && existing.alive && (life != 0 || op.Has(replay.OpDeleted) || op.Has(replay.OpLeft)) {
		s.out.Wards = append(s.out.Wards, model.Ward{
			Header:  s.header(s.clock(), existing.slot),
			Kind:    existing.kind,
			IsLeft:  1,
			X:       existing.x,
			Y:       existing.y,
			Z:       existing.z,
			Ehandle: uint32(idx),
		})
		existing.alive = false
	}
	if op.Has(replay.OpDeleted) {
		delete(s.wards, idx)
	}
}

func (s *Session) trackCosmetic(e *replay.Entity) {
	item := getUint(e, "m_iItemDefinitionIndex", "m_AttributeManager.m_Item.m_iItemDefinitionIndex")
	if item == 0 {
		return
	}
	acc := getUint(e, "m_iAccountID", "m_AttributeManager.m_Item.m_iAccountID")
	key := uint64(acc)<<32 | uint64(item)
	if _, ok := s.cosmetics[key]; ok {
		return
	}
	s.cosmetics[key] = struct{}{}
	s.out.Cosmetics = append(s.out.Cosmetics, model.Cosmetic{
		Header:    s.header(s.clock(), -1),
		ItemID:    item,
		AccountID: acc,
	})
}

func (s *Session) trackNeutralItem(e *replay.Entity, op replay.Op) {
	if !op.Has(replay.OpCreated) && !op.Has(replay.OpEntered) {
		return
	}
	name := e.GetClassName()
	lower := strings.ToLower(name)
	if !strings.Contains(lower, "neutral") && !strings.Contains(lower, "tier") {
		return
	}
	s.out.Neutrals = append(s.out.Neutrals, model.Neutral{
		Header: s.header(s.clock(), -1),
		Kind:   "neutral_item",
		Key:    name,
		Value:  int32(getUint(e, "m_iItemDefinitionIndex")),
	})
}

func (s *Session) onOrder(m *valve.CDOTAUserMsg_SpectatorPlayerUnitOrders) error {
	slot := s.slotForPlayerID(m.GetEntindex())
	pos := m.GetPosition()
	var x, y, z float32
	if pos != nil {
		x, y, z = pos.GetX(), pos.GetY(), pos.GetZ()
	}
	unit := int32(-1)
	if units := m.GetUnits(); len(units) > 0 {
		unit = units[0]
	}
	s.out.Actions = append(s.out.Actions, model.Action{
		Header:      s.header(s.clock(), slot),
		OrderType:   uint16(m.GetOrderType()),
		UnitIndex:   unit,
		TargetIndex: m.GetTargetIndex(),
		AbilityID:   m.GetAbilityId(),
		PosX:        x,
		PosY:        y,
		PosZ:        z,
		Queued:      boolU8(m.GetQueue()),
	})
	return nil
}

func (s *Session) onLocationPing(m *valve.CDOTAUserMsg_LocationPing) error {
	slot := s.slotForPlayerID(int32(m.GetPlayerId()))
	ping := m.GetLocationPing()
	var x, y float32
	var target int32 = -1
	var ptype uint16
	if ping != nil {
		x, y = float32(ping.GetX()), float32(ping.GetY())
		target = ping.GetTarget()
		ptype = uint16(ping.GetType())
	}
	s.out.Pings = append(s.out.Pings, model.Ping{
		Header:   s.header(s.clock(), slot),
		X:        x,
		Y:        y,
		PingType: ptype,
		Target:   target,
	})
	return nil
}

func (s *Session) onMinimap(m *valve.CDOTAUserMsg_MinimapEvent) error {
	slot := s.slotForPlayerID(int32(m.GetEntityHandle()))
	if m.GetEventType() == 0 && m.GetX() == 0 && m.GetY() == 0 {
		return nil
	}
	s.out.Pings = append(s.out.Pings, model.Ping{
		Header:   s.header(s.clock(), slot),
		X:        float32(m.GetX()),
		Y:        float32(m.GetY()),
		PingType: uint16(m.GetEventType()),
		Target:   int32(m.GetTargetEntityHandle()),
	})
	return nil
}

func (s *Session) onChatEvent(m *valve.CDOTAUserMsg_ChatEvent) error {
	kind := m.GetType().String()
	if kind == "" {
		kind = "CHAT_MESSAGE_UNKNOWN"
	}
	slot := s.slotForPlayerID(m.GetPlayerid_1())
	s.out.Announcements = append(s.out.Announcements, model.Announcement{
		Header:  s.header(s.clock(), slot),
		Kind:    kind,
		Player1: int16(m.GetPlayerid_1()),
		Player2: int16(m.GetPlayerid_2()),
		Value:   int32(m.GetValue()),
		Player3: int16(m.GetPlayerid_3()),
		Value2:  m.GetValue2(),
		Value3:  m.GetValue3(),
	})
	s.objectiveFromChat(kind, m, slot)
	return nil
}

func (s *Session) onChatMessage(m *valve.CDOTAUserMsg_ChatMessage) error {
	slot := s.slotForPlayerID(int32(m.GetSourcePlayerId()))
	s.out.Chat = append(s.out.Chat, model.Chat{
		Header:  s.header(s.clock(), slot),
		Kind:    "chat",
		Key:     m.GetMessageText(),
		Channel: uint8(m.GetChannelType()),
	})
	return nil
}

func (s *Session) onChatWheel(m *valve.CDOTAUserMsg_ChatWheel) error {
	slot := s.slotForPlayerID(int32(m.GetPlayerId()))
	s.out.Chat = append(s.out.Chat, model.Chat{
		Header: s.header(s.clock(), slot),
		Kind:   "chatwheel",
		Key:    fmtInt(int64(m.GetChatMessageId())),
	})
	return nil
}

func (s *Session) onSayText2(m *valve.CUserMessageSayText2) error {
	s.out.Chat = append(s.out.Chat, model.Chat{
		Header: s.header(s.clock(), -1),
		Kind:   "chat",
		Key:    m.GetMessagename(),
		Unit:   m.GetParam1(),
	})
	return nil
}

func (s *Session) onNeutralFound(m *valve.CDOTAUserMsg_FoundNeutralItem) error {
	slot := s.slotForPlayerID(int32(m.GetPlayerId()))
	s.out.Neutrals = append(s.out.Neutrals, model.Neutral{
		Header: s.header(s.clock(), slot),
		Kind:   "found",
		Key:    fmtInt(int64(m.GetItemAbilityId())),
		Value:  m.GetItemAbilityId(),
	})
	s.addAlert(slot, "found_neutral", -1, m.GetItemAbilityId(), int32(m.GetItemTier()), 0, 0, "")
	return nil
}

func fmtInt(n int64) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	neg := n < 0
	if neg {
		n = -n
	}
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

func (s *Session) objectiveFromChat(kind string, m *valve.CDOTAUserMsg_ChatEvent, slot int8) {
	clock := s.clock()
	switch kind {
	case "CHAT_MESSAGE_TOWER_KILL", "CHAT_MESSAGE_TOWER_DENY":
		s.addObjective(clock, "tower", teamFromChat(m), slotPtr(slot), kind, intPtr(int32(m.GetValue())))
	case "CHAT_MESSAGE_BARRACKS_KILL":
		s.addObjective(clock, "barracks", teamFromChat(m), slotPtr(slot), kind, intPtr(int32(m.GetValue())))
	case "CHAT_MESSAGE_ROSHAN_KILL":
		s.addObjective(clock, "roshan", teamFromChat(m), slotPtr(slot), kind, nil)
	case "CHAT_MESSAGE_AEGIS":
		s.addObjective(clock, "aegis", teamFromChat(m), slotPtr(slot), kind, nil)
	case "CHAT_MESSAGE_AEGIS_STOLEN":
		s.addObjective(clock, "aegis_stolen", teamFromChat(m), slotPtr(slot), kind, nil)
	case "CHAT_MESSAGE_GLYPH_USED":
		s.addObjective(clock, "glyph", teamFromChat(m), slotPtr(slot), kind, nil)
	case "CHAT_MESSAGE_SCAN_USED":
		s.addObjective(clock, "scan", teamFromChat(m), slotPtr(slot), kind, nil)
	case "CHAT_MESSAGE_PAUSED", "CHAT_MESSAGE_UNPAUSE_COUNTDOWN", "CHAT_MESSAGE_UNPAUSED":
		s.addObjective(clock, "pause", nil, slotPtr(slot), kind, intPtr(int32(m.GetValue())))
	case "CHAT_MESSAGE_DISCONNECT", "CHAT_MESSAGE_DISCONNECT_WAIT_FOR_RECONNECT":
		s.addObjective(clock, "disconnect", nil, slotPtr(slot), kind, nil)
	case "CHAT_MESSAGE_RECONNECT":
		s.addObjective(clock, "reconnect", nil, slotPtr(slot), kind, nil)
	case "CHAT_MESSAGE_FIRSTBLOOD":
		s.addObjective(clock, "first_blood", nil, slotPtr(slot), kind, intPtr(int32(m.GetValue())))
	case "CHAT_MESSAGE_COURIER_LOST":
		s.addObjective(clock, "courier", teamFromChat(m), slotPtr(slot), kind, nil)
	case "CHAT_MESSAGE_SHRINE_KILLED":
		s.addObjective(clock, "shrine", teamFromChat(m), slotPtr(slot), kind, intPtr(int32(m.GetValue())))
	case "CHAT_MESSAGE_OBSERVER_WARD_KILLED", "CHAT_MESSAGE_SENTRY_WARD_KILLED":
		s.addObjective(clock, "ward", teamFromChat(m), slotPtr(slot), kind, nil)
	case "CHAT_MESSAGE_DENIED_AEGIS":
		s.addObjective(clock, "aegis_denied", teamFromChat(m), slotPtr(slot), kind, nil)
	case "CHAT_MESSAGE_MINIBOSS_KILL":
		s.addObjective(clock, "tormentor", teamFromChat(m), slotPtr(slot), kind, nil)
	case "CHAT_MESSAGE_SMOKE_ACTIVATED":
		s.addObjective(clock, "smoke", teamFromChat(m), slotPtr(slot), kind, nil)
	case "CHAT_MESSAGE_BANNER_PLANTED":
		s.addObjective(clock, "banner", teamFromChat(m), slotPtr(slot), kind, nil)
	}
}

func (s *Session) noteObjectiveFromCombat(_ string, target string, clock int32, slot int8) {
	kind := ""
	switch {
	case strings.Contains(target, "roshan"):
		kind = "roshan"
	case strings.Contains(target, "tower"):
		kind = "tower"
	case strings.Contains(target, "rax") || strings.Contains(target, "barracks"):
		kind = "barracks"
	case strings.Contains(target, "fort"):
		kind = "win"
	default:
		return
	}
	for _, o := range s.out.Objectives {
		if o.Kind == kind && o.Time == clock && o.Key == target {
			return
		}
	}
	s.addObjective(clock, kind, nil, slotPtr(slot), target, nil)
}

func (s *Session) addObjective(clock int32, kind string, team *int16, slot *int32, key string, value *int32) {
	s.out.Objectives = append(s.out.Objectives, model.Objective{
		Time:  clock,
		Kind:  kind,
		Team:  team,
		Slot:  slot,
		Key:   key,
		Value: value,
	})
}

func (s *Session) finishSummaries() {
	last := make(map[int8]model.Interval, 10)
	for i := len(s.out.Intervals) - 1; i >= 0; i-- {
		row := s.out.Intervals[i]
		if _, ok := last[row.Slot]; !ok {
			last[row.Slot] = row
		}
		if len(last) >= s.playerCount {
			break
		}
	}
	for i := 0; i < s.playerCount; i++ {
		pl := s.players[i]
		if pl == nil {
			continue
		}
		row, ok := last[pl.slot]
		if !ok {
			continue
		}
		lane, role, roam := inferLane(pl.posSamples, pl.team)
		s.out.PlayerSummary = append(s.out.PlayerSummary, model.PlayerSummary{
			Slot:                   pl.valveSlot,
			Lane:                   lane,
			LaneRole:               role,
			IsRoaming:              roam,
			Stuns:                  row.Stuns,
			TeamfightParticipation: row.TeamfightParticipation,
			TowersKilled:           int32(row.TowersKilled),
			RoshansKilled:          int32(row.RoshansKilled),
			ObserversPlaced:        int32(row.ObsPlaced),
			SentriesPlaced:         int32(row.SenPlaced),
			CampsStacked:           int32(row.CampsStacked),
			CreepsStacked:          int32(row.CreepsStacked),
			RunePickups:            int32(row.RunePickups),
			FirstbloodClaimed:      int32(row.FirstbloodClaimed),
		})
	}
	if s.gameState >= 6 {
		s.addObjective(s.clock(), "win", nil, nil, "", nil)
	}
}

func inferLane(samples [][2]float32, team int32) (lane, role int32, roam bool) {
	if len(samples) < 8 {
		return 0, 0, false
	}
	var mid, top, bot, jungle int
	for _, p := range samples {
		x, y := p[0], p[1]
		dx := x - 128
		dy := y - 128
		if dx*dx+dy*dy < 18*18 {
			mid++
			continue
		}
		// jungle ring around the river
		if (x > 90 && x < 160 && y > 90 && y < 160) && (dx*dx+dy*dy > 22*22) {
			jungle++
		}
		if y > x {
			top++
		} else {
			bot++
		}
	}
	n := len(samples)
	if jungle*3 > n {
		return 4, 4, true
	}
	if mid*2 > n {
		return 2, 2, false
	}
	// Radiant safe is bot, dire safe is top
	if team == 2 {
		if bot >= top {
			return 1, 1, false
		}
		return 3, 3, false
	}
	if top >= bot {
		return 1, 1, false
	}
	return 3, 3, false
}

func slotPtr(slot int8) *int32 {
	if slot < 0 {
		return nil
	}
	v := int32(slot)
	return &v
}

func intPtr(v int32) *int32 { return &v }

func teamPtr(slot int8) *int16 {
	if slot < 0 {
		return nil
	}
	if slot >= 5 {
		v := int16(1)
		return &v
	}
	v := int16(0)
	return &v
}

func teamFromChat(m *valve.CDOTAUserMsg_ChatEvent) *int16 {
	// value often encodes the killing team
	if m.GetValue() == 3 {
		v := int16(1)
		return &v
	}
	if m.GetValue() == 2 {
		v := int16(0)
		return &v
	}
	return nil
}
