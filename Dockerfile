# Build dependencies and toolchain
FROM node:20-bookworm AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg python3 python3-pip python3-venv tesseract-ocr tesseract-ocr-eng \
    libvips-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN pip3 install yt-dlp --break-system-packages
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/media-studio/package.json ./artifacts/media-studio/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY lib/db/package.json ./lib/db/
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY . .
ENV NODE_ENV=production
RUN pnpm run build:prod

FROM deps AS prod-deps
ENV CI=true
RUN pnpm prune --prod

# Smaller runtime layer: only shared runtime libraries, not compiler headers.
FROM node:20-bookworm AS runner
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg python3 python3-pip tesseract-ocr tesseract-ocr-eng libvips42 ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && pip3 install yt-dlp --break-system-packages
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/artifacts/api-server/node_modules ./artifacts/api-server/node_modules
COPY --from=prod-deps /app/lib/db/node_modules ./lib/db/node_modules
COPY --from=prod-deps /app/lib/api-zod/node_modules ./lib/api-zod/node_modules
COPY --from=builder /app/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=builder /app/artifacts/media-studio/dist ./artifacts/media-studio/dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/lib/db/package.json ./lib/db/package.json
COPY --from=builder /app/lib/api-zod/package.json ./lib/api-zod/package.json
EXPOSE 3000
CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
