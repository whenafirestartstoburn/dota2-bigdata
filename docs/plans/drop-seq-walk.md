# Plan: GC-only match details, tier-first history walk

Specs: [`docs/specs/worker-architecture.md`](../specs/worker-architecture.md),
[`docs/specs/data-schema.md`](../specs/data-schema.md).

`GetMatchHistoryBySequenceNum` is the old Web API full-match blob. GC
`CMsgDOTAMatch` already writes the same PG columns via
`persistMatchRecord`. Valve does not send `match_seq_num` on GC (that
stays on `GetMatchHistory`). Captains / backpack / neutrals / Aghs
flags that seq named differently come from GC `item_6..8` aliases and
from replay metadata on parse.

- [x] Specs: `fetch_match_details` is GC only; history walk order is
      `tier DESC`, then newest
- [x] Drop the seq window from `runFetchMatchDetails`
- [x] Map GC backpack slots + infer Aghs; history `waiting_for = gc`
- [x] `pickNextHistoryLeague` / details enqueue: tier then recency
- [x] Parser publish: captains + last inventory snapshot → PG
- [x] Tests
