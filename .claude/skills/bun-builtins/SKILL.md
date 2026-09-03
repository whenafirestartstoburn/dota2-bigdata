---
name: bun-builtins
description: >-
  Prefer Bun runtime builtins over Node wrappers and project helpers.
  Use when writing or editing TypeScript, adding delays, hashing, reading/writing
  files, spawning processes, serving HTTP, or introducing a new util in
  packages/*/src.
---

# Bun builtins

Do not wrap a Bun API in a project helper (`packages/shared/src/utils/sleep.ts`
and the like). Call the builtin at the use site.

| Need | Use | Not |
|---|---|---|
| delay | `await Bun.sleep(ms)` | `new Promise(r => setTimeout(r, ms))`, a local `sleep()` |
| race-timeout | `Bun.sleep(ms).then(() => { throw new Error(message) })` | a `sleepReject` helper |
| read file | `await Bun.file(path).text()` | `node:fs` `readFile` |
| write file | `await Bun.write(path, data)` | `node:fs` `writeFile` |
| glob | `new Bun.Glob(pattern)` | extra glob packages |
| spawn | `Bun.spawn` / `Bun.spawnSync` | `node:child_process` |
| HTTP server | `Bun.serve` | Express, Fastify, oRPC |
| argv | `Bun.argv` | `process.argv` |
| SHA / digest | `new Bun.CryptoHasher('sha1').update(data).digest('hex')` | `createHash` from `node:crypto` |

HMAC that must match a wire protocol (Steam TOTP, confirmation keys) may use
`new Bun.CryptoHasher('sha1', key)` — same class, HMAC key as the second
argument. Keep `node:crypto` only if a test proves the digest type differs.

## Leave Node APIs that have no Bun equivalent

Cancelable timers (`setTimeout` + `clearTimeout`), `node:tls`, `node:net`,
`node:readline`, `node:util` `parseArgs`, `node:async_hooks`, `node:path`
`join`, `node:events`. Do not invent a Bun-shaped wrapper around those either.

## Check before adding a util

If the next function is a one-liner over `Bun.*` or `fetch`, do not add a file
for it. Import and call the builtin.

If it is `unknown` → string/number/Date (`asText`, `asString`, `asNumber`,
`asDate`, `asIso`, `asRecord`, `errorMessage`), import from
`packages/shared/src/store/coerce.ts`. Do not copy the helper into the new
file. See the `shared-utils` skill.
