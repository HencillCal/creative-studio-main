# Workspace

## Overview

CreativeStudio is a multi-tool creative media platform built as a pnpm workspace monorepo using TypeScript. Its purpose is to provide a comprehensive suite of media manipulation tools, covering video editing, image processing, AI-driven content generation, and audio-visual creation. The project aims to offer a versatile and powerful platform for content creators, streamlining various media production workflows.

Key capabilities include:
- GIF conversion and video resizing.
- OCR text extraction from images.
- Client-side thumbnail creation and particle VFX.
- Advanced video merging with transitions and overlays.
- AI-powered image stylization and lyrical synchronization for videos.
- Music video generation with audio-reactive visualizations and AI-enhanced features like background generation and lyrics translation.

The project is built on Node.js 24, TypeScript 5.9, Express 5 for the API, and a React + Vite frontend. It is designed for external deployment across various hosting platforms, serving the frontend as static files from the Express server.

## User Preferences

I prefer iterative development, with a focus on delivering working features incrementally. I appreciate clear and concise communication, avoiding overly technical jargon where simpler explanations suffice. When making significant architectural decisions or implementing new features, please outline the proposed changes and rationale before proceeding. I value well-tested code, so please include relevant tests for new functionalities.

## System Architecture

CreativeStudio employs a monorepo structure managed by pnpm workspaces. The frontend is a React application built with Vite, served by an Express 5 backend. The API leverages Orval for OpenAPI spec code generation, ensuring type safety and consistency. `esbuild` is used for CJS bundle generation.

**UI/UX Decisions:**
- A dark navy and vibrant purple theme (`hsl(245 90% 68%)`) is used throughout the application.
- The interface features a collapsible sidebar for tool categories.
- The Inter font is used system-wide for a consistent typographical experience.

**Technical Implementations & Feature Specifications:**

- **Media Processing:**
    - **GIF Converter:** Converts videos to optimized GIFs using FFmpeg's palettegen+paletteuse pipeline.
    - **Aspect Ratio Resizer:** Resizes images (using Sharp) and videos (using FFmpeg).
    - **OCR Text Extractor:** Extracts text from images using `tesseract.js`.
    - **Video Merger:** Supports merging multiple video clips with various transitions (Cut, Fade, Wipe, Slide, Zoom) and motion effects (Zoom In/Out, Pan Left/Right). It allows for PiP overlays with adjustable position, size, and trim. Playback uses direct DOM manipulation via `requestAnimationFrame` for smooth 60fps animations, updating React state only on discrete events.
    - **AI Stylizer:** Client-side image filter tool offering 18 style presets, including CSS-filter based styles and pixel manipulation techniques. Features include a before/after compare slider, cropping, resizing with presets, batch processing, and multi-format export. Heavy filters auto-cap at 1200px for performance.
    - **Lyrics Sync:** Transcribes audio via Gemini AI or allows manual lyric input, then overlays synchronized karaoke-style text on video. Customizable font, size, color, highlighting, position, and background. Video export is handled via `captureStream` + `MediaRecorder`.
    - **Song Visualizer:** Creates music videos from uploaded audio and background images with 12 audio-reactive visualization styles. Features include draggable/resizable visualizations and lyrics blocks, audio trimming, synchronized lyrics fetching (from LRCLIB → SilvaTech → xcasper → lewdhutao), lyrics translation (13 languages via SilvaTech AI), AI background generation (SilvaTech AI/Photoleap), and rich lyrics styling. Auto-syncing of lyrics timing uses Gemini AI. Export bitrates: Fast 6 Mbps / Standard 10 Mbps / High 16 Mbps. (High was originally bumped to 20 Mbps but caused a generic "Encoding error" from Chrome's WebCodecs `VideoEncoder` on consumer GPU H.264 encoders — Intel iGPUs especially — at 1080×1080. 16 Mbps is the safe ceiling that still encodes crisper than the previous 12 Mbps and is comfortably above YouTube's 1080p SDR recommendation. The export worker also translates raw `Encoding error` / `Encoder failure` strings into an actionable message pointing the user at lower Quality / smaller Ratio / shorter trim, AND automatically retries once at 50% bitrate with `hardwareAcceleration: "prefer-software"` when the GPU encoder rejects the first attempt — the worker keeps the audio PCM and bg buffers in memory so the retry doesn't need a main-thread roundtrip and re-analysis. The bg video source is recreated per attempt because its sample cursor is stateful.) When a background image or video is uploaded, the export aspect ratio is auto-set to the closest matching option (16:9, 9:16, 1:1, 4:5) and the background fit mode is reset to "cover" so downloads fill the frame edge-to-edge instead of letterboxing. Karaoke highlight progress: when per-word timings are missing (LRC files, manual paste, tap-sync), `drawScene` synthesizes per-word timings inline with a held-final-word cadence (~30% of the line window) so the wipe doesn't race past the singer in linear-interpolation mode. Real per-word data (Whisper alignment) still wins when present.

- **Content Integration:**
    - **Content Dashboard:** Aggregates Reddit posts and Pinterest pins. Reddit API has a fallback to mock posts in case of blockages.

- **Client-Side Tools:**
    - **Thumbnail Creator:** Utilizes native HTML Canvas API for zero dependency overhead, supporting text layers, shadow/stroke controls, background images, and basic filters.
    - **Particle VFX:** Client-side Canvas animation using `requestAnimationFrame` with 7 realistic particle types, video background upload, and export options.

**Testing Convention:**
- `Vitest` is the standard test runner.
- Tests (`*.test.ts`/`*.test.tsx`) live alongside source files.
- Backend route tests use `supertest` against the Express `app`.
- Frontend tests use `jsdom` via `@testing-library/react`.
- New features must include at least one smoke test.

## External Dependencies

- **FFmpeg:** Used for video processing tasks like GIF conversion, video resizing, audio extraction, and video merging. Requires system-wide installation.
- **Sharp:** Used for image resizing.
- **tesseract.js:** Used for OCR text extraction from images.
- **yt-dlp:** Utilized for fetching music and video streams, particularly for the Song Visualizer. Requires `python3` and `yt-dlp` to be installed on the host. The system includes auto-upgrade mechanisms for `yt-dlp`.
- **Gemini AI:** Integrated for AI transcription in Lyrics Sync and auto-syncing lyrics timing in Song Visualizer. Leverages Replit's built-in AI access with a fallback to user-provided `GEMINI_API_KEYS`.
- **SilvaTech AI:** Used for translating lyrics and generating AI backgrounds in the Song Visualizer.
- **LRCLIB / xcasper / lewdhutao:** Fallback chain for fetching synchronized lyrics.
- **Photoleap:** Fallback for AI background image generation.
- **JSZip:** Used for batch download of images as ZIP archives in AI Stylizer.
- **Supertest:** For testing API routes.
- **@testing-library/react:** For frontend component testing.
- **Slack-compatible webhooks (e.g., Slack, Discord, Mattermost, Google Chat):** For operator alerts (`OPS_ALERT_WEBHOOK_URL`) to notify about background task failures and `yt-dlp` maintenance issues.