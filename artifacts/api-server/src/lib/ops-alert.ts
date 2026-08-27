import { logger } from "./logger";

// Generic Slack-compatible webhook helper for surfacing background-task
// failures to a single operator channel. Posts a JSON `{text}` payload to
// `OPS_ALERT_WEBHOOK_URL` and is a no-op when that env var is unset, so it
// is safe to call from any background path without local configuration.
// Slack, Discord (with `/slack` suffix), Mattermost, Google Chat, and most
// generic incoming webhooks accept this shape, which keeps the integration
// dependency-free.
//
// Calls are rate-limited per `key` so a wedged loop (e.g. a daily scheduler
// that keeps failing) cannot spam the channel; the default cooldown is 6h
// per key, overridable via `rateLimitMs`. Note the rate-limit map lives in
// process memory only — restarts reset it, which is acceptable since the
// alert source itself is also re-evaluated on restart.

const DEFAULT_RATE_LIMIT_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

const lastSentByKey = new Map<string, number>();

export interface OpsAlertOptions {
  key: string;
  rateLimitMs?: number;
  context?: Record<string, unknown>;
}

function hostPrefix(): string {
  return (
    process.env.REPLIT_DEV_DOMAIN ??
    process.env.REPLIT_DEPLOYMENT_ID ??
    process.env.HOSTNAME ??
    "api-server"
  );
}

function formatBody(message: string, context?: Record<string, unknown>): string {
  const head = `[${hostPrefix()}] ${message}`;
  if (!context) return head;
  let serialized: string;
  try {
    serialized = JSON.stringify(context, null, 2);
  } catch {
    serialized = String(context);
  }
  return `${head}\n\`\`\`\n${serialized}\n\`\`\``;
}

export async function sendOpsAlert(
  message: string,
  opts: OpsAlertOptions,
): Promise<boolean> {
  const url = process.env.OPS_ALERT_WEBHOOK_URL;
  if (!url) {
    logger.warn(
      { key: opts.key, message },
      "OPS_ALERT_WEBHOOK_URL not set; operator alert dropped",
    );
    return false;
  }

  const interval = opts.rateLimitMs ?? DEFAULT_RATE_LIMIT_MS;
  const now = Date.now();
  const prev = lastSentByKey.get(opts.key) ?? 0;
  if (prev && now - prev < interval) {
    logger.debug(
      { key: opts.key, ageMs: now - prev, intervalMs: interval },
      "ops-alert suppressed by rate limit",
    );
    return false;
  }
  lastSentByKey.set(opts.key, now);

  const text = formatBody(message, opts.context);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      logger.error(
        { status: res.status, key: opts.key },
        "ops-alert webhook returned non-2xx",
      );
      return false;
    }
    logger.info({ key: opts.key }, "Operator alert sent");
    return true;
  } catch (err) {
    logger.error({ err, key: opts.key }, "ops-alert webhook request failed");
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Test-only: reset rate-limit state.
export function _resetOpsAlertRateLimitForTests(): void {
  lastSentByKey.clear();
}
