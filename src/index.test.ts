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
