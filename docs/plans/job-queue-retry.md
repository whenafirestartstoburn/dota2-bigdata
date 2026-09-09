# Plan: named queues stay immediate-only

Spec: [`docs/specs/worker-architecture.md`](../specs/worker-architecture.md).

- [x] `enqueueJob`: named queue + `runAt` in the future → park as `run_scheduled_job` (no queue)
- [x] `run_scheduled_job` hops back onto the named queue at `now`
- [x] Task wrapper: thrown errors on a named queue reschedule off-queue (graphile `maxAttempts` 1 on shards)
- [x] `countJobs` counts parked hops toward the same identifier
- [x] Tests + spec
