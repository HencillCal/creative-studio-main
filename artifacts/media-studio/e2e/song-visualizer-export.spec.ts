import { test, expect, type Page } from "@playwright/test";

const FIXTURES = {
  audio: "/test-fixtures/test-tone.wav",
  gif: "/test-fixtures/test-anim.gif",
};

async function uploadInto(
  page: Page,
  selector: string,
  url: string,
  filename: string,
  mime: string,
): Promise<void> {
  await page.evaluate(
    async ({ selector, url, filename, mime }) => {
      const buf = await fetch(url).then((r) => r.arrayBuffer());
      const file = new File([buf], filename, { type: mime });
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.querySelector(selector) as HTMLInputElement | null;
      if (!input) throw new Error(`No input found: ${selector}`);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { selector, url, filename, mime },
  );
}

test("Song Visualizer: full upload → 2 styles → lyrics drag → MP4 export", async ({ page }) => {
  // 1. Mock the auto-sync endpoint so applying lyrics doesn't depend on
  //    Gemini network calls — return alignedSegments echoing what we type.
  await page.route("**/api/media/auto-sync-lyrics", async (route) => {
    const text = "Test line one\nTest line two\nTest line three";
    const lines = text.split("\n");
    const alignedSegments = lines.map((t, i) => ({
      text: t,
      startTime: i * 0.6,
      endTime: (i + 1) * 0.6,
    }));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        alignedSegments,
        matchedLineCount: lines.length,
        totalLineCount: lines.length,
      }),
    });
  });

  const consoleErrors: string[] = [];
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`console.error: ${msg.text()}`);
  });

  await page.goto("/song-visualizer");
  await expect(page.getByText("VISUALIZATION STYLE")).toBeVisible();

  // 2. Upload audio fixture into the hidden audio input.
  await uploadInto(
    page,
    'input[type=file][accept^="audio"]',
    FIXTURES.audio,
    "test-tone.wav",
    "audio/wav",
  );

  const exportButton = page.getByRole("button", { name: "Export" });
  await expect(exportButton).toBeVisible({ timeout: 10_000 });

  // 3. Style #1 — Frequency Bars.
  await page.getByTitle("Frequency Bars").first().click();

  // 4. Seed lyrics: type into the manual textarea and click Apply & Auto-Sync.
  //    The mocked endpoint echoes back alignedSegments so the lyrics overlay
  //    becomes draggable on the canvas.
  await page.getByPlaceholder(/Paste lyrics here/i).fill("Test line one\nTest line two\nTest line three");
  await page.getByRole("button", { name: /Apply & Auto-Sync/i }).click();
  // Silent auto-sync suppresses the toast; instead wait for the status
  // message that appears once alignedSegments are applied.
  await expect(page.getByText(/Aligned to vocals/i)).toBeVisible({ timeout: 15_000 });

  // 5. Drag the lyrics overlay block. Lyrics default position is the
  //    bottom-center area. Read offset before/after to assert the drag
  //    actually moved them — proves hit-testing + render-loop bounds work.
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  expect(box, "live-preview canvas should be visible").not.toBeNull();
  if (!box) throw new Error("no canvas box");

  // Lyrics render at lyricsPosition = "bottom" by default. The exact pixel
  // position depends on font metrics and canvas-internal vs CSS scaling, so
  // we retry the drag at a few plausible Y offsets in the lower portion of
  // the canvas until the lyrics state actually mutates. The "Reset position
  // & size" link appears under the LYRICS label only when lyricsOffsetX/Y
  // or lyricsScale is non-default — that's our oracle that the drag was
  // accepted by the canvas hit-tester.
  // The visualizer's "Reset position & size" link only renders after the
  // user has moved/resized the visualizer (we haven't), so the only such
  // link that should appear after the lyrics drag is the lyrics one.
  const lyricsResetLink = page.getByRole("button", {
    name: /Reset position & size/,
  });
  await expect(lyricsResetLink).toHaveCount(0);

  // Read the live lyrics bounds the render loop stashes on window so the
  // gestures provably land inside hitInsideLyrics() / hitLyricsCorner().
  // Poll because the rAF loop may not have populated bounds the instant
  // the segments arrive.
  type BoundsInfo = {
    cssCenterX: number; cssCenterY: number;
    cssBR_X: number; cssBR_Y: number;
  };
  const readBounds = (): Promise<BoundsInfo | null> =>
    page.evaluate(() => {
      const c = document.querySelector("canvas") as HTMLCanvasElement | null;
      const b = (window as unknown as {
        __lyricsBounds?: { x: number; y: number; w: number; h: number } | null;
      }).__lyricsBounds;
      if (!c || !b) return null;
      const r = c.getBoundingClientRect();
      const sx = r.width / c.width;
      const sy = r.height / c.height;
      return {
        cssCenterX: r.left + (b.x + b.w / 2) * sx,
        cssCenterY: r.top + (b.y + b.h / 2) * sy,
        cssBR_X: r.left + (b.x + b.w) * sx,
        cssBR_Y: r.top + (b.y + b.h) * sy,
      };
    });
  await expect.poll(readBounds, { timeout: 10_000 }).not.toBeNull();
  const bounds = (await readBounds())!;

  // Dispatch the drag as native MouseEvents directly on the canvas so the
  // React synthetic-event delegation fires regardless of focus / overlay
  // ordering. page.mouse.* sometimes misses when an invisible element sits
  // above the canvas in the stacking context.
  await page.evaluate(({ x, y }) => {
    const canvas = document.querySelector("canvas") as HTMLCanvasElement;
    const fire = (type: string, cx: number, cy: number, buttons: number) => {
      const ev = new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window,
        clientX: cx, clientY: cy, button: 0, buttons,
      });
      canvas.dispatchEvent(ev);
    };
    fire("mousedown", x, y, 1);
    for (let i = 1; i <= 12; i++) {
      fire("mousemove", x - 8 * i, y - 5 * i, 1);
    }
    fire("mouseup", x - 96, y - 60, 0);
  }, { x: bounds.cssCenterX, y: bounds.cssCenterY });

  // The "Reset position & size" link under the LYRICS label appears only
  // when lyricsOffsetX/Y/scale are non-default — that's our oracle that
  // the drag mutated lyrics state via hitInsideLyrics + onCanvasMouseMove.
  await expect(lyricsResetLink).toBeVisible({ timeout: 5_000 });

  // 5b. Resize the lyrics overlay by grabbing its bottom-right corner
  //     handle (hitLyricsCorner) and dragging outward. Re-read bounds
  //     because the previous drag changed them.
  await expect.poll(readBounds, { timeout: 5_000 }).not.toBeNull();
  const postDragBounds = (await readBounds())!;
  await page.evaluate(({ x, y, dx, dy }) => {
    const canvas = document.querySelector("canvas") as HTMLCanvasElement;
    const fire = (type: string, cx: number, cy: number, buttons: number) => {
      canvas.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window,
        clientX: cx, clientY: cy, button: 0, buttons,
      }));
    };
    fire("mousedown", x, y, 1);
    for (let i = 1; i <= 10; i++) fire("mousemove", x + dx * i / 10, y + dy * i / 10, 1);
    fire("mouseup", x + dx, y + dy, 0);
  }, {
    x: postDragBounds.cssBR_X,
    y: postDragBounds.cssBR_Y,
    dx: 30,
    dy: 30,
  });

  // After the resize, lyrics bounds width should grow (scale > 1).
  await expect.poll(async () => {
    const b = await readBounds();
    if (!b || !postDragBounds) return 0;
    return (b.cssBR_X - b.cssCenterX) / (postDragBounds.cssBR_X - postDragBounds.cssCenterX);
  }, { timeout: 5_000 }).toBeGreaterThan(1.05);

  // 6. Style #2 — switch to GIF and upload the GIF fixture.
  await page.getByTitle("GIF").first().click();
  await uploadInto(
    page,
    'input[type=file][accept="image/gif,image/webp"]',
    FIXTURES.gif,
    "test-anim.gif",
    "image/gif",
  );

  // 7. Click Export and require a real MP4 download. Headless Chromium's
  //    full build (channel: "chromium") includes the open-source FFmpeg
  //    H.264 path, so VideoEncoder.isConfigSupported(avc1.640033, 1080p)
  //    succeeds and the worker emits a real MP4 blob.
  const downloadPromise = page.waitForEvent("download", { timeout: 90_000 });
  await exportButton.click();

  const download = await downloadPromise;
  const filename = download.suggestedFilename();
  expect(filename, `download filename should end with .mp4 (got: ${filename})`).toMatch(/\.mp4$/i);

  const path = await download.path();
  expect(path, "download path should be available").toBeTruthy();

  // Sanity-check the MP4 magic — bytes 4..8 must spell "ftyp".
  const fs = await import("node:fs/promises");
  const buf = await fs.readFile(path!);
  expect(buf.length, "mp4 file should be non-empty").toBeGreaterThan(1024);
  const ftyp = buf.subarray(4, 8).toString("ascii");
  expect(ftyp, `mp4 should start with ftyp box (got: ${ftyp})`).toBe("ftyp");

  // 8. The "Export complete" success toast confirms the muxer finalized cleanly.
  await expect(page.getByText(/Export complete/i).first()).toBeVisible({ timeout: 10_000 });

  // 9. No stray uncaught exceptions during the run.
  const fatal = consoleErrors.filter(
    (m) =>
      !/Download the React DevTools/i.test(m) &&
      !/^console\.error: \[vite\]/i.test(m),
  );
  expect(fatal, `unexpected console errors: ${fatal.join("\n")}`).toEqual([]);
});
