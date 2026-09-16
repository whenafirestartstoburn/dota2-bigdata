package parse

import (
	"testing"
	"time"

	"dota2-collector/parser/internal/model"
	"dota2-collector/parser/internal/version"

	"github.com/dotabuff/manta/dota"
)

func TestValvePlayerSlot(t *testing.T) {
	if valvePlayerSlot(1) != 1 {
		t.Fatalf("valve 1 → %d", valvePlayerSlot(1))
	}
	if valvePlayerSlot(128) != 5 {
		t.Fatalf("valve 128 → %d", valvePlayerSlot(128))
	}
	if valvePlayerSlot(132) != 9 {
		t.Fatalf("valve 132 → %d", valvePlayerSlot(132))
	}
}

func TestApplyMetadataPurchasesAndKills(t *testing.T) {
	s := &Session{
		job: Job{MatchID: 8968680981, StartTime: time.Unix(1_700_000_000, 0).UTC()},
		out: &model.Result{MatchID: 8968680981, ParserVersion: version.Schema},
	}
	s.accounts[1] = 118306019
	itemID := int32(50)
	bought := int32(403)
	neut := int32(1603)
	gameTime := int32(1807)
	victim := uint32(5)
	count := uint32(3)
	killTime := int32(120)
	bounty := int32(180)
	killType := dota.CDOTAMatchMetadata_Team_KillInfo_KILL_TYPE_PLAYER
	s.applyMetadata(&dota.CDOTAMatchMetadata{
		Teams: []*dota.CDOTAMatchMetadata_Team{{
			DotaTeam: protoU32(2),
			Players: []*dota.CDOTAMatchMetadata_Team_Player{{
				PlayerSlot: protoU32(1),
				Items: []*dota.CDOTAMatchMetadata_Team_ItemPurchase{{
					ItemId:       &itemID,
					PurchaseTime: &bought,
				}},
				Kills: []*dota.CDOTAMatchMetadata_Team_PlayerKill{{
					VictimSlot: &victim,
					Count:      &count,
				}},
				InventorySnapshot: []*dota.CDOTAMatchMetadata_Team_InventorySnapshot{{
					GameTime:      &gameTime,
					NeutralItemId: &neut,
					ItemId:        []int32{50, 73},
				}},
			}},
			Kills: []*dota.CDOTAMatchMetadata_Team_KillInfo{{
				KillType:         &killType,
				VictimPlayerSlot: protoU32(128),
				KillerPlayerSlot: []uint32{1},
				Time:             &killTime,
				Bounty:           &bounty,
			}},
		}},
	})
	if s.out.Meta.MatchID != 8968680981 {
		t.Fatalf("meta match %d", s.out.Meta.MatchID)
	}
	if len(s.out.MetaPurchases) != 1 || s.out.MetaPurchases[0].ItemID != 50 || s.out.MetaPurchases[0].Time != 403 {
		t.Fatalf("purchases %+v", s.out.MetaPurchases)
	}
	if s.out.MetaPurchases[0].Slot != 1 || s.out.MetaPurchases[0].AccountID != 118306019 {
		t.Fatalf("purchase stamp %+v", s.out.MetaPurchases[0].Header)
	}
	if len(s.out.MetaInventory) != 1 || s.out.MetaInventory[0].NeutralItemID != 1603 {
		t.Fatalf("inventory %+v", s.out.MetaInventory)
	}
	if len(s.out.MetaKills) != 1 || s.out.MetaKills[0].KillType != "player" || s.out.MetaKills[0].VictimSlot != 5 {
		t.Fatalf("kills %+v", s.out.MetaKills)
	}
	if len(s.out.MetaPlayerKills) != 1 || s.out.MetaPlayerKills[0].Count != 3 {
		t.Fatalf("player kills %+v", s.out.MetaPlayerKills)
	}
}

func protoU32(v uint32) *uint32 { return &v }
