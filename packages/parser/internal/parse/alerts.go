package parse

import (
	"dota2-collector/parser/internal/model"

	"github.com/dotabuff/manta/dota"
)

func (s *Session) addAlert(slot int8, kind string, player2 int16, value, value2 int32, x, y float32, key string) {
	s.out.Alerts = append(s.out.Alerts, model.Alert{
		Header:  s.header(s.clock(), slot),
		Kind:    kind,
		Player2: player2,
		Value:   value,
		Value2:  value2,
		X:       x,
		Y:       y,
		Key:     key,
	})
}

func (s *Session) wireAlerts() {
	p := s.parser.Callbacks
	p.OnCDOTAUserMsg_ItemAlert(s.onItemAlert)
	p.OnCDOTAUserMsg_EnemyItemAlert(s.onEnemyItemAlert)
	p.OnCDOTAUserMsg_WillPurchaseAlert(s.onWillPurchaseAlert)
	p.OnCDOTAUserMsg_ItemSold(s.onItemSold)
	p.OnCDOTAUserMsg_ItemPurchased(s.onItemPurchased)
	p.OnCDOTAUserMsg_AbilityPing(s.onAbilityPing)
	p.OnCDOTAUserMsg_FacetPing(s.onFacetPing)
	p.OnCDOTAUserMsg_InnatePing(s.onInnatePing)
	p.OnCDOTAUserMsg_AbilitySteal(s.onAbilitySteal)
	p.OnCDOTAUserMsg_SharedCooldown(s.onSharedCooldown)
	p.OnCDOTAUserMsg_CourierKilledAlert(s.onCourierKilledAlert)
	p.OnCDOTAUserMsg_CourierLeftFountainAlert(s.onCourierLeftFountainAlert)
	p.OnCDOTAUserMsg_OutpostCaptured(s.onOutpostCaptured)
	p.OnCDOTAUserMsg_OutpostGrantedXP(s.onOutpostGrantedXP)
	p.OnCDOTAUserMsg_GlyphAlert(s.onGlyphAlert)
	p.OnCDOTAUserMsg_RadarAlert(s.onRadarAlert)
	p.OnCDOTAUserMsg_BuyBackStateAlert(s.onBuyBackStateAlert)
	p.OnCDOTAUserMsg_AghsStatusAlert(s.onAghsStatusAlert)
	p.OnCDOTAUserMsg_NeutralCampAlert(s.onNeutralCampAlert)
	p.OnCDOTAUserMsg_RoshanTimer(s.onRoshanTimer)
	p.OnCDOTAUserMsg_TormentorTimer(s.onTormentorTimer)
	p.OnCDOTAUserMsg_SendRoshanSpectatorPhase(s.onSendRoshanSpectatorPhase)
	p.OnCDOTAUserMsg_MapLine(s.onMapLine)
	p.OnCDOTAUserMsg_PingConfirmation(s.onPingConfirmation)
	p.OnCDOTAUserMsg_GiveItem(s.onGiveItem)
	p.OnCDOTAUserMsg_MadstoneAlert(s.onMadstoneAlert)
	p.OnCDOTAUserMsg_TimerAlert(s.onTimerAlert)
}

func (s *Session) onItemAlert(m *dota.CDOTAUserMsg_ItemAlert) error {
	var item int32
	var x, y float32
	if a := m.GetItemAlert(); a != nil {
		item = a.GetItemAbilityId()
		x, y = float32(a.GetX()), float32(a.GetY())
	}
	s.addAlert(s.slotForPlayerID(m.GetPlayerId()), "item_alert", -1, item, 0, x, y, "")
	return nil
}

func (s *Session) onEnemyItemAlert(m *dota.CDOTAUserMsg_EnemyItemAlert) error {
	s.addAlert(
		s.slotForPlayerID(m.GetPlayerId()),
		"enemy_item_alert",
		int16(m.GetTargetPlayerId()),
		m.GetItemAbilityId(),
		m.GetItemLevel(),
		0, 0, "",
	)
	return nil
}

func (s *Session) onWillPurchaseAlert(m *dota.CDOTAUserMsg_WillPurchaseAlert) error {
	s.addAlert(
		s.slotForPlayerID(m.GetPlayerId()),
		"will_purchase",
		int16(m.GetSuggestionPlayerId()),
		m.GetItemAbilityId(),
		int32(m.GetGoldRemaining()),
		0, 0, "",
	)
	return nil
}

