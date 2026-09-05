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

```bash
cd packages/parser
go run ./cmd/fetch-patches
go test -count=1 -timeout 30m -run TestParseMajorPatches
```

Valve expires CDN files after a few weeks (replay{cluster}.valve.net
returns 502 for anything older). The fetcher skips a patch when no URL
still serves the bytes. Tests skip empty patch directories. The attached
TI / current-patch demos are copied under `patches/7.39/` as the live
major-version fixture.
