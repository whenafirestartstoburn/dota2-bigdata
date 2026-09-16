# Plan: history / seq independent of GC / replay

Specs: [`docs/specs/job-graph.md`](../specs/job-graph.md),
[`docs/specs/worker-architecture.md`](../specs/worker-architecture.md),
[`docs/specs/data-schema.md`](../specs/data-schema.md).

`poll_finished_history` was gated on `status = awaiting_history`. GC
`fetch_match_details` (enqueued on live finish) advances status, so the
waiter dropped the id and `seq_fetched_at` stayed null.

History listing + `fetch_seq_details` keep running until a seqnum hit or
the waiter budget, regardless of GC / replay. GC / replay already run
without waiting for seq.

- [x] Waiter predicate: armed `history_next_poll_at` and no `match_seq_num`
- [x] Timeout fails the match only while still `awaiting_history`
- [x] Run `poll_finished_history` / `fetch_seq_details` on the live role too
- [x] Specs, index, tests
