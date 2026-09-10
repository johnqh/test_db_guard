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
scrubDatabaseUrl(): void
setupTestDatabase(): string
```

Two entry points, matching the two test scripts.

`scrubDatabaseUrl()` is called by the **unit** setup file. It does exactly one
thing: `delete process.env.DATABASE_URL`. Unit runs must never reach a
database, so the ambient value is removed outright. If a unit test ever does
try to open a connection, it fails on a missing variable instead of silently
finding production.

`setupTestDatabase()` is called by the **DB** setup file. In order:

1. `delete process.env.DATABASE_URL` — the ambient value is never trusted, even
   here.
2. Read `TEST_DATABASE_URL`. If unset, **throw**. There is no skip path: this
   file is only loaded by `test:db`, which exists to exercise a database.
3. Validate it (below). On failure, throw.
4. Assign `process.env.DATABASE_URL = url` and return it.

There is no `hasLocalTestDb()` and no `describe.skipIf` gating. Runtime
skipping was only needed when DB tests shared a run with unit tests; separating
the scripts removes the need. A DB test that cannot reach a database is an
error, not a skip.

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

### Test script separation

This is the structural half of the fix, and it is what keeps CI safe.

| Script | Runner config | Collects | Touches DB | Runs in CI |
|---|---|---|---|---|
| `bun run test` | `vitest.config.ts` | everything **except** `**/*.db.test.ts` | never | yes |
| `bun run test:db` | `vitest.db.config.ts` | **only** `**/*.db.test.ts` | always | **no — manual only** |

DB-backed tests are excluded from `bun run test` by *collection*, not by a
runtime skip. Vitest never loads the files, so there is no code path in which a
CI run opens a database connection. The `scrubDatabaseUrl()` call in the unit
setup is defense in depth behind that, not the primary control.

`test:db` is run by hand. It is never invoked by any workflow.

**Consequence, accepted deliberately:** CI loses database coverage entirely.
`webgraph_api` currently runs DB-backed integration tests against a Postgres
service container on every push; that workflow is removed. The tradeoff is
that database regressions are caught only when someone runs `test:db` locally.
This is the explicit instruction — no test involving a database executes during
CI/CD.

### File naming convention

A DB-backed test is named `*.db.test.ts`. The suffix, not the directory, is
what both configs key on.

Suffix rather than directory because the 18 repos have incompatible layouts —
`src/routes/*.integration.test.ts` in `music_api`, `tests/integration/` in
`webgraph_api`, `tests/*.test.ts` in `shapeshyft_api`. A suffix lets every
existing file stay where it is and be renamed, instead of forcing a
simultaneous relocation across 18 repos.

## Unified test architecture

Every one of the 18 repos converges on the same shape. No per-repo variation.

```
vitest.config.ts          exclude **/*.db.test.ts, setupFiles: tests/setup.ts
vitest.db.config.ts       include **/*.db.test.ts, setupFiles: tests/setup.db.ts
tests/setup.ts            calls scrubDatabaseUrl()
tests/setup.db.ts         calls setupTestDatabase()
.env.test                 committed; TEST_DATABASE_URL=postgresql://localhost:5432/<repo>_test
package.json
  "test":     "vitest run"
  "test:db":  "vitest run --config vitest.db.config.ts"
```

`bunfig.toml` test configuration is deleted everywhere. It is the source of the
misfires described above, and once every repo runs vitest it has no role.

### Runner unification: vitest

The workspace is already predominantly vitest — 245 test files import `vitest`
against 75 importing `bun:test`. Converging on vitest is the smaller migration
and the one that preserves the existing majority.

Files importing `bun:test` are migrated to `vitest`. Affected repos, by file
count:

| Repo | `bun:test` files | Note |
|---|---|---|
| `sider_api` | 51 | Only fully bun-native repo; the bulk of the migration |
| `sudojo_api` | 10 | Integration suites |
| `shapeshyft_api` | 6 | Integration suites |
| `shaperouter_api` | 6 | Integration suites |
| `webgraph_api` | 2 | Integration suites |

`describe`, `it`, `expect`, `beforeAll`, `afterAll`, and `beforeEach` are
import-compatible between the two. The incompatibility is mocking: Bun's
`mock()` and `spyOn()` from `bun:test` become `vi.fn()` and `vi.spyOn()` from
`vitest`. Each migrated file is checked for these.

`testomniac_api` and `entitystarter_api` run `bun test` as their script while
their test files already import from `vitest` — they need only the script
change.

### Per-repo starting state

| Repo | vitest config | Has `bun:test` | DB tests to rename |
|---|---|---|---|
| `shapeshyft_api` | none | 6 | `tests/*.test.ts` |
| `shaperouter_api` | none | 6 | `tests/*.test.ts` |
| `sudojo_api` | none | 10 | integration dirs |
| `tapayoka_api` | none | 0 | `tests/` DB suites |
| `mixr_api` | none | 0 | `tests/*.test.ts` |
| `genuivo_api` | none | 0 | none yet |
| `mogulgame_api` | none | 0 | none yet |
| `starter_api` | none | 0 | none yet |
| `svgr_api` | none | 0 | none yet |
| `whisperly_api` | exists, no `setupFiles` | 0 | `tests/` DB suites |
| `music_api` | exists, no `setupFiles` | 0 | `src/**/*.integration.test.ts` |
| `heavymath_indexer` | exists, no `setupFiles` | 0 | `**/*integration*.test.ts` |
| `craigsnotice_api` | exists, no `setupFiles` | 0 | `tests/` DB suites |
| `mail_box_indexer` | exists, has `setupFiles` | 0 | `**/*integration*.test.ts` |
| `sider_api` | none | 51 | DB-backed suites |
| `testomniac_api` | none | 0 | none yet |
| `entitystarter_api` | none | 0 | none yet |
| `webgraph_api` | none | 2 | `tests/integration/` |

`sider_api`'s `bunfig.toml` preloads `./src/test/no-ai-calls.ts`, an unrelated
guard that refuses model-provider calls during tests. That protection is
preserved by moving it into `tests/setup.ts` before `bunfig.toml` is deleted.

## CI

`webgraph_api/.github/workflows/integration.yml` is **deleted**, along with its
Postgres service container. It is the only workflow in the workspace that runs
database-backed tests, and the requirement is that none run in CI/CD.

Every repo's CI continues to run `bun run test`, which now provably collects no
DB test file.

## Code removed

- `if (!process.env.DATABASE_URL) { ... }` fallbacks and
  `process.env.DATABASE_URL || "..."` defaults in all setup files.
- `music_api`'s `.includes("test")` check and its hand-rolled `.env.test` parser.
- `craigsnotice_api`'s `.includes("_test")` check and its `CI`-conditional URL.
- `sudojo_api`'s `test -f .env.test ||` shell guard in `test:integration`.
- All `bunfig.toml` `[test]` configuration, in all repos.
- `webgraph_api/.github/workflows/integration.yml`.
- Every `test:integration`, `test:unit`, and `test:run` script, replaced by the
  two-script convention.

## Verification

The package carries table-driven unit tests over hostnames, including
production-shaped URLs, the IP form, credentialed URLs, port-less URLs, and
non-postgres protocols.

Each of the 18 repos is verified three ways:

1. `bun run test` with `DATABASE_URL=postgresql://fake-prod.example.com/main`
   exported and `TEST_DATABASE_URL` unset — passes, and collects zero
   `*.db.test.ts` files. This is the CI-safety check.
