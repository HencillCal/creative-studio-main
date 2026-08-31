import app from "./app";
import { logger } from "./lib/logger";
import { sendOpsAlert } from "./lib/ops-alert";
import { checkYtDlpFreshness } from "./lib/yt-dlp-version-check";
import { startYtDlpAutoUpgrade } from "./lib/yt-dlp-auto-upgrade";
import { startVideoExportWorker } from "./lib/video-export-queue.js";

const rawPort = process.env["PORT"] ?? "3000";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  void checkYtDlpFreshness();
  startYtDlpAutoUpgrade();
  startVideoExportWorker();

  if (process.env["OPS_ALERT_TEST"] === "1") {
    void sendOpsAlert("ops-alert channel is live (startup self-test)", {
      key: "ops-alert-self-test",
      rateLimitMs: 0,
      context: { startedAt: new Date().toISOString(), port },
    });
  }
});
