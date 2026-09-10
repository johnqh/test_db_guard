# Test Database Guard — Design

Date: 2026-09-10
Status: Approved, pending implementation plan

## Problem

Every backend repo in `~/projects` reads its database connection from
`DATABASE_URL`. Test runs read the same variable. A developer with
`DATABASE_URL` exported in their shell — pointing at production — runs the
test suite against production. Suites truncate tables.

The existing mitigations do not mitigate. Three distinct failures:

**1. The safe default is backwards.** The common pattern is:

```ts
// shapeshyft_api/tests/setup.ts
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://localhost:5432/shapeshyft_test";
}
```

`whisperly_api` writes the same logic as
`process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://localhost:5432/whisperly_test"`.

The localhost default applies only when the variable is *unset*. An exported
production URL wins. The one case worth defending against is the exact case
that bypasses the defense.

**2. The setup file does not run during unit tests in five repos.**
`shapeshyft_api`, `shaperouter_api`, `tapayoka_api`, and `whisperly_api`
declare `preload = ["./tests/setup.ts"]` in `bunfig.toml`; `sudojo_api`
declares `[test.env] file = ".env.test"`. Both are Bun test-runner
configuration, and all five run their default `test` script under **vitest**,
which does not read `bunfig.toml`. Four of the five have no vitest config at
all; `whisperly_api` has one with no `setupFiles`.

The nuance matters for the fix: in `shapeshyft_api`, `shaperouter_api`, and
`sudojo_api` the `bunfig.toml` wiring is **not** dead — their
`test:integration` scripts do run under `bun test`, so the preload applies
there. It is dead only for `tapayoka_api` and `whisperly_api`, which have no
`bun test` script. So these three repos need *both* wirings, not a
replacement of one by the other.

**3. Substring checks are weak.** `music_api` tests `url.includes("test")` and
`craigsnotice_api` tests `url.includes("_test")`. A production database named
`latest_events`, or a host named `testbed.prod.internal`, passes both.

## Design

### Ownership of the variable

Tests stop reading `DATABASE_URL` as an input. They read a dedicated
`TEST_DATABASE_URL`, validate it, and *assign* `DATABASE_URL` from it.

Application code is untouched. Every existing `getRequiredEnv("DATABASE_URL")`
call site keeps working, because by the time application code loads,
`DATABASE_URL` holds a validated localhost URL or nothing at all.

### Package

New repo `~/projects/test_db_guard`, published as `@sudobility/test-db-guard`,
BUSL-1.1, built with `tsc`.

**Zero runtime dependencies.** This is a hard constraint, not a preference. It
rules out hosting the guard in `@sudobility/di`, which carries React Native and
Firebase peer dependencies that backend APIs must not inherit.

Because the guard ships as a dependency, a failed or missing install must not
degrade into a silently absent guard. Each repo's setup file imports it at top
level, so a missing package is an immediate module-resolution error that fails
the run. Repos pin an exact version.

### API

```ts
setupTestDatabase(): string | null
assertLocalTestDb(): string
hasLocalTestDb(): boolean
```

`setupTestDatabase()` is what every repo's setup file calls. Three steps, in
this order:

1. **Unconditionally `delete process.env.DATABASE_URL`.** This is the core of
   the fix. The ambient value is scrubbed before anything can read it,
   independent of whether `TEST_DATABASE_URL` is set. A production URL in the
   shell cannot reach application code even in the failure paths below.
2. If `TEST_DATABASE_URL` is unset, return `null`. No database is reachable, by
   construction — not by policy.
3. If set, validate it (below). On success, assign
   `process.env.DATABASE_URL = url` and return it. On failure, throw.

`assertLocalTestDb()` is for integration suites that must not silently skip: it
throws when `TEST_DATABASE_URL` is unset rather than returning `null`.

`hasLocalTestDb()` returns a boolean for `describe.skipIf(...)` gating.

### Validation rules

A URL passes only if all hold:

- It parses with `new URL()`.
- Protocol is `postgres:` or `postgresql:`.
- **`hostname === "localhost"` exactly.**

`127.0.0.1`, `::1`, and every other host are rejected. This is the strict
reading, chosen deliberately. It was verified against every test and CI config
in the workspace: no test path uses the IP form today, so strictness costs
nothing. The only non-localhost database hosts in the workspace are in
`docker-compose.production.yml` files, which are not test paths.

Credentials and ports are irrelevant to the check — the CI URL
`postgresql://webgraph:webgraph@localhost:5432/webgraph_test` and the
port-less `postgres://localhost/craigsnotice_test` both pass, because the check
is on the parsed host component. A naive `startsWith("localhost")` would reject
both; that is why the check parses.

Error messages name the offending hostname.

### Behavior when unset

Unit suites stay green on machines with no Postgres: `setupTestDatabase()`
returns `null` and DB-backed suites skip via `hasLocalTestDb()`.

Integration entry points call `assertLocalTestDb()` and hard-fail with a
message naming the variable and a valid example. A suite that exists to
exercise the database never reports success without touching one.

