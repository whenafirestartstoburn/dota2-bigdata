package parse

import (
	"dota2-collector/parser/internal/model"
	"dota2-collector/parser/internal/valve"
)

func valvePlayerSlot(valveSlot uint32) int8 {
	if valveSlot >= 128 {
		s := valveSlot - 128 + 5
		if s > 9 {
			return 9
		}
		return int8(s)
	}
	if valveSlot > 9 {
		return int8(valveSlot % 10)
	}
	return int8(valveSlot)
}

func killTypeName(t valve.CDOTAMatchMetadata_Team_KillInfo_KillType) string {
	switch t {
	case valve.CDOTAMatchMetadata_Team_KillInfo_KILL_TYPE_TOWER:
		return "tower"
	case valve.CDOTAMatchMetadata_Team_KillInfo_KILL_TYPE_BARRACKS:
		return "barracks"
	case valve.CDOTAMatchMetadata_Team_KillInfo_KILL_TYPE_ROSHAN:
		return "roshan"
	case valve.CDOTAMatchMetadata_Team_KillInfo_KILL_TYPE_MINIBOSS:
		return "miniboss"
	default:
		return "player"
	}
}

func (s *Session) ensureMeta() {
	if s.out.Meta.MatchID != 0 {
		return
	}
	s.out.Meta.Header = s.header(0, -1)
}

func (s *Session) applyMetadata(meta *valve.CDOTAMatchMetadata) {
	if meta == nil {
		return
	}
	s.ensureMeta()
	s.out.Meta.LobbyID = meta.GetLobbyId()
	for _, team := range meta.GetTeams() {
		if team == nil {
			continue
		}
		s.addMetaTeam(team)
		for _, pl := range team.GetPlayers() {
			if pl == nil {
				continue
			}
			s.addMetaPlayer(pl)
		}
		for _, kill := range team.GetKills() {
			if kill == nil {
				continue
			}
			s.addMetaKill(team.GetDotaTeam(), kill)
		}
	}
	for _, tip := range meta.GetMatchTips() {
		if tip == nil {
			continue
		}
		src := valvePlayerSlot(tip.GetSourcePlayerSlot())
		s.out.MetaTips = append(s.out.MetaTips, model.MetaTip{
			Header:     s.header(0, src),
			SourceSlot: uint8(src),
			TargetSlot: uint8(valvePlayerSlot(tip.GetTargetPlayerSlot())),
			TipAmount:  tip.GetTipAmount(),
			EventID:    uint32(tip.GetEventId()),
		})
	}
}

func (s *Session) addMetaTeam(team *valve.CDOTAMatchMetadata_Team) {
	dotaTeam := uint8(team.GetDotaTeam())
	first := uint8(0)
	if team.GetCmFirstPick() {
		first = 1
	}
	s.out.MetaTeams = append(s.out.MetaTeams, model.MetaTeam{
		Header:            s.header(0, -1),
		DotaTeam:          dotaTeam,
		CMFirstPick:       first,
		CMCaptainPlayerID: team.GetCmCaptainPlayerId(),
		CMPenalty:         team.GetCmPenalty(),
		GraphExperience:   append([]float32(nil), team.GetGraphExperience()...),
		GraphGoldEarned:   append([]float32(nil), team.GetGraphGoldEarned()...),
		GraphNetWorth:     append([]float32(nil), team.GetGraphNetWorth()...),
	})
}

