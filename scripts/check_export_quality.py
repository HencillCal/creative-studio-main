#!/usr/bin/env python3
"""Validate an exported video against its source.

Usage:
  python3 scripts/check_export_quality.py source.mp4 export.mp4 [--allow-aspect-change]

The check is intentionally conservative: Original-mode exports must preserve the
source frame, while explicit Fit/Fill exports can opt into aspect-ratio changes.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

BITRATE_FLOORS = {
    2160: 35_000_000,
    1440: 16_000_000,
    1080: 8_000_000,
    720: 5_000_000,
    480: 2_500_000,
}


def probe(path: Path) -> dict:
    cmd = [
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height,bit_rate:format=duration",
        "-of", "json", str(path),
    ]
    result = subprocess.run(cmd, check=True, capture_output=True, text=True)
    data = json.loads(result.stdout)
    stream = data["streams"][0]
    fmt = data.get("format", {})
    width = int(stream["width"])
    height = int(stream["height"])
    bitrate = int(float(stream.get("bit_rate") or 0))
    return {"width": width, "height": height, "pixels": width * height, "bitrate": bitrate, "duration": float(fmt.get("duration") or 0)}


def nearest_floor(width: int, height: int) -> int:
    long_edge = max(width, height)
    if long_edge <= 854:
        return 480
    if long_edge <= 1280:
        return 720
    if long_edge <= 1920:
        return 1080
    if long_edge <= 2560:
        return 1440
    return 2160


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("export", type=Path)
    parser.add_argument("--allow-aspect-change", action="store_true")
    parser.add_argument("--min-pixel-ratio", type=float, default=0.70)
    args = parser.parse_args()

    source = probe(args.source)
    export = probe(args.export)
    source_aspect = source["width"] / source["height"]
    export_aspect = export["width"] / export["height"]
    pixel_ratio = export["pixels"] / source["pixels"]
    tier = nearest_floor(export["width"], export["height"])
    floor = BITRATE_FLOORS[tier]
    errors: list[str] = []

    if pixel_ratio < args.min_pixel_ratio:
        errors.append(f"pixel count ratio {pixel_ratio:.2%} is below {args.min_pixel_ratio:.0%}")
    if not args.allow_aspect_change and abs(source_aspect - export_aspect) > 0.01:
        errors.append(f"aspect ratio changed from {source_aspect:.4f} to {export_aspect:.4f} without explicit consent")
    if export["bitrate"] and export["bitrate"] < floor:
        errors.append(f"video bitrate {export['bitrate']:,} is below the {tier}p floor {floor:,}")

    print(json.dumps({"source": source, "export": export, "pixel_ratio": pixel_ratio, "bitrate_floor": floor, "errors": errors}, indent=2))
    if errors:
        print("EXPORT QUALITY CHECK: FAIL", file=sys.stderr)
        return 1
    print("EXPORT QUALITY CHECK: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
