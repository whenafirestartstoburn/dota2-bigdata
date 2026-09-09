# Plan: batch ClickHouse inserts during parse

Spec: [`docs/specs/replay-parser.md`](../specs/replay-parser.md)
(Everything-or-nothing — flushed mid-decode).

- [x] Spec: batches + `Abort(parse_run_id)`; publish still Postgres
- [ ] `sink.Flusher` / per-table buffer, flush at 8192, reuse slice
- [ ] Wire extract appends through the flusher (combat / actions / intervals first)
- [ ] `handle`: on any error after the first flush, `Abort` then `Fail`
- [ ] Tests: successful parse still publishes one run; injected decode
      error after a flush leaves no published id and CH delete ran
