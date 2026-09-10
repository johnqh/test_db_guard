# Unified Test Database Guard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it structurally impossible for a test run in any of 18 backend repos to touch a non-localhost database, and converge all 18 on one test architecture.

**Architecture:** A zero-dependency package, `@sudobility/test-db-guard`, scrubs the ambient `DATABASE_URL` and requires a `TEST_DATABASE_URL` whose parsed hostname is exactly `localhost`. Every repo runs vitest with two configs: `vitest.config.ts` excludes `**/*.db.test.ts` and is what CI runs; `vitest.db.config.ts` collects only those files and is run by hand via `bun run test:db`. DB tests are kept out of CI by collection, not by a runtime skip.

**Tech Stack:** TypeScript, Bun (package manager and script runner), vitest, PostgreSQL, Drizzle ORM.

**Spec:** `docs/superpowers/specs/2026-09-10-test-db-guard-design.md`

## Global Constraints

- Package name is exactly `@sudobility/test-db-guard`. License BUSL-1.1.
- The package has **zero runtime dependencies**. Not one.
- Environment variable is exactly `TEST_DATABASE_URL`.
- Accepted hostname is exactly `localhost`. `127.0.0.1` and `::1` are rejected.
- Accepted protocols are exactly `postgres:` and `postgresql:`.
- DB-backed test files are named `*.db.test.ts`. The suffix is the only marker.
- Exactly two test scripts per repo: `test` and `test:db`. No `test:unit`, no `test:integration`, no `test:run`.
- `bun run test:db` is **never** invoked by any CI workflow.
- Repos depend on the guard with an **exact** version (no `^`, no `~`).
- Package manager is Bun. Never npm, yarn, or pnpm.
- Commit directly on `main`. No feature branches.

---

## Phase 1 — The guard package

### Task 1: Scaffold the package

**Files:**
- Create: `/Users/johnhuang/projects/test_db_guard/package.json`
- Create: `/Users/johnhuang/projects/test_db_guard/tsconfig.json`
- Create: `/Users/johnhuang/projects/test_db_guard/.gitignore`
- Create: `/Users/johnhuang/projects/test_db_guard/vitest.config.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a buildable package rooted at `/Users/johnhuang/projects/test_db_guard`, publishable as `@sudobility/test-db-guard`, with `bun run build` emitting `dist/index.js` and `dist/index.d.ts`.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "@sudobility/test-db-guard",
  "version": "1.0.0",
  "description": "Refuses to run database tests against anything but a localhost database",
  "license": "BUSL-1.1",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "clean": "rm -rf dist",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "bun run clean && bun run test && bun run build"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.0.0"
  }
}
```

There is no `dependencies` key. That is deliberate and is a global constraint.

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 3: Write `.gitignore`**

```
node_modules
dist
*.log
```

- [ ] **Step 4: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Install and verify the toolchain runs**

```bash
cd /Users/johnhuang/projects/test_db_guard
bun install
bun run typecheck
```

Expected: `bun install` writes `bun.lock`; `typecheck` succeeds with no files to check yet.

- [ ] **Step 6: Commit**

```bash
cd /Users/johnhuang/projects/test_db_guard
git add package.json tsconfig.json .gitignore vitest.config.ts bun.lock
git commit -m "chore: scaffold @sudobility/test-db-guard"
```

---

### Task 2: URL validation

**Files:**
- Create: `/Users/johnhuang/projects/test_db_guard/src/validate.ts`
- Test: `/Users/johnhuang/projects/test_db_guard/src/validate.test.ts`

**Interfaces:**
- Consumes: Task 1's scaffold.
- Produces:
  - `class TestDatabaseUrlError extends Error` — thrown for every rejection.
  - `function validateLocalTestDbUrl(raw: string): string` — returns `raw` unchanged when valid, throws `TestDatabaseUrlError` otherwise.

- [ ] **Step 1: Write the failing test**

Write `src/validate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateLocalTestDbUrl, TestDatabaseUrlError } from "./validate";

describe("validateLocalTestDbUrl", () => {
  const accepted = [
    "postgresql://localhost:5432/app_test",
    "postgres://localhost:5432/app_test",
    "postgres://localhost/app_test",
    "postgresql://user:pass@localhost:5432/app_test",
    "postgresql://localhost:5433/anything",
  ];

  it.each(accepted)("accepts %s", (url) => {
    expect(validateLocalTestDbUrl(url)).toBe(url);
  });

  const rejected: Array<[string, string]> = [
    ["postgresql://127.0.0.1:5432/app_test", "127.0.0.1"],
    ["postgresql://[::1]:5432/app_test", "::1"],
    ["postgresql://db.prod.aws.com:5432/main", "db.prod.aws.com"],
    ["postgresql://user:pass@db.prod.aws.com/main", "db.prod.aws.com"],
    ["postgresql://postgres:5432/app_test", "postgres"],
    ["postgresql://testbed.prod.internal/latest_events", "testbed.prod.internal"],
  ];

  it.each(rejected)("rejects %s naming the host", (url, host) => {
    expect(() => validateLocalTestDbUrl(url)).toThrow(TestDatabaseUrlError);
    expect(() => validateLocalTestDbUrl(url)).toThrow(host);
  });

  it("rejects a non-postgres protocol", () => {
    expect(() => validateLocalTestDbUrl("mysql://localhost:3306/app_test")).toThrow(
      TestDatabaseUrlError
    );
  });

  it("rejects an unparseable value", () => {
    expect(() => validateLocalTestDbUrl("localhost:5432/app_test")).toThrow(
      TestDatabaseUrlError
    );
  });

  it("rejects a bare hostname that is not a URL", () => {
    expect(() => validateLocalTestDbUrl("localhost")).toThrow(TestDatabaseUrlError);
  });
});
```

Note the `postgresql://postgres:5432/app_test` case: `postgres` is the Docker
Compose service hostname used in this workspace's production compose files.
It must be rejected.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/johnhuang/projects/test_db_guard
bun run test
```

Expected: FAIL — `Failed to resolve import "./validate"`.

- [ ] **Step 3: Write the implementation**

Write `src/validate.ts`:

```ts
const LOCAL_HOSTNAME = "localhost";
const ALLOWED_PROTOCOLS = new Set(["postgres:", "postgresql:"]);

/** Thrown for every rejected database URL. */
export class TestDatabaseUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestDatabaseUrlError";
  }
}

/**
 * Returns the URL unchanged if it points at a local postgres, throws otherwise.
 *
 * The check parses rather than matching a prefix: real URLs carry a scheme and
 * may carry credentials, so `startsWith("localhost")` is false for every valid
 * value. What matters is the host component alone.
 */
