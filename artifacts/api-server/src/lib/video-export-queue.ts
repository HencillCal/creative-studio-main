import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { logger } from "./logger.js";

export const VIDEO_EXPORT_QUEUE_NAME = "video-export";
export const DEFAULT_CHUNK_SECONDS = 60;
export const DEFAULT_QUEUE_THRESHOLD_SECONDS = 180;
export const DEFAULT_QUEUE_CONCURRENCY = 2;

export interface VideoExportJobData {
  inputPath: string;
  outputPath: string;
  outputDir: string;
  durationSeconds: number;
  encodeArgs: string[];
  chunkSeconds?: number;
}

export interface VideoExportProgress {
  stage: "queued" | "processing-chunk" | "joining" | "completed" | "failed";
  completedChunks: number;
  totalChunks: number;
  percent: number;
  processedSeconds: number;
  totalSeconds: number;
  fps?: number;
  speed?: string;
  message?: string;
}

let queue: Queue<VideoExportJobData> | null = null;
let worker: Worker<VideoExportJobData> | null = null;
let connection: IORedis | null = null;

function getRedisUrl(): string | null {
  const value = process.env.REDIS_URL?.trim();
  return value ? value : null;
}

function getConnection(): IORedis {
  if (connection) return connection;
  const redisUrl = getRedisUrl();
  if (!redisUrl) throw new Error("REDIS_URL is required for queued video exports");
  connection = new IORedis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true });
  return connection;
}

export function isVideoExportQueueEnabled(): boolean {
  return Boolean(getRedisUrl()) && process.env.VIDEO_EXPORT_QUEUE !== "0";
}

export function shouldQueueVideoExport(durationSeconds: number): boolean {
  const threshold = Number(process.env.VIDEO_QUEUE_THRESHOLD_SECONDS ?? DEFAULT_QUEUE_THRESHOLD_SECONDS);
  return Number.isFinite(durationSeconds) && durationSeconds >= Math.max(1, threshold);
}

export function getVideoExportChunkSeconds(): number {
  const value = Number(process.env.VIDEO_CHUNK_SECONDS ?? DEFAULT_CHUNK_SECONDS);
  return Number.isFinite(value) ? Math.max(10, Math.min(600, Math.floor(value))) : DEFAULT_CHUNK_SECONDS;
}

function getQueue(): Queue<VideoExportJobData> {
  if (queue) return queue;
  queue = new Queue<VideoExportJobData>(VIDEO_EXPORT_QUEUE_NAME, {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 86_400, count: 1_000 },
      removeOnFail: { age: 604_800, count: 5_000 },
    },
  });
  return queue;
}

export async function enqueueVideoExport(data: VideoExportJobData): Promise<Job<VideoExportJobData>> {
  const jobId = `video-${path.basename(data.outputPath, path.extname(data.outputPath))}`;
  return getQueue().add("stylize-video", data, { jobId });
}

export async function getVideoExportStatus(jobId: string): Promise<{
  id: string;
  state: string;
  progress: unknown;
  result?: { fileId: string };
  failedReason?: string;
} | null> {
  if (!isVideoExportQueueEnabled()) return null;
  const job = await getQueue().getJob(jobId);
  if (!job) return null;
  const state = await job.getState();
  return {
    id: job.id ?? jobId,
    state,
    progress: job.progress,
    result: job.returnvalue as { fileId: string } | undefined,
    failedReason: job.failedReason,
  };
}

function quoteConcatPath(filePath: string): string {
  return `'${filePath.replace(/'/g, "'\\''")}'`;
}

function runFfmpeg(args: string[], onProgress: (values: Record<string, string>) => void, timeoutMs = 30 * 60 * 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let stdoutBuffer = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const equals = line.indexOf("=");
        if (equals > 0) onProgress({ [line.slice(0, equals)]: line.slice(equals + 1) });
      }
    });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`ffmpeg chunk exceeded ${Math.round(timeoutMs / 1000)}s timeout`));
    }, timeoutMs).unref();
    proc.once("error", (error) => { clearTimeout(timeout); reject(error); });
    proc.once("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code ?? "unknown"}: ${stderr.slice(-800)}`));
    });
  });
}

