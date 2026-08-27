import { spawn } from "child_process";
import path from "path";
import { logger } from "./logger";
import { sendOpsAlert } from "./ops-alert";

const STALE_THRESHOLD_DAYS = 30;

function ytDlpCandidates(): string[] {
  return [
    process.env.YTDLP_BIN,
    path.join(process.cwd(), "..", "..", ".pythonlibs", "bin", "yt-dlp"),
    "yt-dlp",
  ].filter((b): b is string => !!b);
}

function getVersion(bin: string, timeoutMs = 5000): Promise<string | null> {
  return new Promise((resolve) => {
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(bin, ["--version"]);
    } catch {
      resolve(null);
      return;
    }
    let stdout = "";
    let settled = false;
    const finish = (val: string | null) => {
      if (settled) return;
      settled = true;
      try { proc.kill("SIGKILL"); } catch {}
      resolve(val);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.on("error", () => { clearTimeout(timer); finish(null); });
    proc.on("close", (code) => {
      clearTimeout(timer);
      finish(code === 0 ? stdout.trim() : null);
    });
  });
}

// yt-dlp versions look like "2026.03.17" (CalVer YYYY.MM.DD), occasionally
// with a ".N" suffix for same-day patch releases. Returns days since release
// or null when the string isn't parseable.
function ageInDays(version: string): number | null {
  const m = version.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const released = Date.UTC(year, month - 1, day);
  if (!Number.isFinite(released)) return null;
  const ageMs = Date.now() - released;
  if (ageMs < 0) return 0;
  return Math.floor(ageMs / (24 * 60 * 60 * 1000));
}

export async function checkYtDlpFreshness(): Promise<void> {
  for (const bin of ytDlpCandidates()) {
    const version = await getVersion(bin);
    if (!version) continue;
    const age = ageInDays(version);
    if (age === null) {
      logger.info({ bin, version }, "yt-dlp version detected (unparseable date)");
      return;
    }
    if (age > STALE_THRESHOLD_DAYS) {
      logger.warn(
        { bin, version, ageDays: age, threshold: STALE_THRESHOLD_DAYS },
        `yt-dlp is older than ${STALE_THRESHOLD_DAYS} days; YouTube downloads may start failing. Run scripts/update-ytdlp.sh to upgrade.`,
      );
      void sendOpsAlert(
        `yt-dlp is stale (>${STALE_THRESHOLD_DAYS}d). YouTube downloads may start failing soon.`,
        {
          key: "yt-dlp-stale",
          context: { bin, version, ageDays: age, threshold: STALE_THRESHOLD_DAYS },
        },
      );
    } else {
      logger.info({ bin, version, ageDays: age }, "yt-dlp version check passed");
    }
    return;
  }
  logger.warn("yt-dlp binary not found; YouTube full-song downloads will fail until installed.");
  void sendOpsAlert(
    "yt-dlp binary not found on api-server; YouTube full-song downloads are disabled.",
    { key: "yt-dlp-missing" },
  );
}
