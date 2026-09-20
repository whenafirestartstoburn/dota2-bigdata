# Split catalog sync: official hourly + external CLI

- [x] Spec: `sync_catalogs` = Valve datafeed via proxy; skip unless new patch
- [x] Spec: `sync_catalogs_external_providers` = current VPK/odota, CLI only
- [x] Persist upserts only (no DELETE of the other job's rows)
- [x] Official UPDATE keeps fields the feed does not have
- [x] Hourly cron; boot still official; CLI for both
- [x] Tests + typecheck
