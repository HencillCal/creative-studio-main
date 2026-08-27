import { describe, expect, it } from "vitest";
import { HealthCheckResponse } from "./index";

describe("@workspace/api-zod", () => {
  it("HealthCheckResponse parses a valid payload", () => {
    const parsed = HealthCheckResponse.parse({ status: "ok" });
    expect(parsed.status).toBe("ok");
  });

  it("HealthCheckResponse rejects an invalid payload", () => {
    const result = HealthCheckResponse.safeParse({ status: 123 });
    expect(result.success).toBe(false);
  });
});