func (s *Session) onItemSold(m *dota.CDOTAUserMsg_ItemSold) error {
	s.addAlert(-1, "item_sold", -1, m.GetItemAbilityId(), 0, 0, 0, "")
	return nil
}

func (s *Session) onItemPurchased(m *dota.CDOTAUserMsg_ItemPurchased) error {
	s.addAlert(-1, "item_purchased", -1, m.GetItemAbilityId(), boolI32(m.GetFromCombine()), 0, 0, "")
	return nil
}

func (s *Session) onAbilityPing(m *dota.CDOTAUserMsg_AbilityPing) error {
	s.addAlert(
		s.slotForPlayerID(m.GetPlayerId()),
		"ability_ping",
		-1,
		m.GetAbilityId(),
		int32(m.GetType()),
		0, 0, "",
	)
	return nil
}

func (s *Session) onFacetPing(m *dota.CDOTAUserMsg_FacetPing) error {
	s.addAlert(s.slotForPlayerID(m.GetPlayerId()), "facet_ping", -1, int32(m.GetFacetStrhash()), 0, 0, 0, "")
	return nil
}

func (s *Session) onInnatePing(m *dota.CDOTAUserMsg_InnatePing) error {
	s.addAlert(s.slotForPlayerID(m.GetPlayerId()), "innate_ping", -1, int32(m.GetEntityId()), 0, 0, 0, "")
	return nil
}

func (s *Session) onAbilitySteal(m *dota.CDOTAUserMsg_AbilitySteal) error {
	s.addAlert(s.slotForPlayerID(m.GetPlayerId()), "ability_steal", -1, m.GetAbilityId(), int32(m.GetAbilityLevel()), 0, 0, "")
	return nil
}

func (s *Session) onSharedCooldown(m *dota.CDOTAUserMsg_SharedCooldown) error {
	s.addAlert(s.slotForPlayerID(m.GetEntindex()), "shared_cooldown", -1, int32(m.GetCooldown()*100), 0, 0, 0, m.GetName())
	return nil
}

func (s *Session) onCourierKilledAlert(m *dota.CDOTAUserMsg_CourierKilledAlert) error {
	s.addAlert(
		s.slotForPlayerID(m.GetOwningPlayerId()),
		"courier_killed",
		int16(m.GetKillerPlayerId()),
		int32(m.GetGoldValue()),
		int32(m.GetTeam()),
		0, 0, "",
	)
	s.addObjective(s.clock(), "courier", int16ptr(int16(m.GetTeam())), slotPtr(s.slotForPlayerID(m.GetOwningPlayerId())), "courier_killed", intPtr(int32(m.GetGoldValue())))
	return nil
}

func (s *Session) onCourierLeftFountainAlert(m *dota.CDOTAUserMsg_CourierLeftFountainAlert) error {
	s.addAlert(s.slotForPlayerID(m.GetOwningPlayerId()), "courier_left_fountain", -1, 0, 0, 0, 0, "")
	return nil
}

func (s *Session) onOutpostCaptured(m *dota.CDOTAUserMsg_OutpostCaptured) error {
	team := int16(m.GetTeamId())
	s.addAlert(-1, "outpost_captured", -1, int32(m.GetTeamId()), m.GetOutpostEntindex(), 0, 0, "")
	s.addObjective(s.clock(), "outpost", &team, nil, "outpost_captured", intPtr(int32(m.GetTeamId())))
	return nil
}

func (s *Session) onOutpostGrantedXP(m *dota.CDOTAUserMsg_OutpostGrantedXP) error {
	s.addAlert(-1, "outpost_xp", -1, int32(m.GetTeamId()), int32(m.GetXpAmount()), 0, 0, "")
	return nil
}

func (s *Session) onGlyphAlert(m *dota.CDOTAUserMsg_GlyphAlert) error {
	s.addAlert(s.slotForPlayerID(m.GetPlayerId()), "glyph_alert", -1, boolI32(m.GetNegative()), 0, 0, 0, "")
	return nil
}

