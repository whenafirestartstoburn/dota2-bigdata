package parse

import (
	"dota2-collector/parser/internal/model"
	"dota2-collector/parser/internal/valve"

	"google.golang.org/protobuf/proto"
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

func (s *Session) onUserMessage(kind int32, buf []byte) error {
	switch valve.EDotaUserMessages(kind) {
	case valve.EDotaUserMessages_DOTA_UM_ItemAlert:
		m := &valve.CDOTAUserMsg_ItemAlert{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		var item int32
		var x, y float32
		if a := m.GetItemAlert(); a != nil {
			item = a.GetItemAbilityId()
			x, y = float32(a.GetX()), float32(a.GetY())
		}
		s.addAlert(s.slotForPlayerID(m.GetPlayerId()), "item_alert", -1, item, 0, x, y, "")
	case valve.EDotaUserMessages_DOTA_UM_EnemyItemAlert:
		m := &valve.CDOTAUserMsg_EnemyItemAlert{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		s.addAlert(
			s.slotForPlayerID(m.GetPlayerId()),
			"enemy_item_alert",
			int16(m.GetTargetPlayerId()),
			m.GetItemAbilityId(),
			m.GetItemLevel(),
			0, 0, "",
		)
	case valve.EDotaUserMessages_DOTA_UM_WillPurchaseAlert:
		m := &valve.CDOTAUserMsg_WillPurchaseAlert{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		s.addAlert(
			s.slotForPlayerID(m.GetPlayerId()),
			"will_purchase",
			int16(m.GetSuggestionPlayerId()),
			m.GetItemAbilityId(),
			int32(m.GetGoldRemaining()),
			0, 0, "",
		)
	case valve.EDotaUserMessages_DOTA_UM_ItemSold:
		m := &valve.CDOTAUserMsg_ItemSold{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		s.addAlert(-1, "item_sold", -1, m.GetItemAbilityId(), 0, 0, 0, "")
	case valve.EDotaUserMessages_DOTA_UM_ItemPurchased:
		m := &valve.CDOTAUserMsg_ItemPurchased{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		s.addAlert(-1, "item_purchased", -1, m.GetItemAbilityId(), boolI32(m.GetFromCombine()), 0, 0, "")
	case valve.EDotaUserMessages_DOTA_UM_AbilityPing:
		m := &valve.CDOTAUserMsg_AbilityPing{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		s.addAlert(
			s.slotForPlayerID(m.GetPlayerId()),
			"ability_ping",
			-1,
			m.GetAbilityId(),
			int32(m.GetType()),
			0, 0, "",
		)
	case valve.EDotaUserMessages_DOTA_UM_FacetPing:
		m := &valve.CDOTAUserMsg_FacetPing{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		s.addAlert(s.slotForPlayerID(m.GetPlayerId()), "facet_ping", -1, int32(m.GetFacetStrhash()), 0, 0, 0, "")
	case valve.EDotaUserMessages_DOTA_UM_InnatePing:
		m := &valve.CDOTAUserMsg_InnatePing{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		s.addAlert(s.slotForPlayerID(m.GetPlayerId()), "innate_ping", -1, int32(m.GetEntityId()), 0, 0, 0, "")
	case valve.EDotaUserMessages_DOTA_UM_AbilitySteal:
		m := &valve.CDOTAUserMsg_AbilitySteal{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		s.addAlert(s.slotForPlayerID(m.GetPlayerId()), "ability_steal", -1, m.GetAbilityId(), int32(m.GetAbilityLevel()), 0, 0, "")
	case valve.EDotaUserMessages_DOTA_UM_SharedCooldown:
		m := &valve.CDOTAUserMsg_SharedCooldown{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		s.addAlert(s.slotForPlayerID(m.GetEntindex()), "shared_cooldown", -1, int32(m.GetCooldown()*100), 0, 0, 0, m.GetName())
	case valve.EDotaUserMessages_DOTA_UM_CourierKilledAlert:
		m := &valve.CDOTAUserMsg_CourierKilledAlert{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		s.addAlert(
			s.slotForPlayerID(m.GetOwningPlayerId()),
			"courier_killed",
			int16(m.GetKillerPlayerId()),
			int32(m.GetGoldValue()),
			int32(m.GetTeam()),
			0, 0, "",
		)
		s.addObjective(s.clock(), "courier", int16ptr(int16(m.GetTeam())), slotPtr(s.slotForPlayerID(m.GetOwningPlayerId())), "courier_killed", intPtr(int32(m.GetGoldValue())))
	case valve.EDotaUserMessages_DOTA_UM_CourierLeftFountainAlert:
		m := &valve.CDOTAUserMsg_CourierLeftFountainAlert{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		s.addAlert(s.slotForPlayerID(m.GetOwningPlayerId()), "courier_left_fountain", -1, 0, 0, 0, 0, "")
	case valve.EDotaUserMessages_DOTA_UM_OutpostCaptured:
		m := &valve.CDOTAUserMsg_OutpostCaptured{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		team := int16(m.GetTeamId())
		s.addAlert(-1, "outpost_captured", -1, int32(m.GetTeamId()), m.GetOutpostEntindex(), 0, 0, "")
		s.addObjective(s.clock(), "outpost", &team, nil, "outpost_captured", intPtr(int32(m.GetTeamId())))
	case valve.EDotaUserMessages_DOTA_UM_OutpostGrantedXP:
		m := &valve.CDOTAUserMsg_OutpostGrantedXP{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		s.addAlert(-1, "outpost_xp", -1, int32(m.GetTeamId()), int32(m.GetXpAmount()), 0, 0, "")
	case valve.EDotaUserMessages_DOTA_UM_GlyphAlert:
		m := &valve.CDOTAUserMsg_GlyphAlert{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		s.addAlert(s.slotForPlayerID(m.GetPlayerId()), "glyph_alert", -1, boolI32(m.GetNegative()), 0, 0, 0, "")
	case valve.EDotaUserMessages_DOTA_UM_RadarAlert:
		m := &valve.CDOTAUserMsg_RadarAlert{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		s.addAlert(s.slotForPlayerID(m.GetPlayerId()), "radar_alert", -1, boolI32(m.GetNegative()), 0, 0, 0, "")
	case valve.EDotaUserMessages_DOTA_UM_BuyBackStateAlert:
		m := &valve.CDOTAUserMsg_BuyBackStateAlert{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		s.addAlert(s.slotForPlayerID(m.GetPlayerId()), "buyback_alert", -1, 0, 0, 0, 0, "")
	case valve.EDotaUserMessages_DOTA_UM_AghsStatusAlert:
		m := &valve.CDOTAUserMsg_AghsStatusAlert{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
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
	case valve.EDotaUserMessages_DOTA_UM_NeutralCampAlert:
		m := &valve.CDOTAUserMsg_NeutralCampAlert{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		s.addAlert(
			s.slotForPlayerID(m.GetPlayerId()),
			"neutral_camp",
			-1,
			m.GetCampType(),
			m.GetStackCount(),
			0, 0, "",
		)
	case valve.EDotaUserMessages_DOTA_UM_RoshanTimer:
		m := &valve.CDOTAUserMsg_RoshanTimer{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		s.addAlert(s.slotForPlayerID(m.GetPlayerId()), "roshan_timer", -1, boolI32(m.GetNegative()), 0, 0, 0, "")
	case valve.EDotaUserMessages_DOTA_UM_TormentorTimer:
		m := &valve.CDOTAUserMsg_TormentorTimer{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		s.addAlert(s.slotForPlayerID(m.GetPlayerId()), "tormentor_timer", -1, boolI32(m.GetNegative()), 0, 0, 0, "")
	case valve.EDotaUserMessages_DOTA_UM_SendRoshanSpectatorPhase:
		m := &valve.CDOTAUserMsg_SendRoshanSpectatorPhase{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		s.addAlert(-1, "roshan_phase", -1, int32(m.GetPhase()), m.GetPhaseLength(), 0, 0, "")
	case valve.EDotaUserMessages_DOTA_UM_MapLine:
		m := &valve.CDOTAUserMsg_MapLine{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		var x, y float32
		if line := m.GetMapline(); line != nil {
			x, y = float32(line.GetX()), float32(line.GetY())
		}
		s.addAlert(s.slotForPlayerID(m.GetPlayerId()), "map_line", -1, 0, 0, x, y, "")
	case valve.EDotaUserMessages_DOTA_UM_PingConfirmation:
		m := &valve.CDOTAUserMsg_PingConfirmation{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
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
	case valve.EDotaUserMessages_DOTA_UM_GiveItem:
		m := &valve.CDOTAUserMsg_GiveItem{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		s.addAlert(-1, "give_item", -1, int32(m.GetGiveStatus()), int32(m.GetItemEntIndex()), 0, 0, "")
	case valve.EDotaUserMessages_DOTA_UM_MadstoneAlert:
		m := &valve.CDOTAUserMsg_MadstoneAlert{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		s.addAlert(
			s.slotForPlayerID(m.GetPlayerId()),
			"madstone",
			-1,
			int32(m.GetMadstoneAlertType()),
			m.GetTier(),
			0, 0, "",
		)
	case valve.EDotaUserMessages_DOTA_UM_TimerAlert:
		m := &valve.CDOTAUserMsg_TimerAlert{}
		if err := proto.Unmarshal(buf, m); err != nil {
			return err
		}
		s.addAlert(s.slotForPlayerID(m.GetPlayerId()), "timer_alert", -1, int32(m.GetTimerAlertType()), 0, 0, 0, "")
	}
	return nil
}

func boolI32(v bool) int32 {
	if v {
		return 1
	}
	return 0
}

func int16ptr(v int16) *int16 { return &v }