export function validateLocalTestDbUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new TestDatabaseUrlError(
      `TEST_DATABASE_URL is not a valid URL: ${raw}`
    );
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new TestDatabaseUrlError(
      `TEST_DATABASE_URL must use postgres:// or postgresql://, got "${parsed.protocol}"`
    );
  }

  // URL normalises an IPv6 host to bracketed form; strip for a readable message.
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (hostname !== LOCAL_HOSTNAME) {
    throw new TestDatabaseUrlError(
      `Refusing to run database tests against host "${hostname}". ` +
        `TEST_DATABASE_URL must point at localhost, e.g. postgresql://localhost:5432/myapp_test`
    );
  }

  return raw;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/johnhuang/projects/test_db_guard
bun run test
```

Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/johnhuang/projects/test_db_guard
git add src/validate.ts src/validate.test.ts
git commit -m "feat: validate a test database URL points at localhost"
```

---

### Task 3: Environment entry points

**Files:**
- Create: `/Users/johnhuang/projects/test_db_guard/src/index.ts`
- Test: `/Users/johnhuang/projects/test_db_guard/src/index.test.ts`

**Interfaces:**
- Consumes: `validateLocalTestDbUrl`, `TestDatabaseUrlError` from Task 2.
- Produces:
  - `function scrubDatabaseUrl(): void` — deletes `process.env.DATABASE_URL`.
  - `function setupTestDatabase(): string` — scrubs, requires and validates `TEST_DATABASE_URL`, assigns `process.env.DATABASE_URL`, returns the URL. Throws `TestDatabaseUrlError` on any failure.
  - Re-exports `validateLocalTestDbUrl` and `TestDatabaseUrlError`.

- [ ] **Step 1: Write the failing test**

Write `src/index.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { scrubDatabaseUrl, setupTestDatabase, TestDatabaseUrlError } from "./index";

const saved = { ...process.env };

beforeEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.TEST_DATABASE_URL;
});

afterEach(() => {
  process.env = { ...saved };
});

describe("scrubDatabaseUrl", () => {
  it("removes an ambient DATABASE_URL", () => {
    process.env.DATABASE_URL = "postgresql://db.prod.aws.com/main";
    scrubDatabaseUrl();
    expect(process.env.DATABASE_URL).toBeUndefined();
  });

  it("is a no-op when DATABASE_URL is already unset", () => {
    expect(() => scrubDatabaseUrl()).not.toThrow();
    expect(process.env.DATABASE_URL).toBeUndefined();
  });
});

describe("setupTestDatabase", () => {
  it("assigns DATABASE_URL from a valid TEST_DATABASE_URL", () => {
    process.env.TEST_DATABASE_URL = "postgresql://localhost:5432/app_test";
    const url = setupTestDatabase();
    expect(url).toBe("postgresql://localhost:5432/app_test");
    expect(process.env.DATABASE_URL).toBe("postgresql://localhost:5432/app_test");
  });

  it("discards an ambient production DATABASE_URL", () => {
    process.env.DATABASE_URL = "postgresql://db.prod.aws.com/main";
    process.env.TEST_DATABASE_URL = "postgresql://localhost:5432/app_test";
    setupTestDatabase();
    expect(process.env.DATABASE_URL).toBe("postgresql://localhost:5432/app_test");
  });

  it("throws and leaves DATABASE_URL unset when TEST_DATABASE_URL is missing", () => {
    process.env.DATABASE_URL = "postgresql://db.prod.aws.com/main";
    expect(() => setupTestDatabase()).toThrow(TestDatabaseUrlError);
    expect(process.env.DATABASE_URL).toBeUndefined();
  });

  it("names the variable in the missing-value message", () => {
    expect(() => setupTestDatabase()).toThrow("TEST_DATABASE_URL");
  });

  it("throws and leaves DATABASE_URL unset when TEST_DATABASE_URL is remote", () => {
    process.env.DATABASE_URL = "postgresql://localhost:5432/app_test";
    process.env.TEST_DATABASE_URL = "postgresql://db.prod.aws.com/main";
    expect(() => setupTestDatabase()).toThrow(TestDatabaseUrlError);
    expect(process.env.DATABASE_URL).toBeUndefined();
  });
});
```

The last case matters: a rejected `TEST_DATABASE_URL` must not leave the
previously-valid ambient value in place. Scrub happens before validation.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/johnhuang/projects/test_db_guard
bun run test
```

Expected: FAIL — `Failed to resolve import "./index"`.

- [ ] **Step 3: Write the implementation**

Write `src/index.ts`:

```ts
import { validateLocalTestDbUrl, TestDatabaseUrlError } from "./validate";

export { validateLocalTestDbUrl, TestDatabaseUrlError };

/**
 * Removes DATABASE_URL from the environment.
 *
 * Called by the unit-test setup file. Unit tests must never reach a database,
 * so rather than trusting them not to, the variable they would need is taken
 * away. A stray connection attempt then fails on a missing variable instead of
 * silently finding whatever the developer's shell had exported.
 */
export function scrubDatabaseUrl(): void {
  delete process.env.DATABASE_URL;
}

/**
 * Prepares the environment for database-backed tests.
 *
 * Scrubs the ambient DATABASE_URL first and unconditionally, so no failure path
 * below can leave a production URL reachable. Then requires TEST_DATABASE_URL,
 * validates it points at localhost, and publishes it as DATABASE_URL so
 * existing application code reads it without modification.
 */
export function setupTestDatabase(): string {
  scrubDatabaseUrl();

  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) {
    throw new TestDatabaseUrlError(
      'TEST_DATABASE_URL is required for "bun run test:db". ' +
        "Set it to a localhost database, e.g. postgresql://localhost:5432/myapp_test"
    );
  }

  const url = validateLocalTestDbUrl(raw);
  process.env.DATABASE_URL = url;
  return url;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/johnhuang/projects/test_db_guard
