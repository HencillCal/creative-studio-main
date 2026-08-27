import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";

describe("POST /api/media/gif-convert", () => {
  it("returns 400 when no file is uploaded", async () => {
    const res = await request(app).post("/api/media/gif-convert");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Bad Request" });
  });
});

describe("POST /api/media/resize", () => {
  it("returns 400 when no file is uploaded", async () => {
    const res = await request(app).post("/api/media/resize");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Bad Request" });
  });
});
