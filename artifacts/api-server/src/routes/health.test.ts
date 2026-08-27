import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";

describe("GET /api/healthz", () => {
  it("returns 200 with { status: 'ok' }", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("GET /api/healthz/lyrics-cache", () => {
  it("returns lyrics cache health snapshot", async () => {
    const res = await request(app).get("/api/healthz/lyrics-cache");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body).toMatchObject({
      enabled: expect.any(Boolean),
      max: expect.any(Number),
      sweepIntervalMs: expect.any(Number),
      recent: {
        sweeps: expect.any(Number),
        ttlEvicted: expect.any(Number),
        capEvicted: expect.any(Number),
        history: expect.any(Array),
      },
    });
    expect(res.body.max).toBeGreaterThan(0);
    expect(res.body.sweepIntervalMs).toBeGreaterThan(0);
  });
});

describe("unknown routes", () => {
  it("returns 404 for unknown /api paths", async () => {
    const res = await request(app).get("/api/this-route-does-not-exist");
    expect(res.status).toBe(404);
  });
});