2. `bun run test:db` with `TEST_DATABASE_URL` set to a localhost URL — passes.
3. `bun run test:db` with `TEST_DATABASE_URL=postgresql://fake-prod.example.com/main`
   — fails with a message naming the host. This is the regression test for the
   original bug.

Check 1 asserts on the collected-file count, not just the exit code. A green
run that silently collected nothing would otherwise look identical to a green
run that correctly excluded DB tests.

## Rollout order

1. Publish `@sudobility/test-db-guard`.
2. `shapeshyft_api` first, as the reference implementation — it has a vitest
   unit suite, a `bun:test` integration suite, an existing `.env.test`, and a
   `bunfig.toml` to delete, so it exercises every part of the migration.
3. The remaining 10 repos with real DB tests: `shaperouter_api`, `sudojo_api`,
   `tapayoka_api`, `whisperly_api`, `music_api`, `webgraph_api`, `mixr_api`,
   `sider_api`, `mail_box_indexer`, `zerodowntime/craigsnotice_api`.
4. The 5 with thin or no DB tests: `genuivo_api`, `mogulgame_api`, `svgr_api`,
   `testomniac_api`, `heavymath_indexer`.
5. The 2 templates last, so forks inherit a settled convention:
   `starter_api`, `entitystarter_api`.

`sider_api` is sequenced late within step 3 despite having real DB tests: its
51-file `bun:test` migration is the largest single unit of work and benefits
from the pattern being settled first.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Accepted hosts | `localhost` only, strictly | Nothing in the workspace uses the IP form; strictness is free |
| Variable name | `TEST_DATABASE_URL` | Conventional, greppable, cannot collide with a deploy env |
| DB tests in CI | Never — `test:db` is manual only | Explicit requirement; enforced by collection, not by runtime skip |
| DB test marker | `*.db.test.ts` suffix | Layouts differ across repos; a suffix avoids relocating files |
| Runner | vitest everywhere | 245 vitest files vs 75 `bun:test`; smaller migration |
| Scope | All 18, templates included | Forks inherit the guard |
| Distribution | Shared npm package | Single source of truth; bootstrap risk mitigated by top-level import and exact pinning |

## Risks

**CI no longer catches database regressions.** Directly implied by the
requirement. `webgraph_api` loses the only automated DB coverage in the
workspace. Mitigation is procedural: `test:db` before releasing an API.

**A repo that never installs the package has no guard.** Mitigated by the
top-level import in `tests/setup.ts`: resolution fails loudly. The rollout
checklist is the control.

**Eighteen repos pin an exact version.** A guard change means 18 bumps.
Accepted in exchange for a single source of truth. Note the workspace gotcha
that npm reserves unpublished versions: a failed publish requires a patch bump
rather than a retry.

**`sider_api`'s 51-file migration is the single largest risk of regression.**
Its `bun:test` mocking calls have no automatic translation. Every `mock(` and
`spyOn(` occurrence is converted by hand and the suite compared against its
pre-migration pass count.
