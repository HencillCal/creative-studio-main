import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

beforeAll(() => {
  // Provide a syntactically-valid connection string so the module can be
  // imported without a real database. We never actually connect.
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ||
    "postgres://test:test@127.0.0.1:5432/test";
});

afterAll(() => {
  if (ORIGINAL_DATABASE_URL === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
  }
});

describe("@workspace/db", () => {
  it("exports a drizzle `db` and a pg `pool`", async () => {
    const mod = await import("./index");
    expect(mod.db).toBeDefined();
    expect(mod.pool).toBeDefined();
    expect(typeof mod.pool.end).toBe("function");
    await mod.pool.end().catch(() => {});
  });

  it("re-exports the schema namespace", async () => {
    const schema = await import("./schema");
    expect(schema).toBeTypeOf("object");
  });

  it("throws a clear error if DATABASE_URL is missing at import time", async () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      // Re-import a fresh copy of the module so the env-var check runs again.
      vi.resetModules();
      await expect(import("./index")).rejects.toThrow(
        /DATABASE_URL must be set/,
      );
    } finally {
      process.env.DATABASE_URL = saved;
      vi.resetModules();
    }
  });
});