func (s *Session) addMetaPlayer(pl *valve.CDOTAMatchMetadata_Team_Player) {
	valvePlayer := pl.GetPlayerSlot()
	slot := valvePlayerSlot(valvePlayer)
	s.out.MetaPlayers = append(s.out.MetaPlayers, model.MetaPlayer{
		Header:              s.header(0, slot),
		ValveSlot:           uint8(valvePlayer),
		TeamNumber:          uint8(pl.GetTeamNumber()),
		TeamSlot:            uint8(pl.GetTeamSlot()),
		CampsStacked:        pl.GetCampsStacked(),
		LaneSelectionFlags:  pl.GetLaneSelectionFlags(),
		Rampages:            pl.GetRampages(),
		TripleKills:         pl.GetTripleKills(),
		AegisSnatched:       pl.GetAegisSnatched(),
		RapiersPurchased:    pl.GetRapiersPurchased(),
		CouriersKilled:      pl.GetCouriersKilled(),
		NetWorthRank:        pl.GetNetWorthRank(),
		SupportGoldSpent:    pl.GetSupportGoldSpent(),
		ObserverWardsPlaced: pl.GetObserverWardsPlaced(),
		SentryWardsPlaced:   pl.GetSentryWardsPlaced(),
		WardsDewarded:       pl.GetWardsDewarded(),
		StunDuration:        pl.GetStunDuration(),
		FightScore:          pl.GetFightScore(),
		FarmScore:           pl.GetFarmScore(),
		SupportScore:        pl.GetSupportScore(),
		PushScore:           pl.GetPushScore(),
		HeroXP:              pl.GetHeroXp(),
		AbilityUpgrades:     append([]int32(nil), pl.GetAbilityUpgrades()...),
		LevelUpTimes:        append([]uint32(nil), pl.GetLevelUpTimes()...),
		GraphNetWorth:       append([]float32(nil), pl.GetGraphNetWorth()...),
		GraphHeroDamage:     append([]float32(nil), pl.GetGraphHeroDamage()...),
	})
	for _, k := range pl.GetKills() {
		if k == nil {
			continue
		}
		s.out.MetaPlayerKills = append(s.out.MetaPlayerKills, model.MetaPlayerKill{
			Header:     s.header(0, slot),
			VictimSlot: uint8(valvePlayerSlot(k.GetVictimSlot())),
			Count:      k.GetCount(),
		})
	}
	for _, item := range pl.GetItems() {
		if item == nil {
			continue
		}
		s.out.MetaPurchases = append(s.out.MetaPurchases, model.MetaPurchase{
			Header: s.header(item.GetPurchaseTime(), slot),
			ItemID: item.GetItemId(),
		})
	}
	for _, snap := range pl.GetInventorySnapshot() {
		if snap == nil {
			continue
		}
		s.out.MetaInventory = append(s.out.MetaInventory, model.MetaInventory{
			Header:               s.header(snap.GetGameTime(), slot),
			ItemIDs:              append([]int32(nil), snap.GetItemId()...),
			BackpackItemIDs:      append([]int32(nil), snap.GetBackpackItemId()...),
			NeutralItemID:        snap.GetNeutralItemId(),
			NeutralEnhancementID: snap.GetNeutralEnhancementId(),
			Kills:                snap.GetKills(),
			Deaths:               snap.GetDeaths(),
			Assists:              snap.GetAssists(),
			Level:                snap.GetLevel(),
			LastHits:             snap.GetLastHits(),
			Denies:               snap.GetDenies(),
			Flags:                snap.GetFlags(),
		})
	}
}

func (s *Session) addMetaKill(dotaTeam uint32, kill *valve.CDOTAMatchMetadata_Team_KillInfo) {
	killers := kill.GetKillerPlayerSlot()
	slots := make([]uint8, 0, len(killers))
	var actor int8 = -1
	if len(killers) > 0 {
		actor = valvePlayerSlot(killers[0])
	} else if kill.GetVictimPlayerSlot() != 0 || kill.GetKillType() == valve.CDOTAMatchMetadata_Team_KillInfo_KILL_TYPE_PLAYER {
		actor = valvePlayerSlot(kill.GetVictimPlayerSlot())
	}
	for _, k := range killers {
		slots = append(slots, uint8(valvePlayerSlot(k)))
	}
	s.out.MetaKills = append(s.out.MetaKills, model.MetaKill{
		Header:      s.header(kill.GetTime(), actor),
		Team:        uint8(dotaTeam),
		KillType:    killTypeName(kill.GetKillType()),
		VictimSlot:  uint8(valvePlayerSlot(kill.GetVictimPlayerSlot())),
		KillerSlots: slots,
		Bounty:      kill.GetBounty(),
	})
}
