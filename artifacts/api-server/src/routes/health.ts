import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getLyricsCacheStatus } from "./media.js";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/healthz/lyrics-cache", async (_req, res) => {
  try {
    const status = await getLyricsCacheStatus();
    res.json(status);
  } catch (err) {
    console.error("getLyricsCacheStatus failed", err);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to fetch lyrics cache status",
    });
  }
});

export default router;