async function processVideoExportJob(job: Job<VideoExportJobData>): Promise<{ fileId: string }> {
  const data = job.data;
  const chunkSeconds = data.chunkSeconds ?? getVideoExportChunkSeconds();
  const totalChunks = Math.ceil(data.durationSeconds / chunkSeconds);
  const configuredTimeout = Number(process.env.VIDEO_EXPORT_TIMEOUT_SECONDS ?? 0);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout * 1000
    : Math.max(30 * 60 * 1000, data.durationSeconds * 5 * 1000);
  const chunkDir = path.join(data.outputDir, `chunks-${job.id}`);
  fs.mkdirSync(chunkDir, { recursive: true });
  const chunkPaths: string[] = [];
  let lastChunkProgress = 0;

  try {
    for (let index = 0; index < totalChunks; index++) {
      const start = index * chunkSeconds;
      const duration = Math.min(chunkSeconds, data.durationSeconds - start);
      const chunkPath = path.join(chunkDir, `chunk-${String(index).padStart(5, "0")}.mp4`);
      chunkPaths.push(chunkPath);
      let currentTime = 0;
      let currentSpeed: string | undefined;
      await job.updateProgress({
        stage: "processing-chunk",
        completedChunks: index,
        totalChunks,
        percent: Math.round((start / data.durationSeconds) * 100),
        processedSeconds: start,
        totalSeconds: data.durationSeconds,
        message: `Processing chunk ${index + 1} of ${totalChunks}`,
      } satisfies VideoExportProgress);

      await runFfmpeg([
        "-hide_banner", "-nostats", "-progress", "pipe:1", "-y",
        "-ss", start.toFixed(3), "-t", duration.toFixed(3), "-i", data.inputPath,
        ...data.encodeArgs, chunkPath,
      ], (values) => {
        if (values.out_time_ms) currentTime = Math.min(duration, Number(values.out_time_ms) / 1_000_000);
        if (values.speed) currentSpeed = values.speed;
        const percent = Math.round(((start + currentTime) / data.durationSeconds) * 100);
        if (percent !== lastChunkProgress || values.progress === "end") {
          lastChunkProgress = percent;
          void job.updateProgress({
            stage: "processing-chunk",
            completedChunks: index,
            totalChunks,
            percent,
            processedSeconds: start + currentTime,
            totalSeconds: data.durationSeconds,
            speed: currentSpeed,
          } satisfies VideoExportProgress);
        }
      });
    }

    const concatPath = path.join(chunkDir, "concat.txt");
    fs.writeFileSync(concatPath, chunkPaths.map(quoteConcatPath).join("\n") + "\n");
    await job.updateProgress({
      stage: "joining",
      completedChunks: totalChunks,
      totalChunks,
      percent: 99,
      processedSeconds: data.durationSeconds,
      totalSeconds: data.durationSeconds,
      message: "Joining processed chunks",
    } satisfies VideoExportProgress);
    await runFfmpeg([
      "-hide_banner", "-nostats", "-f", "concat", "-safe", "0", "-i", concatPath,
      "-c", "copy", "-movflags", "+faststart", "-y", data.outputPath,
    ], () => {});

    await job.updateProgress({
      stage: "completed",
      completedChunks: totalChunks,
      totalChunks,
      percent: 100,
      processedSeconds: data.durationSeconds,
      totalSeconds: data.durationSeconds,
    } satisfies VideoExportProgress);
    setTimeout(() => {
      try { if (fs.existsSync(data.outputPath)) fs.unlinkSync(data.outputPath); } catch {}
    }, 30 * 60 * 1000).unref();
    return { fileId: path.basename(data.outputPath) };
  } catch (error) {
    try { if (fs.existsSync(data.outputPath)) fs.unlinkSync(data.outputPath); } catch {}
    throw error;
  } finally {
    try { fs.rmSync(chunkDir, { recursive: true, force: true }); } catch {}
    try { if (fs.existsSync(data.inputPath)) fs.unlinkSync(data.inputPath); } catch {}
  }
}

export function startVideoExportWorker(): Worker<VideoExportJobData> | null {
  if (!isVideoExportQueueEnabled() || worker) return worker;
  const concurrencyRaw = Number(process.env.VIDEO_EXPORT_CONCURRENCY ?? DEFAULT_QUEUE_CONCURRENCY);
  const concurrency = Number.isFinite(concurrencyRaw) ? Math.max(1, Math.min(8, Math.floor(concurrencyRaw))) : DEFAULT_QUEUE_CONCURRENCY;
  worker = new Worker<VideoExportJobData>(VIDEO_EXPORT_QUEUE_NAME, processVideoExportJob, {
    connection: getConnection(),
    concurrency,
    limiter: { max: concurrency, duration: 1_000 },
  });
  worker.on("completed", (job) => logger.info({ jobId: job.id }, "Video export job completed"));
  worker.on("failed", (job, err) => logger.error({ jobId: job?.id, err }, "Video export job failed"));
  logger.info({ concurrency, chunkSeconds: getVideoExportChunkSeconds() }, "Video export worker started");
  return worker;
}
