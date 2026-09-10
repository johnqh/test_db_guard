# CLAUDE.md

## What this is

`@sudobility/test-db-guard` — the workspace-wide guard that keeps test runs off
non-localhost databases. Consumed by every `*_api` repo.

## Tech stack

TypeScript, vitest, Bun. **Zero runtime dependencies** — this is a hard
constraint. The guard must not be able to fail to install because of a
transitive dependency, and it is consumed by backend repos that must not
inherit React Native or Firebase peers.

## Structure

- `src/validate.ts` — URL parsing and the localhost rule.
- `src/index.ts` — `scrubDatabaseUrl`, `setupTestDatabase`.

## Commands

- `bun run test` — vitest, `src/**/*.test.ts`. Table-driven over accepted and
  rejected hostnames. 21 tests.
- `bun run build` — `tsc` to `dist/`.
- `bun run typecheck` — `tsc --noEmit`.

## Patterns

The check parses with `new URL()` and compares `hostname`. Never match a
prefix: real URLs start with a scheme and may carry credentials, so
`startsWith("localhost")` is false for every valid value and true for none.

`scrubDatabaseUrl()` runs before validation in `setupTestDatabase()`, so a
rejected `TEST_DATABASE_URL` cannot leave an ambient production value in place.

## Gotchas

- `new URL()` normalises IPv6 hosts to bracketed form (`[::1]`). Brackets are
  stripped before comparison so error messages read cleanly.
- The workspace's production `docker-compose` files use the host `postgres`.
  That is correctly rejected — it is not a test path.
- `tsc --noEmit` fails with TS18003 if `src/` is empty. Expected before any
  source file exists.
- **Relative imports in `src/` must carry a `.js` extension.** `tsc` emits the
  specifier verbatim, and while Bun and vite resolve extensionless paths, plain
  Node's ESM resolver does not — and vitest hands bare dependencies to Node.
  Shipping `from "./validate"` broke `import()` in every consumer while every
  local test still passed. `bun run verify:dist` loads `dist/index.js` under
  Node specifically to catch this; it runs in `prepublishOnly`.

## Related projects

Consumed by: `shapeshyft_api`, `shaperouter_api`, `sudojo_api`, `tapayoka_api`,
`whisperly_api`, `music_api`, `webgraph_api`, `mixr_api`, `sider_api`,
`mail_box_indexer`, `heavymath_indexer`, `zerodowntime/craigsnotice_api`,
`genuivo_api`, `mogulgame_api`, `svgr_api`, `testomniac_api`, `starter_api`,
`entitystarter_api`.
