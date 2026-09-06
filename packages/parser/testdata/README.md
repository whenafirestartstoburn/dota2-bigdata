# Parser fixtures

Large `.dem.bz2` files are not committed.

## Attached demos

Copy the three local replays into `demos/`:

```bash
mkdir -p packages/parser/testdata/demos
cp ~/Downloads/8973166068_276401451.dem.bz2 \
   ~/Downloads/8973148550_1542608361.dem.bz2 \
   ~/Downloads/8973010350_1261045806.dem.bz2 \
   packages/parser/testdata/demos/
```

`go test` in this package parses every file in `demos/`.

## One replay per major patch

Uses Postgres `patches` + `steam_accounts` (Web API key for
GetLeagueInfoList / GetMatchHistory, GC account for replay salt):

```bash
bun run parser:fetch-patches
# bun run parser:fetch-patches -- --only 7.39,7.38
cd packages/parser && go test -count=1 -timeout 30m -run TestParseMajorPatches
```

Newest patches first. A patch is skipped when Valve already expired the
file (`replay_state` or CDN 502). Tests skip empty patch directories.
Already-`stored` S3 objects are copied into `patches/<patch>/` when the
CDN is gone. The attached TI demos can be copied under `patches/7.39/`.

Downloads are checked: `Content-Length` must match, and `bzip2 -t`
must pass for `.bz2`. Truncated CDN bodies are discarded and the next
match is tried. `7.23`, `7.28`, and `7.32` currently have no live Valve
file (every candidate 502).
