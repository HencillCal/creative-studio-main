FROM node:20-bookworm AS base

# ── System binaries needed at runtime ─────────────────────────────────────────
# ffmpeg        → video/GIF conversion & merging
# python3+pip   → yt-dlp runtime dependency
# tesseract-ocr → OCR text extraction (tesseract.js downloads its own binary
#                 but still needs the system lib for certain codepaths)
# libvips-dev   → Sharp native image-processing module
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    python3-venv \
    tesseract-ocr \
    tesseract-ocr-eng \
    libvips-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp: install system-wide via pip
RUN pip3 install yt-dlp --break-system-packages

# pnpm via corepack (avoids the npm-global install dance)
RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

# ── Dependency layer (cached unless a package.json / lockfile changes) ─────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY artifacts/api-server/package.json  ./artifacts/api-server/
COPY artifacts/media-studio/package.json ./artifacts/media-studio/
COPY lib/api-spec/package.json          ./lib/api-spec/
COPY lib/api-zod/package.json           ./lib/api-zod/
COPY lib/api-client-react/package.json  ./lib/api-client-react/
COPY lib/db/package.json                ./lib/db/
RUN pnpm install --frozen-lockfile

# ── Build layer ────────────────────────────────────────────────────────────────
FROM deps AS builder
COPY . .
# NODE_ENV=production skips the Replit-only vite dev plugins
ENV NODE_ENV=production
RUN pnpm run build:prod

# ── Production image ───────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Node module trees (root + each workspace that ships runtime code)
COPY --from=deps /app/node_modules              ./node_modules
COPY --from=deps /app/artifacts/api-server/node_modules  ./artifacts/api-server/node_modules
COPY --from=deps /app/lib/db/node_modules       ./lib/db/node_modules
COPY --from=deps /app/lib/api-zod/node_modules  ./lib/api-zod/node_modules

# Built artefacts
COPY --from=builder /app/artifacts/api-server/dist    ./artifacts/api-server/dist
COPY --from=builder /app/artifacts/media-studio/dist  ./artifacts/media-studio/dist

# Package manifests (needed so Node can resolve workspace: links at runtime)
COPY --from=builder /app/package.json             ./package.json
COPY --from=builder /app/lib/db/package.json      ./lib/db/package.json
COPY --from=builder /app/lib/api-zod/package.json ./lib/api-zod/package.json

EXPOSE 3000

# The Express server serves the built React frontend from
# artifacts/media-studio/dist/public when NODE_ENV=production
CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