## Per-repo wiring

Eighteen repos, two runners. Three repos run both and need both wirings.

### vitest — `setupFiles` in `vitest.config.ts`

**Config must be created (9):** `shapeshyft_api`, `shaperouter_api`,
`sudojo_api`, `tapayoka_api`, `mixr_api`, `genuivo_api`, `mogulgame_api`,
`starter_api`, `svgr_api`

**Config exists, `setupFiles` must be added (4):** `whisperly_api`,
`music_api`, `heavymath_indexer`, `zerodowntime/craigsnotice_api`

**Config already has `setupFiles`, point it at the guard (1):**
`mail_box_indexer`

### bun test — `preload` in `bunfig.toml`

**`bunfig.toml` must be created (3):** `testomniac_api`, `entitystarter_api`,
`webgraph_api`

**`bunfig.toml` exists (1):** `sider_api` — its preload is
`["./src/test/no-ai-calls.ts"]`, an unrelated guard that must be preserved.
Append, do not replace.

### Repos needing both wirings

`shapeshyft_api`, `shaperouter_api`, `sudojo_api` — unit runs under vitest,
`test:integration` runs under `bun test`. Their existing `bunfig.toml` entries
stay; vitest config is added alongside.

### Genuinely dead config to remove

`tapayoka_api` and `whisperly_api` have `bunfig.toml` preloads with no `bun
test` script to trigger them. Remove once vitest wiring is in place.

### Env files

Every repo commits `.env.test.example` containing a localhost
`TEST_DATABASE_URL`. `.env.test` remains gitignored. Five repos already have
`.env.test` and are migrated in place: `sudojo_api`, `music_api`,
`shapeshyft_api`, `tapayoka_api`, `shaperouter_api`.

`sudojo_api`'s `test:integration` guards on `.env.test` existing; that check is
superseded by `assertLocalTestDb()` and is removed.

## CI

`webgraph_api/.github/workflows/integration.yml` renames its injected
`DATABASE_URL` to `TEST_DATABASE_URL`. The value already uses host `localhost`
and passes strict validation unchanged. No other workflow in the workspace
injects a database URL.

## Code removed

- `if (!process.env.DATABASE_URL) { ... }` fallbacks and
  `process.env.DATABASE_URL || "..."` defaults in all setup files.
- `music_api`'s `.includes("test")` check and its hand-rolled `.env.test` parser.
- `craigsnotice_api`'s `.includes("_test")` check and its `CI`-conditional URL.
- `sudojo_api`'s `test -f .env.test ||` shell guard in `test:integration`.
- Dead `bunfig.toml` preloads in `tapayoka_api` and `whisperly_api` only.

## Verification

The package carries table-driven unit tests over hostnames, including
production-shaped URLs, the IP form, credentialed URLs, port-less URLs, and
non-postgres protocols.

Each of the 18 repos is verified twice:

1. With `TEST_DATABASE_URL` set to a localhost URL — suite passes.
2. With `TEST_DATABASE_URL` unset and
   `DATABASE_URL=postgresql://fake-prod.example.com/main` exported — the run
   must not connect to anything. This is the regression test for the original
   bug, and it is the check that would have failed before this change.

For the three dual-runner repos, both checks run against `test` *and*
`test:integration`, since the two use different runners and different wiring.

## Rollout order

1. Publish `@sudobility/test-db-guard`.
2. The 11 repos with real DB tests: `shapeshyft_api`, `shaperouter_api`,
   `sudojo_api`, `tapayoka_api`, `whisperly_api`, `music_api`, `webgraph_api`,
   `mixr_api`, `sider_api`, `mail_box_indexer`,
   `zerodowntime/craigsnotice_api`.
3. The 5 with thin or no DB tests: `genuivo_api`, `mogulgame_api`, `svgr_api`,
   `testomniac_api`, `heavymath_indexer`.
4. The 2 templates last, so forks inherit a settled convention:
   `starter_api`, `entitystarter_api`.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Accepted hosts | `localhost` only, strictly | Nothing in the workspace uses the IP form; strictness is free |
| Variable name | `TEST_DATABASE_URL` | Conventional, greppable, cannot collide with a deploy env |
| Unset behavior | Skip unit, hard-fail integration | Keeps the default `test` script green without Postgres |
| Scope | All 18, templates included | Forks inherit the guard |
| Distribution | Shared npm package | Single source of truth; bootstrap risk mitigated by top-level import and exact pinning |

## Risks

**A repo that never installs the package has no guard.** Mitigated by the
top-level import: resolution fails loudly. Not fully eliminated for a repo
nobody adds the dependency to — the rollout checklist is the control.

**Eighteen repos pin an exact version.** A guard change means 18 bumps.
Accepted in exchange for a single source of truth. Note the workspace gotcha
that npm reserves unpublished versions: a failed publish requires a patch bump
rather than a retry.

**Nine new vitest configs.** Repos that ran vitest on defaults gain a config
file. Each contains only `setupFiles` — no behavior change beyond the guard.
