# Live export UI findings

Date: 2026-08-29

The page `https://caldrogo.zone.id/video-stylizer` returned the Creative Studio title and loaded HTML, but the sandbox browser rendered a blank dark viewport with no visible interactive elements. The browser console showed no captured output. A subsequent page view remained blank. This may indicate a frontend runtime/rendering issue in the sandbox browser or a stale/broken asset state; it is separate from the VPS FFmpeg process check.

The VPS application logs showed no active FFmpeg process at the time of the later check and the most recent stylize request completed with HTTP 200. Earlier, a non-4K 55-second export ran for about 362 seconds before completing successfully. Nginx is configured for 3600-second proxy timeouts and 500 MB request bodies.

The VPS also showed automated probes requesting `/.env`, `/.env.local`, and `/.git/config`; these returned application-level 200 responses likely because SPA fallback handles unknown paths. This should be reviewed as a separate security hardening issue, but it was not changed during this diagnosis.
