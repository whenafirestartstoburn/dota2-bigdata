# Plan: seq-num catch-up cursor

Specs: [`docs/specs/worker-architecture.md`](../specs/worker-architecture.md),
[`docs/specs/job-graph.md`](../specs/job-graph.md).

Safety net beside `poll_finished_history`. Walks
`GetMatchHistoryBySequenceNum` from `settings.seq_walk_cursor` (seed
`7561931158`) and upserts `league_id > 0` as a finished discovery
(persist seq blob, enqueue GC). Does not replace the live-disappear
waiter.

- [x] Specs: two identifiers, claim-on-enqueue, empty rewind
- [x] Settings migration (`seq_walk_cursor` / parallelism / start time /
      cooldown)
- [x] `walk_seq_history` dispatcher + `fetch_seq_window` worker
- [x] Roles, tasks, metrics, README
- [x] Tests

## Why claim on enqueue

If both workers only read the cursor and update it after a successful
response, they serialize: the second sees the same seqnum already
enqueued and waits. Parallelism needs the cursor to move when the
window is claimed (`+ seq_batch_size`). Success then does
`GREATEST(cursor, highest_seq)` so a late worker cannot rewind a
sibling's claim. Empty does `start_at - 2000` and sets a 1-minute
cooldown.
