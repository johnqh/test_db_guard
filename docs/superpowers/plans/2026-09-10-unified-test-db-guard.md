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

Expected: PASS, 20 tests total.

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

### Task 5: Publish

**Files:**
- Modify: none.

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: `@sudobility/test-db-guard@1.0.0` on npm, installable by every repo in Phase 2 and Phase 3.

- [ ] **Step 1: Verify the package contents before publishing**

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

- [ ] **Step 3: Publish**

```bash
cd /Users/johnhuang/projects/test_db_guard
npm publish --access public
```

If publish fails and reports the version is taken, bump the patch version and
retry. npm reserves unpublished versions: the registry can 403 a republish
while the package still reads as 404.

- [ ] **Step 4: Verify it installs from the registry**

```bash
cd /private/tmp/claude-501/-Users-johnhuang-projects/d8271ec7-a240-475a-9e40-3a047787aed2/scratchpad
mkdir -p guard-install-check && cd guard-install-check
bun init -y >/dev/null 2>&1
bun add -E @sudobility/test-db-guard
node -e "import('@sudobility/test-db-guard').then(m => console.log(Object.keys(m).sort().join(',')))"
```

Expected: `TestDatabaseUrlError,scrubDatabaseUrl,setupTestDatabase,validateLocalTestDbUrl`

- [ ] **Step 5: Commit the lockfile if it changed**

```bash
cd /Users/johnhuang/projects/test_db_guard
git add -A && git commit -m "chore: release v1.0.0" || echo "nothing to commit"
```