bun run test
```

Expected: PASS, 21 tests total (14 from validate, 7 from index).

- [ ] **Step 5: Build and confirm the emitted types**

```bash
cd /Users/johnhuang/projects/test_db_guard
bun run build
cat dist/index.d.ts
```

Expected: declarations for `scrubDatabaseUrl`, `setupTestDatabase`,
`validateLocalTestDbUrl`, `TestDatabaseUrlError`. No `dist/*.test.d.ts`.

- [ ] **Step 6: Commit**

```bash
cd /Users/johnhuang/projects/test_db_guard
git add src/index.ts src/index.test.ts
git commit -m "feat: add scrubDatabaseUrl and setupTestDatabase entry points"
```

---

### Task 4: Documentation

**Files:**
- Create: `/Users/johnhuang/projects/test_db_guard/README.md`
- Create: `/Users/johnhuang/projects/test_db_guard/CLAUDE.md`

**Interfaces:**
- Consumes: the API from Task 3.
- Produces: the adoption instructions every repo task in Phase 3 follows.

- [ ] **Step 1: Write `README.md`**

Follow the workspace README standard: package name, description,
installation, usage, API summary, dev commands, license.

````markdown
# @sudobility/test-db-guard

Refuses to run database tests against anything but a localhost database.

Backend services read `DATABASE_URL`. So do their tests. A developer with
`DATABASE_URL` exported in their shell — pointing at production — runs the
suite against production, and suites truncate tables. This package removes the
possibility.

## Installation

```bash
bun add -d -E @sudobility/test-db-guard
```

Pin the exact version. This is a safety check; it should not float.

## Usage

Two setup files, one per test script.

```ts
// tests/setup.ts — loaded by `bun run test`
import { scrubDatabaseUrl } from "@sudobility/test-db-guard";
scrubDatabaseUrl();
```

```ts
// tests/setup.db.ts — loaded by `bun run test:db`
import { setupTestDatabase } from "@sudobility/test-db-guard";
setupTestDatabase();
```

Name database-backed test files `*.db.test.ts`. `vitest.config.ts` excludes
them; `vitest.db.config.ts` collects only them.

## API

| Export | Behavior |
|---|---|
| `scrubDatabaseUrl()` | Deletes `process.env.DATABASE_URL`. |
| `setupTestDatabase()` | Scrubs, then requires `TEST_DATABASE_URL`, validates it points at `localhost`, assigns `DATABASE_URL`, returns it. Throws otherwise. |
| `validateLocalTestDbUrl(raw)` | Returns `raw` if valid, throws otherwise. |
| `TestDatabaseUrlError` | Thrown for every rejection. |

A URL is accepted only when it parses, its protocol is `postgres:` or
`postgresql:`, and its hostname is exactly `localhost`. `127.0.0.1` and `::1`
are rejected.

## Development

```bash
bun install
bun run test
bun run build
```

## License

BUSL-1.1
````

- [ ] **Step 2: Write `CLAUDE.md`**

Follow the workspace CLAUDE.md standard: tech stack, structure, commands with
test info inline, patterns, gotchas, related projects.

````markdown
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
  rejected hostnames.
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

## Related projects

Consumed by: `shapeshyft_api`, `shaperouter_api`, `sudojo_api`, `tapayoka_api`,
`whisperly_api`, `music_api`, `webgraph_api`, `mixr_api`, `sider_api`,
`mail_box_indexer`, `heavymath_indexer`, `zerodowntime/craigsnotice_api`,
`genuivo_api`, `mogulgame_api`, `svgr_api`, `testomniac_api`, `starter_api`,
`entitystarter_api`.
````

- [ ] **Step 3: Commit**

```bash
cd /Users/johnhuang/projects/test_db_guard
git add README.md CLAUDE.md
git commit -m "docs: add README and CLAUDE.md"
```

---

### Task 5: Publish via CI

**Files:**
- Create: `/Users/johnhuang/projects/test_db_guard/.github/workflows/ci-cd.yml`
- Modify: `/Users/johnhuang/projects/test_db_guard/package.json` (version)

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: `@sudobility/test-db-guard@1.0.1` on npm, installable by every repo in Phase 2 and Phase 3.

Publishing goes through the workspace's shared GitHub Actions pipeline, not a
local `npm publish`. The workflow delegates to `johnqh/workflows`
`unified-cicd.yml`, matching `di` and 125 other repos.

- [ ] **Step 1: Verify the package contents**

```bash
cd /Users/johnhuang/projects/test_db_guard
bun run clean && bun run test && bun run build
npm pack --dry-run
```

Expected: the tarball lists only `dist/` files, `package.json`, `README.md`.
No `src/`, no tests.

- [ ] **Step 2: Confirm zero runtime dependencies**

```bash
cd /Users/johnhuang/projects/test_db_guard
node -pe "JSON.stringify(require('./package.json').dependencies ?? null)"
```

Expected: `null`. If this prints an object, stop — a global constraint is
violated.

- [ ] **Step 3: Add the CI/CD workflow**

Copy the shape used by `di`:

```yaml
---
# CI/CD workflow for test_db_guard
# Automatically publishes to NPM when NPM_TOKEN is configured

name: CI/CD

on:
  push:
    branches:
      - main
      - develop
  pull_request:
    branches:
      - main
      - develop

permissions:
  contents: write      # For creating GitHub releases
  id-token: write      # For NPM provenance
  deployments: write   # For deployment tracking

jobs:
  cicd:
    uses: johnqh/workflows/.github/workflows/unified-cicd.yml@main
    with:
      npm-access: "public"
    secrets: inherit  # Pass all repository secrets
```

`bun.lock` must be committed. Without it `unified-cicd` detects the wrong
package manager and runs `npm ci`, which re-resolves the whole tree.

- [ ] **Step 4: Create the GitHub repo and push**

```bash
cd /Users/johnhuang/projects/test_db_guard
git branch -M main
gh repo create johnqh/test_db_guard --public --source=. --remote=origin \
  --description "Refuses to run database tests against anything but a localhost database"
git push -u origin main
```

The branch must be `main`. `git init` defaults to `master`, and the workflow
triggers on `main` and `develop` only — on `master` it never fires.

- [ ] **Step 5: Add the NPM_TOKEN secret**

```bash
gh secret set NPM_TOKEN --repo johnqh/test_db_guard --body "$(grep '//registry.npmjs.org/:_authToken=' ~/.npmrc | sed 's|.*_authToken=||' | tr -d '\r\n')"
gh secret list --repo johnqh/test_db_guard
```

Expected: `NPM_TOKEN` listed.

- [ ] **Step 6: Bump the version and push to trigger a publish**

A CI run that completed before the secret existed will have succeeded while
silently skipping the publish step — the workflow only publishes when
`NPM_TOKEN` is present. Check first:

```bash
gh run list --repo johnqh/test_db_guard --limit 3
npm view @sudobility/test-db-guard version
```

If the run succeeded but npm 404s, bump the patch version, commit, and push.

- [ ] **Step 7: Wait for the registry**

```bash
for i in $(seq 1 18); do
  v=$(npm view @sudobility/test-db-guard version 2>/dev/null)
  [ -n "$v" ] && { echo "PUBLISHED: $v"; break; }
  sleep 20
done
```

Publication is not instant. Do not start Phase 2 until this prints a version.

- [ ] **Step 8: Verify it installs from the registry**

```bash
cd /private/tmp/claude-501/-Users-johnhuang-projects/d8271ec7-a240-475a-9e40-3a047787aed2/scratchpad
mkdir -p guard-install-check && cd guard-install-check
bun init -y >/dev/null 2>&1
bun add -E @sudobility/test-db-guard
node -e "import('@sudobility/test-db-guard').then(m => console.log(Object.keys(m).sort().join(',')))"
```

Expected: `TestDatabaseUrlError,scrubDatabaseUrl,setupTestDatabase,validateLocalTestDbUrl`

---

## Phase 2 — Reference implementation

`shapeshyft_api` goes first and alone. It is the only repo that exercises every
part of the migration: a vitest unit suite, a `bun:test` integration suite, a
`bunfig.toml` to delete, a tracked `.env.test`, and a `scripts/setup-test-db.sh`
helper. Whatever is learned here is what Phase 3 repeats 17 times.

### Task 6: shapeshyft_api — the canonical shape

**Files:**
- Create: `/Users/johnhuang/projects/shapeshyft_api/vitest.config.ts`
- Create: `/Users/johnhuang/projects/shapeshyft_api/vitest.db.config.ts`
- Create: `/Users/johnhuang/projects/shapeshyft_api/tests/setup.db.ts`
- Modify: `/Users/johnhuang/projects/shapeshyft_api/tests/setup.ts` (replace wholesale)
- Modify: `/Users/johnhuang/projects/shapeshyft_api/package.json` (scripts, devDependencies)
- Modify: `/Users/johnhuang/projects/shapeshyft_api/.env.test`
- Delete: `/Users/johnhuang/projects/shapeshyft_api/bunfig.toml`
- Rename: `tests/ai.test.ts`, `tests/analytics.test.ts`, `tests/endpoints.test.ts`, `tests/keys.test.ts`, `tests/projects.test.ts`, `tests/provider-sync.test.ts` → `*.db.test.ts`

**Interfaces:**
- Consumes: `scrubDatabaseUrl`, `setupTestDatabase` from `@sudobility/test-db-guard@1.0.1`.
- Produces: the canonical file set that Tasks 7-23 replicate — `vitest.config.ts`, `vitest.db.config.ts`, `tests/setup.ts`, `tests/setup.db.ts`, two package scripts.

- [ ] **Step 1: Install the guard**

```bash
cd /Users/johnhuang/projects/shapeshyft_api
bun add -d -E @sudobility/test-db-guard
```

Verify the dependency is pinned exactly — no leading `^`:

```bash
node -pe "require('./package.json').devDependencies['@sudobility/test-db-guard']"
```

Expected: `1.0.1`

- [ ] **Step 2: Rename the database-backed test files**

The six files directly under `tests/` are the integration suite; everything in
`tests/unit/` is not.

```bash
cd /Users/johnhuang/projects/shapeshyft_api
for f in ai analytics endpoints keys projects provider-sync; do
  git mv "tests/$f.test.ts" "tests/$f.db.test.ts"
done
git status --short
```

Expected: six renames, nothing else.

- [ ] **Step 3: Migrate those files from `bun:test` to `vitest`**

```bash
cd /Users/johnhuang/projects/shapeshyft_api
sed -i '' 's/from "bun:test"/from "vitest"/' tests/*.db.test.ts
grep -rn "bun:test" tests/ || echo "no bun:test imports remain"
```

Then check for the one incompatibility that `sed` cannot handle:

```bash
grep -rnE "\b(mock|spyOn)\(" tests/*.db.test.ts || echo "no bun mocking to convert"
```

For each hit, convert by hand: `mock(fn)` → `vi.fn(fn)`, `spyOn(obj, "m")` →
`vi.spyOn(obj, "m")`, and add `vi` to the `vitest` import list in that file.

- [ ] **Step 4: Replace `tests/setup.ts`**

The current file sets `DATABASE_URL` only when unset, which is the bug. Replace
the whole file with:

```ts
/**
 * Unit-test setup. Loaded by `bun run test` — the script CI runs.
 *
 * No database is reachable from here: the guard deletes DATABASE_URL, and
 * vitest.config.ts excludes every *.db.test.ts file from collection. Both, so
 * that neither alone is load-bearing.
 */
