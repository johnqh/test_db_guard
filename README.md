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
