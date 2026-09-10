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