import { scrubDatabaseUrl } from "@sudobility/test-db-guard";

process.env.NODE_ENV = "test";

scrubDatabaseUrl();

process.env.ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.FIREBASE_PROJECT_ID = "test-project";
process.env.FIREBASE_CLIENT_EMAIL = "test@test-project.iam.gserviceaccount.com";
process.env.FIREBASE_PRIVATE_KEY = "test-private-key";
```

Note the assignments are now unconditional. The `if (!process.env.X)` guards
are gone: tests define their environment, they do not inherit it.

- [ ] **Step 5: Create `tests/setup.db.ts`**

```ts
/**
 * Database-test setup. Loaded by `bun run test:db` only — never by CI.
 *
 * Throws unless TEST_DATABASE_URL names a localhost database, then publishes it
 * as DATABASE_URL for the application code to read.
 */
import { setupTestDatabase } from "@sudobility/test-db-guard";

process.env.NODE_ENV = "test";

setupTestDatabase();

process.env.ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.FIREBASE_PROJECT_ID = "test-project";
process.env.FIREBASE_CLIENT_EMAIL = "test@test-project.iam.gserviceaccount.com";
process.env.FIREBASE_PRIVATE_KEY = "test-private-key";
```

- [ ] **Step 6: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    // Database-backed suites are never collected here. This is what keeps CI
    // off a database — not a runtime skip inside the tests.
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.db.test.ts"],
  },
});
```

- [ ] **Step 7: Create `vitest.db.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.db.ts"],
    include: ["**/*.db.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // One database, shared across files. Parallel files corrupt each other.
    fileParallelism: false,
  },
});
```

- [ ] **Step 8: Rewrite the test scripts**

In `package.json`, replace the `test`, `test:watch`, `test:integration`, and
`test:setup` entries with exactly:

```json
    "test": "vitest run",
    "test:watch": "vitest",
    "test:db": "vitest run --config vitest.db.config.ts",
    "test:db:setup": "./scripts/setup-test-db.sh"
```

`test:integration` is gone. `test:setup` is renamed to `test:db:setup` so the
database-related scripts sort together.

- [ ] **Step 9: Delete `bunfig.toml`**

```bash
cd /Users/johnhuang/projects/shapeshyft_api
git rm bunfig.toml
```

Its `preload` pointed at `tests/setup.ts` for the `bun test` integration run.
That run no longer exists — `test:db` is vitest, and vitest loads the setup file
from `vitest.db.config.ts`.

- [ ] **Step 10: Update `.env.test`**

The file is tracked in git. Replace `DATABASE_URL` with `TEST_DATABASE_URL`:

```
# Loaded by `bun run test:db`. Committed deliberately: no secrets here, and a
# fresh clone should be able to run the database suite with no setup step.
TEST_DATABASE_URL=postgresql://localhost:5432/shapeshyft_test
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
FIREBASE_PROJECT_ID=test-project
FIREBASE_CLIENT_EMAIL=test@test-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY=test-private-key
NODE_ENV=test
```

- [ ] **Step 11: Verify — CI safety**

