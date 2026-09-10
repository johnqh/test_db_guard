import { validateLocalTestDbUrl, TestDatabaseUrlError } from "./validate.js";

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
