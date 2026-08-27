import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetOpsAlertRateLimitForTests,
  sendOpsAlert,
} from "./ops-alert";

vi.mock("./logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  _resetOpsAlertRateLimitForTests();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.OPS_ALERT_WEBHOOK_URL;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("sendOpsAlert", () => {
  it("returns false and does not call fetch when OPS_ALERT_WEBHOOK_URL is unset", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await sendOpsAlert("hello", { key: "k1" });
    expect(result).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts to the webhook URL with a Slack-compatible JSON body and returns true on 2xx", async () => {
    process.env.OPS_ALERT_WEBHOOK_URL = "https://hooks.example.com/abc";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));

    const result = await sendOpsAlert("something broke", { key: "k1" });

    expect(result).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://hooks.example.com/abc");
    expect(init?.method).toBe("POST");
    expect(
      (init?.headers as Record<string, string>)["content-type"],
    ).toBe("application/json");
    const body = JSON.parse(String(init?.body));
    expect(typeof body.text).toBe("string");
    expect(body.text).toContain("something broke");
  });

  it("serializes the context as a fenced JSON block in the message body", async () => {
    process.env.OPS_ALERT_WEBHOOK_URL = "https://hooks.example.com/abc";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));

    await sendOpsAlert("ctx test", {
      key: "ctx",
      context: { foo: 1, bar: "baz" },
    });

    const body = JSON.parse(String(fetchSpy.mock.calls[0]![1]?.body));
    expect(body.text).toContain("ctx test");
    expect(body.text).toContain("```");
    expect(body.text).toContain('"foo": 1');
    expect(body.text).toContain('"bar": "baz"');
  });

  it("falls back to String(context) when context is not JSON-serializable", async () => {
    process.env.OPS_ALERT_WEBHOOK_URL = "https://hooks.example.com/abc";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));

    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;

    const result = await sendOpsAlert("circ", {
      key: "circ",
      context: circular,
    });

    expect(result).toBe(true);
    const body = JSON.parse(String(fetchSpy.mock.calls[0]![1]?.body));
    expect(body.text).toContain("circ");
    expect(body.text).toContain("[object Object]");
  });

  it("rate-limits repeat sends within the cooldown window for the same key", async () => {
    process.env.OPS_ALERT_WEBHOOK_URL = "https://hooks.example.com/abc";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));

    const first = await sendOpsAlert("m1", { key: "same" });
    const second = await sendOpsAlert("m2", { key: "same" });

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("allows another send for the same key after the cooldown elapses", async () => {
    process.env.OPS_ALERT_WEBHOOK_URL = "https://hooks.example.com/abc";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));

    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000_000);
    expect(await sendOpsAlert("m1", { key: "k", rateLimitMs: 1000 })).toBe(true);

    nowSpy.mockReturnValue(1_000_500);
    expect(await sendOpsAlert("m2", { key: "k", rateLimitMs: 1000 })).toBe(false);

    nowSpy.mockReturnValue(1_002_000);
    expect(await sendOpsAlert("m3", { key: "k", rateLimitMs: 1000 })).toBe(true);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("tracks rate limits independently per key", async () => {
    process.env.OPS_ALERT_WEBHOOK_URL = "https://hooks.example.com/abc";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));

    expect(await sendOpsAlert("a1", { key: "alpha" })).toBe(true);
    expect(await sendOpsAlert("b1", { key: "beta" })).toBe(true);
    expect(await sendOpsAlert("a2", { key: "alpha" })).toBe(false);
    expect(await sendOpsAlert("b2", { key: "beta" })).toBe(false);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("returns false when the webhook responds with a non-2xx status", async () => {
    process.env.OPS_ALERT_WEBHOOK_URL = "https://hooks.example.com/abc";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", { status: 500 }),
    );

    const result = await sendOpsAlert("boom", { key: "err" });
    expect(result).toBe(false);
  });

  it("returns false when fetch rejects (e.g. abort/timeout)", async () => {
    process.env.OPS_ALERT_WEBHOOK_URL = "https://hooks.example.com/abc";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );

    const result = await sendOpsAlert("timeout", { key: "to" });
    expect(result).toBe(false);
  });

  it("aborts the request when it exceeds the timeout window", async () => {
    process.env.OPS_ALERT_WEBHOOK_URL = "https://hooks.example.com/abc";

    let observedSignal: AbortSignal | undefined;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((_url, init) => {
        observedSignal = (init as RequestInit).signal as AbortSignal;
        return new Promise((_resolve, reject) => {
          observedSignal!.addEventListener("abort", () => {
            reject(
              Object.assign(new Error("aborted"), { name: "AbortError" }),
            );
          });
        });
      });

    vi.useFakeTimers();
    const promise = sendOpsAlert("slow", { key: "slow" });
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await promise;

    expect(result).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(observedSignal?.aborted).toBe(true);
  });
});