This is the check the whole plan exists for.

```bash
cd /Users/johnhuang/projects/shapeshyft_api
env -u TEST_DATABASE_URL DATABASE_URL=postgresql://fake-prod.example.com/main \
  bun run test
```

Expected: PASS. Read the file list vitest prints and confirm **no `.db.test.ts`
file appears**. A green run that collected nothing looks identical to a correct
one, so assert on the collected count, not the exit code:

```bash
env -u TEST_DATABASE_URL DATABASE_URL=postgresql://fake-prod.example.com/main \
  bun run test 2>&1 | grep -E "Test Files|db\.test\.ts"
```

Expected: a `Test Files N passed` line with N ≥ 15, and no `db.test.ts` match.

- [ ] **Step 12: Verify — the database suite runs against localhost**

```bash
cd /Users/johnhuang/projects/shapeshyft_api
bun run test:db:setup
TEST_DATABASE_URL=postgresql://localhost:5432/shapeshyft_test bun run test:db
```

Expected: PASS, six files collected, all named `*.db.test.ts`.

- [ ] **Step 13: Verify — the database suite refuses production**

```bash
cd /Users/johnhuang/projects/shapeshyft_api
TEST_DATABASE_URL=postgresql://db.prod.aws.com:5432/main bun run test:db
```

Expected: FAIL before any test runs, with
`Refusing to run database tests against host "db.prod.aws.com"`.

And with the variable absent entirely:

```bash
cd /Users/johnhuang/projects/shapeshyft_api
env -u TEST_DATABASE_URL bun run test:db
```

Expected: FAIL with `TEST_DATABASE_URL is required for "bun run test:db"`.

- [ ] **Step 14: Update CLAUDE.md**

In the Commands section, replace the test entries with:

```markdown
- `bun run test` — vitest, unit only. Never touches a database; this is what CI runs.
- `bun run test:db` — vitest, database suites (`*.db.test.ts`) only. **Manual — never run in CI.**
  Requires `TEST_DATABASE_URL` pointing at localhost; refuses any other host.
- `bun run test:db:setup` — creates the local `shapeshyft_test` database.
```

- [ ] **Step 15: Commit**

```bash
cd /Users/johnhuang/projects/shapeshyft_api
git add -A
git commit -m "test: split db tests from unit tests behind a localhost guard

Database-backed suites are renamed *.db.test.ts and collected only by
vitest.db.config.ts, so \`bun run test\` cannot reach a database in CI.
\`bun run test:db\` requires TEST_DATABASE_URL and refuses any host but
localhost.

Replaces the previous setup, which set DATABASE_URL only when unset --
so an exported production URL won -- and which never ran at all, because
bunfig.toml preload is Bun test-runner config and the test script is
vitest."
```

---

## Phase 3 — Rollout

### The adoption procedure

Tasks 7-23 each apply the procedure below. It is written out once, in full,
because the goal of this phase is that all 18 repos end up *identical* — and
seventeen hand-copied variants of a sixty-line block is how they drift apart
again. Each task states its own substitutions and its own deltas; where a task
lists a delta, the delta wins over the template.

Two substitutions per repo:

- `<REPO>` — the absolute repo path.
- `<DBNAME>` — the local test database name.

**P1. Install the guard, pinned exactly.**

```bash
cd <REPO> && bun add -d -E @sudobility/test-db-guard
node -pe "require('./package.json').devDependencies['@sudobility/test-db-guard']"
```
Expected: `1.0.1` with no `^`.

**P2. Classify the test files.** A test file is database-backed if it reaches a
real connection — directly, or through a helper such as `tests/setup.ts`,
`tests/utils/test-db.ts`, or an imported `createDb`/`getDb`/`initDb`/`resetDb`.

```bash
cd <REPO>
grep -rlE "DATABASE_URL|createDb|getDb\(|initDb|resetDb|drizzle\(|from \"postgres\"" \
  --include='*.test.ts' --exclude-dir=node_modules . | sort
```

The grep is a starting list, not the answer: it misses files that reach a
database transitively and flags files that only import a type. Open each
candidate and confirm. Files that mock the database layer entirely are **not**
database-backed and keep their `.test.ts` name.

**P3. Rename each database-backed file** with `git mv`, `foo.test.ts` →
`foo.db.test.ts`. For files already named `*.integration.test.ts`, the result is
`foo.db.test.ts` — drop `integration`, do not stack the two markers.

**P4. Migrate `bun:test` imports to `vitest`** in every test file in the repo:

```bash
cd <REPO>
grep -rl 'from "bun:test"' --include='*.ts' --exclude-dir=node_modules . \
  | xargs -r sed -i '' 's/from "bun:test"/from "vitest"/'
grep -rn "bun:test" --include='*.ts' --exclude-dir=node_modules . \
  || echo "no bun:test imports remain"
```

Then convert the mocking API by hand — `sed` cannot do this part:

```bash
grep -rnE "\b(mock|spyOn)\(" --include='*.test.ts' --exclude-dir=node_modules . \
  || echo "no bun mocking to convert"
```

`mock(fn)` → `vi.fn(fn)`; `spyOn(o, "m")` → `vi.spyOn(o, "m")`; add `vi` to that
file's `vitest` import.

**P5. Write `tests/setup.ts`.** Keep whatever non-database environment the repo's
existing setup file defined, but make every assignment unconditional — drop all
`if (!process.env.X)` and `process.env.X || "..."` forms.

```ts
/**
 * Unit-test setup. Loaded by `bun run test` — the script CI runs.
 *
 * No database is reachable from here: the guard deletes DATABASE_URL, and
 * vitest.config.ts excludes every *.db.test.ts file from collection.
 */
import { scrubDatabaseUrl } from "@sudobility/test-db-guard";

process.env.NODE_ENV = "test";

scrubDatabaseUrl();

// ...repo's own test environment, assigned unconditionally...
```

**P6. Write `tests/setup.db.ts`** — the same environment, with the guard swapped:

```ts
/**
 * Database-test setup. Loaded by `bun run test:db` only — never by CI.
 */
import { setupTestDatabase } from "@sudobility/test-db-guard";

process.env.NODE_ENV = "test";

setupTestDatabase();

// ...same repo environment as tests/setup.ts...
```

**P7. Write `vitest.config.ts`.** If one exists, add `setupFiles` and `exclude`
to it and keep everything already there.

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.db.test.ts"],
  },
});
```

**P8. Write `vitest.db.config.ts`.**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.db.ts"],
    include: ["**/*.db.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    fileParallelism: false,
  },
});
```

**P9. Rewrite the scripts** so exactly these two exist, plus a watch:

```json
    "test": "vitest run",
    "test:watch": "vitest",
    "test:db": "vitest run --config vitest.db.config.ts"
```

