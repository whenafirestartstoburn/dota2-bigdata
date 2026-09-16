# Plan: restore seq-num details beside GC

Specs: [`docs/specs/job-graph.md`](../specs/job-graph.md),
[`docs/specs/worker-architecture.md`](../specs/worker-architecture.md),
[`docs/specs/data-schema.md`](../specs/data-schema.md).

Stream seq indexer can list a finished match before GC has the blob.
When a live match leaves GetLiveLeagueGames / GetTopLiveGame:

1. Enqueue `fetch_match_details` (GC) immediately.
2. `poll_finished_history` pages GetMatchHistory (max 100 / call) until
   the waiting ids are found or the league is exhausted.
3. On a seqnum hit, enqueue `fetch_seq_details` — one
   `GetMatchHistoryBySequenceNum` (`matches_requested = 1`) — same
   hop retry as GC (`maxAttempts` 5, `jobRetryDelayMs`). Persist the
   seq blob (`persistMatchRecord`, including captains).

- [x] Restore `matches.attempts` / `matches.next_attempt_at`
- [x] Paginate the history waiter; enqueue GC on live finish
- [x] `fetch_seq_details` + persist captains / box score
- [x] Specs, metrics, tests
