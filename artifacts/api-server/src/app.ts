import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import path from "node:path";
import fs from "node:fs";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// In production the Express server also serves the built React frontend.
// STATIC_DIR can be overridden via env var if your host uses a different layout.
if (process.env.NODE_ENV === "production") {
  const staticDir =
    process.env.STATIC_DIR ??
    path.resolve(__dirname, "../../media-studio/dist/public");

  if (fs.existsSync(staticDir)) {
    app.use(express.static(staticDir));
    // SPA fallback — any route that isn't /api/* gets index.html
    app.get("/{*path}", (_req, res) => {
      res.sendFile(path.join(staticDir, "index.html"));
    });
    logger.info({ staticDir }, "Serving static frontend");
  } else {
    logger.warn(
      { staticDir },
      "Static directory not found — run the frontend build first",
    );
  }
}

// Keep upload and route failures JSON-shaped so the frontend can show the real
// cause instead of the generic HTML "Server Error" page.
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  const code = err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code) : "";
  if (code === "LIMIT_FILE_SIZE") {
    res.status(413).json({
      error: "Upload too large",
      message: "4K uploads are limited to 500 MB. Choose Social or High quality if the source is larger.",
    });
    return;
  }
  if (err instanceof Error && err.message.includes("Only video files are supported")) {
    res.status(400).json({ error: "Bad Request", message: err.message });
    return;
  }
  next(err);
});

export default app;
