---
name: shared-utils
description: >-
  Do not duplicate unknown→T coercers or small helpers already in
  packages/shared/src/store/coerce.ts (asText, asString, asNumber, asDate,
  asIso, asRecord, errorMessage). Use when adding a function asText / asString
  / asNumber / asDate, mapping SQL or JSON unknown values, or introducing a
  util in packages/*/src.
---

# Shared utilities — no local copies

`packages/shared/src/store/coerce.ts` is the only place for `unknown` → scalar
coercers used when reading SQL rows, JSON envelopes, or Steam payloads.

Do not add a file-local `function asText`, `asString`, `asNumber`, `asDate`,
`asIso`, `asRecord`, `asOptionalString`, or `errorMessage`. Import:

```ts
import { asNumber, asText } from '#src/store/coerce'
// other packages:
import { asIso } from '@app/shared/src/store/coerce'
```

## Which helper

| Need | Use |
|---|---|
| finite number / numeric string / bigint | `asNumber` |
| boolean as 0/1 | `asNumeric` |
| non-empty `typeof === 'string'` only | `asString` |
| `String(value)`, empty → null (UUIDs, JSON ids) | `asText` |
| trim a string field | `asTrimmedString` |
| plain object | `asRecord` |
| `Date` or parseable string | `asDate` |
| `Date` → ISO, or non-empty string | `asIso` |
| `Error.message` | `errorMessage` / `asError` |
| Postgres int8 range | `asPgInt8` |
| Steam64 / server / lobby id (uint64 text) | `asSteamId64` |

A domain parser (`asKind` for a proxy enum, `asSecret` for Steam base64) may
stay next to its type. A second copy of `asText` may not.

## Before adding any util

1. Search `packages/shared/src` for the same shape (`asText`, `asIso`, sleep,
   JSON envelope unwrap).
2. If it already exists — import it. If it almost exists — extend `coerce.ts`
   (or the existing module) and switch callers.
3. Do not wrap `Bun.sleep` / `fetch` / `Bun.file` (see bun-builtins).

Tests for new coercers go in `packages/shared/tests/store/coerce.test.ts`.