Delete `test:unit`, `test:integration`, `test:run`, `test:ci`, and any other
test script the task does not explicitly keep.

**P10. Delete `bunfig.toml`** if it exists and contains only `[test]`
configuration. If it contains anything else, delete only the `[test]` and
`[test.env]` blocks.

**P11. Write `.env.test`**, committed, with dummy values:

```
# Loaded by `bun run test:db`. Committed deliberately: no secrets here.
TEST_DATABASE_URL=postgresql://localhost:5432/<DBNAME>
NODE_ENV=test
```

If `.gitignore` excludes `.env.test`, remove that line.

**P12. Verify — CI safety.** The check this plan exists for:

```bash
cd <REPO>
env -u TEST_DATABASE_URL DATABASE_URL=postgresql://fake-prod.example.com/main \
  bun run test 2>&1 | grep -E "Test Files|db\.test\.ts"
```
Expected: a `Test Files N passed` line, and **no `db.test.ts` match**. Confirm N
matches the repo's pre-migration unit count — a suite that silently collected
nothing also exits zero.

**P13. Verify — the database suite runs, and refuses production.**

```bash
cd <REPO>
createdb <DBNAME> 2>/dev/null || true
TEST_DATABASE_URL=postgresql://localhost:5432/<DBNAME> bun run test:db
TEST_DATABASE_URL=postgresql://db.prod.aws.com:5432/main bun run test:db
env -u TEST_DATABASE_URL bun run test:db
```
Expected: pass; then fail naming `db.prod.aws.com`; then fail naming
`TEST_DATABASE_URL`.

**P14. Update CLAUDE.md** Commands section:

```markdown
- `bun run test` — vitest, unit only. Never touches a database; this is what CI runs.
- `bun run test:db` — vitest, database suites (`*.db.test.ts`) only. **Manual — never run in CI.**
  Requires `TEST_DATABASE_URL` pointing at localhost; refuses any other host.
```

**P15. Commit** on `main`:

```bash
cd <REPO>
git add -A
git commit -m "test: split db tests from unit tests behind a localhost guard"
```

---

### Task 7: shaperouter_api

`<DBNAME>` = `shaperouter_test`. The twin of `shapeshyft_api` — same fork, same
layout. Run the full procedure.

**Deltas:**
- DB files are the six directly under `tests/`: `ai`, `analytics`, `endpoints`, `keys`, `projects`, `provider-sync`. Everything in `tests/unit/` stays.
- 6 files import `bun:test` (P4 applies).
- `.env.test` is tracked already; edit in place.
- Keep `scripts/setup-test-db.sh`, exposed as `"test:db:setup"`.
- `bunfig.toml` is `[test]`-only — delete it.

- [ ] P1 install · [ ] P2-P3 classify + rename · [ ] P4 bun:test → vitest · [ ] P5-P6 setup files · [ ] P7-P8 configs · [ ] P9 scripts · [ ] P10 delete bunfig · [ ] P11 .env.test · [ ] P12 CI-safety check · [ ] P13 db checks · [ ] P14 CLAUDE.md · [ ] P15 commit

---

### Task 8: sudojo_api

`<DBNAME>` = `sudojo_test`.

**Deltas:**
- 10 files import `bun:test` — the largest migration outside `sider_api`. P4 needs care.
- DB suites are the directories named in the current `test:integration` script: `tests/levels`, `tests/boards`, `tests/techniques`, `tests/learning`, `tests/dailies`, `tests/challenges`, `tests/auth`, `tests/solver`. Every `*.test.ts` under those is database-backed.
- Delete the `test -f .env.test || (echo ... && exit 1)` shell guard — `setupTestDatabase()` replaces it, and with `.env.test` committed the file is always present.
- `bunfig.toml` has `[test]` and `[test.env] file = ".env.test"`. Delete the file; vitest reads `.env.test` via the setup file, not via Bun.
- `.env.test` is **not** tracked. Create and commit it, and remove the ignore line.

- [ ] P1 · [ ] P2-P3 · [ ] P4 · [ ] P5-P6 · [ ] P7-P8 · [ ] P9 (drop `test:unit`, `test:integration`) · [ ] P10 · [ ] P11 (new tracked file) · [ ] P12 · [ ] P13 · [ ] P14 · [ ] P15

---

### Task 9: tapayoka_api

`<DBNAME>` = `tapayoka_test`.

**Deltas:**
- No `bun:test` imports; skip P4.
- `bunfig.toml` preload is genuinely dead — no `bun test` script exists. Delete.
- `.env.test` is tracked; edit in place.
- Current script is `vitest run tests/` with no config file; P7 creates one.

- [ ] P1 · [ ] P2-P3 · [ ] P5-P6 · [ ] P7-P8 · [ ] P9 · [ ] P10 · [ ] P11 · [ ] P12 · [ ] P13 · [ ] P14 · [ ] P15

---

### Task 10: whisperly_api

`<DBNAME>` = `whisperly_test`.

**Deltas:**
- No `bun:test` imports; skip P4.
- `vitest.config.ts` **exists** and carries three `resolve.alias` mock mappings for `@sudobility/ratelimit_service`, `@sudobility/auth_service`, `@sudobility/entity_service`. P7 must preserve the whole `resolve` block, and P8's `vitest.db.config.ts` must repeat it — otherwise the database suite fails to resolve those imports.
- Current setup file uses `process.env.X || "..."` throughout; P5 makes all of it unconditional.
- `bunfig.toml` preload is dead (script is `bunx vitest`). Delete.
- Scripts `test` and `test:run` collapse into `test`.

- [ ] P1 · [ ] P2-P3 · [ ] P5-P6 · [ ] P7-P8 (**carry `resolve.alias` into both**) · [ ] P9 · [ ] P10 · [ ] P11 · [ ] P12 · [ ] P13 · [ ] P14 · [ ] P15

---

### Task 11: music_api

`<DBNAME>` = `music_test`.

**Deltas:**
- No `bun:test` imports; skip P4.
- 15 database-backed files, colocated in `src/`, already suffixed `.integration.test.ts`. Rename `X.integration.test.ts` → `X.db.test.ts`. One file, `src/services/quota.test.ts`, matched the grep — open it and confirm before renaming.
- `vitest.config.ts` **exists** with `fileParallelism: false` and a `server.deps.inline` entry for `@sudobility/consumables_service`, both with long comments explaining why. Preserve both, and repeat `server.deps.inline` in `vitest.db.config.ts`. `fileParallelism: false` moves to the db config where it belongs and can be dropped from the unit config.
- Delete the hand-rolled `.env.test` parser and the `url.includes("test")` check in `src/db/integration.test.ts`, plus the `describe.skipIf(!hasEnvTest)` wrapper — the file is now only ever collected by `test:db`, so the skip is dead weight.
- `.env.test` is not tracked. Create and commit.

