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
