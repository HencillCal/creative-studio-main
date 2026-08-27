import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { logger } from "./logger";
import { sendOpsAlert } from "./ops-alert";
import { checkYtDlpFreshness } from "./yt-dlp-version-check";

// Re-run the bundled upgrade script on a weekly cadence so the YouTube
// player_client fallbacks in routes/media.ts don't go stale between manual
// maintenance windows. yt-dlp is invoked as a subprocess for every download,
// so an in-place upgrade is picked up by the next request without restarting
// the API server.

const UPGRADE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CHECK_TICK_MS = 24 * 60 * 60 * 1000; // re-check once per day
const STARTUP_DELAY_MS = 60 * 1000; // wait a minute after boot before first check
const UPGRADE_TIMEOUT_MS = 10 * 60 * 1000; // hard cap on a single upgrade run

// Alert if the last successful upgrade is older than this. Configurable via
// YTDLP_STALE_ALERT_DAYS (defaults to 14 = double the upgrade interval).
const DEFAULT_STALE_ALERT_DAYS = 14;
// Don't repeat the same alert more often than this so we don't spam ops.
// Rate limiting is delegated to the ops-alert helper via per-key cooldown.
const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function staleAlertMs(): number {
  const raw = Number(process.env.YTDLP_STALE_ALERT_DAYS);
  const days = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_STALE_ALERT_DAYS;
  return days * 24 * 60 * 60 * 1000;
}

function repoRoot(): string {
  // api-server runs from artifacts/api-server (cwd) or its dist build; the
  // monorepo root is two levels up in either case.
  return path.resolve(process.cwd(), "..", "..");
}

function stateFilePath(): string {
  const dir = path.join(repoRoot(), ".local");
  return path.join(dir, "yt-dlp-last-upgrade");
}

function scriptPath(): string {
  return path.join(repoRoot(), "scripts", "update-ytdlp.sh");
}

function readTimestampFile(file: string): number {
  try {
    const raw = fs.readFileSync(file, "utf8").trim();
    const ts = Number(raw);
    return Number.isFinite(ts) ? ts : 0;
  } catch {
    return 0;
  }
}

function writeTimestampFile(file: string, ts: number): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, String(ts), "utf8");
  } catch (err) {
    logger.warn({ err, file }, "Could not persist yt-dlp state file");
  }
}

function readLastUpgrade(): number {
  return readTimestampFile(stateFilePath());
}

function writeLastUpgrade(ts: number): void {
  writeTimestampFile(stateFilePath(), ts);
}


let upgradeInFlight = false;

interface UpgradeResult {
  ok: boolean;
  reason?: string;
  code?: number | null;
  stdout?: string;
  stderr?: string;
}

function runUpgrade(): Promise<UpgradeResult> {
  return new Promise((resolve) => {
    const script = scriptPath();
    if (!fs.existsSync(script)) {
      logger.warn({ script }, "yt-dlp upgrade script not found; skipping auto-upgrade");
      resolve({ ok: false, reason: "script_missing" });
      return;
    }
    logger.info({ script }, "Starting scheduled yt-dlp auto-upgrade");
    const proc = spawn("bash", [script], {
      cwd: repoRoot(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      timedOut = true;
      logger.warn({ timeoutMs: UPGRADE_TIMEOUT_MS }, "yt-dlp auto-upgrade timed out; killing");
      try { proc.kill("SIGKILL"); } catch {}
    }, UPGRADE_TIMEOUT_MS);
    proc.on("error", (err) => {
      clearTimeout(timer);
      logger.error({ err }, "yt-dlp auto-upgrade failed to spawn");
      resolve({ ok: false, reason: "spawn_error", stderr: String(err) });
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        logger.info({ stdout: stdout.trim() }, "yt-dlp auto-upgrade succeeded");
        resolve({ ok: true, code, stdout: stdout.trim() });
      } else {
        logger.error(
          { code, stdout: stdout.trim(), stderr: stderr.trim() },
          "yt-dlp auto-upgrade exited non-zero",
        );
        resolve({
          ok: false,
          reason: timedOut ? "timeout" : "non_zero_exit",
          code,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
      }
    });
  });
}

function truncate(s: string | undefined, max = 500): string {
  if (!s) return "";
  return s.length > max ? `${s.slice(0, max)}…(truncated)` : s;
}

async function maybeUpgrade(): Promise<void> {
  if (upgradeInFlight) return;
  const last = readLastUpgrade();
  const age = Date.now() - last;

  // Even if an upgrade isn't due, escalate when the last successful run is
  // dangerously old. This catches the case where every recent upgrade attempt
  // failed and we'd otherwise stay silent for another week.
  const staleMs = staleAlertMs();
  if (last && age > staleMs) {
    await sendOpsAlert(
      "yt-dlp auto-upgrade is stale",
      {
        key: "yt-dlp-auto-upgrade-stale",
        rateLimitMs: ALERT_COOLDOWN_MS,
        context: {
          lastSuccessIso: new Date(last).toISOString(),
          ageDays: Math.floor(age / (24 * 60 * 60 * 1000)),
          thresholdDays: Math.floor(staleMs / (24 * 60 * 60 * 1000)),
          hint: "Run scripts/update-ytdlp.sh manually or check the api-server logs.",
        },
      },
    );
  }

  if (last && age < UPGRADE_INTERVAL_MS) {
    logger.debug(
      { lastUpgradeMs: last, ageMs: age, intervalMs: UPGRADE_INTERVAL_MS },
      "yt-dlp auto-upgrade not yet due",
    );
    return;
  }
  upgradeInFlight = true;
  try {
    const result = await runUpgrade();
    if (result.ok) {
      writeLastUpgrade(Date.now());
      // Re-emit the freshness log so operators can see the new version.
      await checkYtDlpFreshness();
    } else {
      await sendOpsAlert(
        "yt-dlp auto-upgrade failed",
        {
          key: "yt-dlp-auto-upgrade-failed",
          rateLimitMs: ALERT_COOLDOWN_MS,
          context: {
            reason: result.reason ?? "unknown",
            exitCode: result.code ?? null,
            lastSuccessIso: last ? new Date(last).toISOString() : "never",
            ageDays: last
              ? Math.floor((Date.now() - last) / (24 * 60 * 60 * 1000))
              : null,
            stderr: truncate(result.stderr),
            stdout: truncate(result.stdout),
            hint: "Run scripts/update-ytdlp.sh manually to investigate.",
          },
        },
      );
    }
  } finally {
    upgradeInFlight = false;
  }
}

export function startYtDlpAutoUpgrade(): void {
  if (process.env.YTDLP_AUTO_UPGRADE === "0") {
    logger.info("yt-dlp auto-upgrade disabled via YTDLP_AUTO_UPGRADE=0");
    return;
  }
  // First run shortly after boot (so we don't block startup), then once a day.
  const startTimer = setTimeout(() => {
    void maybeUpgrade();
  }, STARTUP_DELAY_MS);
  startTimer.unref?.();
  const tick = setInterval(() => {
    void maybeUpgrade();
  }, CHECK_TICK_MS);
  tick.unref?.();
  logger.info(
    {
      intervalDays: UPGRADE_INTERVAL_MS / (24 * 60 * 60 * 1000),
      staleAlertDays: staleAlertMs() / (24 * 60 * 60 * 1000),
      alertsConfigured: !!process.env.OPS_ALERT_WEBHOOK_URL,
    },
    "yt-dlp auto-upgrade scheduler started",
  );
}