- [ ] P1 · [ ] P2-P3 · [ ] P5-P6 · [ ] P7-P8 (**carry `server.deps.inline` into both**) · [ ] P9 · [ ] P11 · [ ] P12 · [ ] P13 · [ ] P14 · [ ] P15

---

### Task 12: webgraph_api

`<DBNAME>` = `webgraph_test`.

**Deltas:**
- 2 files import `bun:test`; P4 applies.
- DB files are all six under `tests/integration/`. Rename to `tests/integration/*.db.test.ts` — keep the directory, the suffix is what matters.
- Script is `bun test src`; there is no `bunfig.toml` to delete.
- **Delete `.github/workflows/integration.yml` entirely**, including its Postgres service container. This is the only CI job in the workspace that runs database tests, and the requirement is that none do.
- P12's collected count must include `src/**` tests, which the current `bun test src` script covers and the new `include` glob preserves.

- [ ] P1 · [ ] P2-P3 · [ ] P4 · [ ] P5-P6 · [ ] P7-P8 · [ ] P9 (drop `test:integration`) · [ ] **Delete `.github/workflows/integration.yml`** · [ ] P11 · [ ] P12 · [ ] P13 · [ ] P14 · [ ] P15

---

### Task 13: mixr_api

`<DBNAME>` = `mixr_test`.

**Deltas:**
- No `bun:test` imports; skip P4.
- DB files: `src/auth.integration.test.ts`, `src/integration.test.ts` → `src/auth.db.test.ts`, `src/db.test.ts`. Check `run-integration-tests.sh` at the repo root — if it only orchestrates the old `test:integration` script, delete it; if it also provisions a database, keep it as `test:db:setup`.
- `drizzle.config.ts` reads `DATABASE_URL`. Leave it alone — it is tooling, not a test.
- No `vitest.config.ts`; P7 creates one.

- [ ] P1 · [ ] P2-P3 · [ ] P5-P6 · [ ] P7-P8 · [ ] P9 (drop `test:integration`) · [ ] P11 · [ ] P12 · [ ] P13 · [ ] P14 · [ ] P15

---

### Task 14: sider_api

`<DBNAME>` = `sider_test`. **The largest task in the plan.** Do it alone, and do
not batch it with another repo.

**Deltas:**
- **51 files import `bun:test`.** P4's `sed` handles the import line; the mocking conversion is manual and is where regressions will come from. Before starting, record the baseline:

```bash
cd /Users/johnhuang/projects/sider_api && bun test 2>&1 | tail -5
```

Write down the pass count. After migration, `bun run test` plus `bun run test:db`
must together account for every one of those tests.

- `bunfig.toml` preloads `./src/test/no-ai-calls.ts` — an unrelated guard that wraps `fetch` to refuse model-provider calls during tests. It must survive. Move it into **both** setup files:

```ts
// tests/setup.ts and tests/setup.db.ts, after the db guard call
import "../src/test/no-ai-calls";
```

Verify it still bites before deleting `bunfig.toml`: a test that fetches an
LLM provider must still fail with the file's own refusal message.

- DB files: `src/services/points.test.ts` matched the grep, but with 51 test files the grep is a weak signal here. P2's manual pass matters most in this repo.
- No `vitest.config.ts`; P7 creates one covering `src/**`.

- [ ] Record baseline pass count · [ ] P1 · [ ] P2-P3 · [ ] P4 (**51 files, manual mocking pass**) · [ ] P5-P6 (**carry `no-ai-calls` into both**) · [ ] Verify no-ai-calls still refuses · [ ] P7-P8 · [ ] P9 · [ ] P10 · [ ] P11 · [ ] P12 (**compare against baseline**) · [ ] P13 · [ ] P14 · [ ] P15

---

### Task 15: mail_box_indexer

`<DBNAME>` = `mail_box_indexer_test`.

**Deltas:**
- No `bun:test` imports; skip P4.
- `vitest.config.ts` exists and **already has `setupFiles`** — point the existing entry at the new `tests/setup.ts` rather than adding a second.
- `tests/setup.ts` exists and references `DATABASE_URL`; P5 replaces it.
- DB candidates: `tests/endpoints-integration-database.test.ts`, `tests/endpoints-templates-webhooks-integration.test.ts`, `tests/solana-event-processing-integration.test.ts`. Confirm `tests/webhook-helper.test.ts` and `tests/ponder-event-processing.test.ts` by reading them — the grep may have matched a type import.
- This is a Ponder project: `ponder.config.ts` reads `DATABASE_URL` at module load. Confirm no unit test imports it, or the scrubbed variable will surface as a Ponder config error rather than a clean skip.
- Scripts `test`, `test:unit`, `test:run`, `test:ui`, `test:coverage` collapse to `test`, `test:watch`, `test:db`.

- [ ] P1 · [ ] P2-P3 · [ ] P5-P6 · [ ] P7 (**reuse existing `setupFiles`**) · [ ] P8 · [ ] P9 · [ ] P11 · [ ] P12 · [ ] P13 · [ ] P14 · [ ] P15

---

### Task 16: zerodowntime/craigsnotice_api

`<DBNAME>` = `craigsnotice_test`. Note this repo lives inside the `zerodowntime`
repo — commit there, not in a repo of its own.

**Deltas:**
- No `bun:test` imports; skip P4.
- `tests/setup.ts` currently *exports* `db` and `resetDb`, and every test file imports them. That is why 16 files matched the grep. Split it: the environment half becomes `tests/setup.ts` / `tests/setup.db.ts` per P5/P6, and the `db`/`resetDb` exports move to a new `tests/db-helpers.ts` that the renamed `*.db.test.ts` files import. A vitest `setupFiles` module's exports are not importable by tests, so leaving them there breaks every DB test.
- Delete the `url.includes("_test")` check and the `process.env.CI ? ... : ...` conditional URL.
- Classify carefully: files importing only environment, not `db`, are unit tests. `tests/config.test.ts` asserts on config parsing and is almost certainly a unit test despite matching the grep.
- `vitest.config.ts` exists without `setupFiles`.

- [ ] P1 · [ ] P2 (**careful: 16 grep hits, most transitive**) · [ ] Extract `tests/db-helpers.ts` · [ ] P3 · [ ] P5-P6 · [ ] P7-P8 · [ ] P9 · [ ] P11 · [ ] P12 · [ ] P13 · [ ] P14 · [ ] P15

---

### Task 17: heavymath_indexer

`<DBNAME>` = `heavymath_indexer_test`.

