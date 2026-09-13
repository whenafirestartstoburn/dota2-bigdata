package store

import (
	"context"
	"fmt"

	"dota2-collector/parser/internal/model"

	"github.com/jackc/pgx/v5"
)

const (
	dotaTeamRadiant = 2
	dotaTeamDire    = 3
	invHasScepter   = 1
	invHasShard     = 2
	itemMoonShard   = 247
)

func pgPlayerSlot(slot int8) (int32, bool) {
	if slot >= 0 && slot <= 4 {
		return int32(slot), true
	}
	if slot >= 5 && slot <= 9 {
		return int32(128 + int(slot) - 5), true
	}
	return 0, false
}

func captainPgSlot(id int32) (int32, bool) {
	if id < 0 {
		return 0, false
	}
	if id <= 9 {
		return pgPlayerSlot(int8(id))
	}
	if id >= 128 && id <= 132 {
		return id, true
	}
	return 0, false
}

func lastInventoryBySlot(rows []model.MetaInventory) []model.MetaInventory {
	best := make(map[int8]model.MetaInventory, len(rows))
	for _, row := range rows {
		prev, ok := best[row.Slot]
		if !ok || row.Time >= prev.Time {
			best[row.Slot] = row
		}
	}
	out := make([]model.MetaInventory, 0, len(best))
	for _, row := range best {
		out = append(out, row)
	}
	return out
}

func itemAt(ids []int32, i int) any {
	if i >= len(ids) || ids[i] <= 0 {
		return nil
	}
	return ids[i]
}

func flagSet(flags uint32, bit uint32) bool {
	return flags&bit != 0
}

func heldMoonShard(row model.MetaInventory) bool {
	for _, id := range row.ItemIDs {
		if id == itemMoonShard {
			return true
		}
	}
	for _, id := range row.BackpackItemIDs {
		if id == itemMoonShard {
			return true
		}
	}
	return false
}

func publishSeqGaps(ctx context.Context, tx pgx.Tx, res *model.Result) error {
	if err := publishCaptains(ctx, tx, res); err != nil {
		return err
	}
	return publishEndItems(ctx, tx, res)
}

func publishCaptains(ctx context.Context, tx pgx.Tx, res *model.Result) error {
	var radiantSlot, direSlot any
	for _, team := range res.MetaTeams {
		slot, ok := captainPgSlot(team.CMCaptainPlayerID)
		if !ok {
			continue
		}
		switch team.DotaTeam {
		case 0, dotaTeamRadiant:
			if radiantSlot == nil {
				radiantSlot = slot
			}
		case 1, dotaTeamDire:
			if direSlot == nil {
				direSlot = slot
			}
		}
	}
	if radiantSlot == nil && direSlot == nil {
		return nil
	}
	if _, err := tx.Exec(ctx, `
		UPDATE matches m
		SET
			radiant_captain = COALESCE(
				m.radiant_captain,
				(
					SELECT p.account_id
					FROM match_players p
					WHERE p.match_id = m.match_id
					  AND p.player_slot = $2
					  AND p.account_id > 0
				)
			),
			dire_captain = COALESCE(
				m.dire_captain,
				(
					SELECT p.account_id
					FROM match_players p
					WHERE p.match_id = m.match_id
					  AND p.player_slot = $3
					  AND p.account_id > 0
				)
			),
			updated_at = now()
		WHERE m.match_id = $1
	`, res.MatchID, radiantSlot, direSlot); err != nil {
		return fmt.Errorf("matches.captains: %w", err)
	}
	return nil
}

func publishEndItems(ctx context.Context, tx pgx.Tx, res *model.Result) error {
	for _, snap := range lastInventoryBySlot(res.MetaInventory) {
		slot, ok := pgPlayerSlot(snap.Slot)
		if !ok {
			continue
		}
		var scepter, shard, moon any
		if flagSet(snap.Flags, invHasScepter) {
			scepter = 1
		}
		if flagSet(snap.Flags, invHasShard) {
			shard = 1
		}
		if heldMoonShard(snap) {
			moon = 1
		}
		if _, err := tx.Exec(ctx, `
			UPDATE match_players SET
				item_0 = COALESCE(item_0, $3),
				item_1 = COALESCE(item_1, $4),
				item_2 = COALESCE(item_2, $5),
				item_3 = COALESCE(item_3, $6),
				item_4 = COALESCE(item_4, $7),
				item_5 = COALESCE(item_5, $8),
				backpack_0 = COALESCE(backpack_0, $9),
				backpack_1 = COALESCE(backpack_1, $10),
				backpack_2 = COALESCE(backpack_2, $11),
				item_neutral = COALESCE(item_neutral, $12),
				item_neutral2 = COALESCE(item_neutral2, $13),
				aghanims_scepter = COALESCE(aghanims_scepter, $14),
				aghanims_shard = COALESCE(aghanims_shard, $15),
				moonshard = COALESCE(moonshard, $16),
				updated_at = now()
			WHERE match_id = $1 AND player_slot = $2
		`, res.MatchID, slot,
			itemAt(snap.ItemIDs, 0), itemAt(snap.ItemIDs, 1),
			itemAt(snap.ItemIDs, 2), itemAt(snap.ItemIDs, 3),
			itemAt(snap.ItemIDs, 4), itemAt(snap.ItemIDs, 5),
			itemAt(snap.BackpackItemIDs, 0), itemAt(snap.BackpackItemIDs, 1),
			itemAt(snap.BackpackItemIDs, 2),
			nullPositive(snap.NeutralItemID),
			nullPositive(snap.NeutralEnhancementID),
			scepter, shard, moon,
		); err != nil {
			return fmt.Errorf("match_players.items: %w", err)
		}
	}
	return nil
}

func nullPositive(id int32) any {
	if id <= 0 {
		return nil
	}
	return id
}