func (s *Session) onRadarAlert(m *dota.CDOTAUserMsg_RadarAlert) error {
	s.addAlert(s.slotForPlayerID(m.GetPlayerId()), "radar_alert", -1, boolI32(m.GetNegative()), 0, 0, 0, "")
	return nil
}

func (s *Session) onBuyBackStateAlert(m *dota.CDOTAUserMsg_BuyBackStateAlert) error {
	s.addAlert(s.slotForPlayerID(m.GetPlayerId()), "buyback_alert", -1, 0, 0, 0, 0, "")
	return nil
}

func (s *Session) onAghsStatusAlert(m *dota.CDOTAUserMsg_AghsStatusAlert) error {
	flags := int32(0)
	if m.GetHasScepter() {
		flags |= 1
	}
	if m.GetHasShard() {
		flags |= 2
	}
	s.addAlert(
		s.slotForPlayerID(m.GetSourcePlayerId()),
		"aghs_status",
		int16(m.GetTargetPlayerId()),
		int32(m.GetAlertType()),
		flags,
		0, 0, "",
	)
	return nil
}

func (s *Session) onNeutralCampAlert(m *dota.CDOTAUserMsg_NeutralCampAlert) error {
	s.addAlert(
		s.slotForPlayerID(m.GetPlayerId()),
		"neutral_camp",
		-1,
		m.GetCampType(),
		m.GetStackCount(),
		0, 0, "",
	)
	return nil
}

func (s *Session) onRoshanTimer(m *dota.CDOTAUserMsg_RoshanTimer) error {
	s.addAlert(s.slotForPlayerID(m.GetPlayerId()), "roshan_timer", -1, boolI32(m.GetNegative()), 0, 0, 0, "")
	return nil
}

func (s *Session) onTormentorTimer(m *dota.CDOTAUserMsg_TormentorTimer) error {
	s.addAlert(s.slotForPlayerID(m.GetPlayerId()), "tormentor_timer", -1, boolI32(m.GetNegative()), 0, 0, 0, "")
	return nil
}

func (s *Session) onSendRoshanSpectatorPhase(m *dota.CDOTAUserMsg_SendRoshanSpectatorPhase) error {
	s.addAlert(-1, "roshan_phase", -1, int32(m.GetPhase()), m.GetPhaseLength(), 0, 0, "")
	return nil
}

func (s *Session) onMapLine(m *dota.CDOTAUserMsg_MapLine) error {
	var x, y float32
	if line := m.GetMapline(); line != nil {
		x, y = float32(line.GetX()), float32(line.GetY())
	}
	s.addAlert(s.slotForPlayerID(m.GetPlayerId()), "map_line", -1, 0, 0, x, y, "")
	return nil
}

func (s *Session) onPingConfirmation(m *dota.CDOTAUserMsg_PingConfirmation) error {
	var x, y float32
	if loc := m.GetLocation(); loc != nil {
		x, y = loc.GetX(), loc.GetY()
	}
	s.addAlert(
		s.slotForPlayerID(m.GetPlayerIdOfOriginalPinger()),
		"ping_confirm",
		-1,
		int32(m.GetIconType()),
		0,
		x, y, "",
	)
	return nil
}

func (s *Session) onGiveItem(m *dota.CDOTAUserMsg_GiveItem) error {
	s.addAlert(-1, "give_item", -1, int32(m.GetGiveStatus()), int32(m.GetItemEntIndex()), 0, 0, "")
	return nil
}

func (s *Session) onMadstoneAlert(m *dota.CDOTAUserMsg_MadstoneAlert) error {
	s.addAlert(
		s.slotForPlayerID(m.GetPlayerId()),
		"madstone",
		-1,
		int32(m.GetMadstoneAlertType()),
		m.GetTier(),
		0, 0, "",
	)
	return nil
}

func (s *Session) onTimerAlert(m *dota.CDOTAUserMsg_TimerAlert) error {
	s.addAlert(s.slotForPlayerID(m.GetPlayerId()), "timer_alert", -1, int32(m.GetTimerAlertType()), 0, 0, 0, "")
	return nil
}

func boolI32(v bool) int32 {
	if v {
		return 1
	}
	return 0
}

func int16ptr(v int16) *int16 { return &v }