**Deltas:**
- No `bun:test` imports; skip P4.
- No test file matched the DB grep. P2 may find nothing to rename — that is a valid outcome. Wire the guard anyway so the convention holds and future DB tests land correctly.
- `vitest.config.ts` exists without `setupFiles`.
- Ponder project, same `ponder.config.ts` caveat as Task 15.
- Scripts `test`, `test:unit`, `test:run`, `test:ui`, `test:coverage` collapse to `test`, `test:watch`, `test:db`.
- P13 will report zero collected files for `test:db`. Confirm the *guard* still fires by running it with a production URL — the failure must occur before collection.

- [ ] P1 · [ ] P2-P3 · [ ] P5-P6 · [ ] P7-P8 · [ ] P9 · [ ] P11 · [ ] P12 · [ ] P13 (**expect zero db files; guard must still reject prod**) · [ ] P14 · [ ] P15

---

### Tasks 18-21: genuivo_api, mogulgame_api, svgr_api, testomniac_api

These four have `src/db/index.ts` but no database-backed tests yet. Each is a
separate task; run the procedure on each independently.

| Task | Repo | `<DBNAME>` | Deltas |
|---|---|---|---|
| 18 | `genuivo_api` | `genuivo_test` | No vitest config; no `bun:test`; script is `vitest run` |
| 19 | `mogulgame_api` | `mogulgame_test` | No vitest config; no `bun:test`; script is `vitest run` |
| 20 | `svgr_api` | `svgr_test` | No vitest config; no `bun:test`; 24 vitest files |
| 21 | `testomniac_api` | `testomniac_test` | Script is `bun test src tests` but the 21 test files already import `vitest` — the script is the only thing to change. Also drop `test:contract`, folding `tests/contract` into the default run. No `bunfig.toml`. |

For all four, P2 will find nothing to rename. Wire the guard, both configs, and
both setup files anyway — that is the point of doing them. P13 confirms the
guard rejects a production URL even with zero DB files collected.

- [ ] Task 18: P1 · P2-P3 · P5-P6 · P7-P8 · P9 · P11 · P12 · P13 · P14 · P15
- [ ] Task 19: P1 · P2-P3 · P5-P6 · P7-P8 · P9 · P11 · P12 · P13 · P14 · P15
- [ ] Task 20: P1 · P2-P3 · P5-P6 · P7-P8 · P9 · P11 · P12 · P13 · P14 · P15
- [ ] Task 21: P1 · P2-P3 · P5-P6 · P7-P8 · P9 (**drop `test:contract`**) · P11 · P12 · P13 · P14 · P15

---

### Tasks 22-23: the templates

Last, so forks inherit a settled convention rather than a half-migrated one.

| Task | Repo | `<DBNAME>` | Deltas |
|---|---|---|---|
| 22 | `starter_api` | `starter_test` | No vitest config; no `bun:test`; script is `vitest run` |
| 23 | `entitystarter_api` | `entitystarter_test` | Script is `bun test` but the 7 test files already import `vitest`. No `bunfig.toml`. |

Both additionally need their **README.md** updated, not just CLAUDE.md — these
are the files a new project's author reads first:

```markdown
## Testing

- `bun run test` — unit tests. Never touches a database.
- `bun run test:db` — database tests (`*.db.test.ts`). Run manually.
  Requires `TEST_DATABASE_URL` pointing at a localhost database; any other
  host is refused. Never run in CI.
```

- [ ] Task 22: P1 · P2-P3 · P5-P6 · P7-P8 · P9 · P11 · P12 · P13 · P14 · **README.md** · P15
- [ ] Task 23: P1 · P2-P3 · P5-P6 · P7-P8 · P9 · P11 · P12 · P13 · P14 · **README.md** · P15

---

## Task 24: Workspace verification

**Files:** none — this task only reads.

**Interfaces:**
- Consumes: all 18 migrated repos.
- Produces: proof that no repo can reach a database from `bun run test`.

- [ ] **Step 1: No repo still names the old variable in a test path**

```bash
cd /Users/johnhuang/projects
grep -rn "DATABASE_URL" --include='*.test.ts' --include='bunfig.toml' \
  --include='vitest*.config.ts' --exclude-dir=node_modules . | grep -v TEST_DATABASE_URL
```
Expected: no output.

- [ ] **Step 2: No `bunfig.toml` test config survives**

```bash
cd /Users/johnhuang/projects
for d in shapeshyft_api shaperouter_api sudojo_api tapayoka_api whisperly_api \
         music_api webgraph_api mixr_api sider_api mail_box_indexer \
         heavymath_indexer zerodowntime/craigsnotice_api genuivo_api \
         mogulgame_api svgr_api testomniac_api starter_api entitystarter_api; do
  [ -f "$d/bunfig.toml" ] && grep -q '\[test' "$d/bunfig.toml" && echo "LEFTOVER: $d"
done; echo done
```
Expected: `done` with no `LEFTOVER` lines.

- [ ] **Step 3: Every repo has exactly the two scripts**

```bash
cd /Users/johnhuang/projects
for d in shapeshyft_api shaperouter_api sudojo_api tapayoka_api whisperly_api \
         music_api webgraph_api mixr_api sider_api mail_box_indexer \
         heavymath_indexer zerodowntime/craigsnotice_api genuivo_api \
         mogulgame_api svgr_api testomniac_api starter_api entitystarter_api; do
  printf '%-32s %s\n' "$d" "$(node -pe "Object.keys(require('./$d/package.json').scripts).filter(k=>k.startsWith('test')).sort().join(',')")"
done
```
Expected: every row reads `test,test:db,test:watch` — plus `test:db:setup` for
`shapeshyft_api`, `shaperouter_api`, and possibly `mixr_api`.

- [ ] **Step 4: No CI workflow anywhere runs the database suite**

```bash
cd /Users/johnhuang/projects
grep -rn "test:db" --include='*.yml' --include='*.yaml' --exclude-dir=node_modules .
```
Expected: no output. If any line appears, that workflow violates the core
requirement and must be fixed before this task closes.

- [ ] **Step 5: The CI-safety check passes in all 18**

```bash
cd /Users/johnhuang/projects
for d in shapeshyft_api shaperouter_api sudojo_api tapayoka_api whisperly_api \
         music_api webgraph_api mixr_api sider_api mail_box_indexer \
         heavymath_indexer zerodowntime/craigsnotice_api genuivo_api \
         mogulgame_api svgr_api testomniac_api starter_api entitystarter_api; do
  echo "=== $d"
  (cd "$d" && env -u TEST_DATABASE_URL DATABASE_URL=postgresql://fake-prod.example.com/main \
     bun run test 2>&1 | grep -E "Test Files|db\.test\.ts")
done
```
Expected: every repo prints a passing `Test Files` line and **no** repo prints a
`db.test.ts` match.

- [ ] **Step 6: Record the outcome**

Append a short results table to the spec's Verification section — one row per
repo, with its unit test count and its DB test count — so the next person can
tell at a glance whether a later change moved a file across the boundary.
