"""Turn a recorded scene into one of the README's GIFs.

`e2e/shots/recorder.ts` leaves a directory per scene: every repaint of the
window at full resolution, with the time it painted, and the marks the
scene made, "look here" and "pull back", and the waits it asked to have
played back quickly.  This file is the camera.  It
samples the scene at a steady rate, glides a crop rectangle between the
marks with an ease in and out, crops each full frame at that rectangle and
scales it to the GIF's width, so a zoomed view is cut from the real pixels
rather than blown up from a small copy.

One palette serves every frame of a GIF, built from a mosaic of frames
across the whole scene, because a palette per frame makes flat interface
colours shimmer as the camera moves.

    .venv/bin/python e2e/shots/gif.py SCENE_DIR OUT.gif [--width 880] [--fps 12] [--colors 255]
"""

from __future__ import annotations

import argparse
import json
from bisect import bisect_right
from pathlib import Path

from PIL import Image

# The closest the camera comes: never more than this many times the whole
# window, so a zoom shows a region with its surroundings, not one word.
MAX_ZOOM = 2.6


def ease(u: float) -> float:
    u = min(1.0, max(0.0, u))
    return 4 * u * u * u if u < 0.5 else 1 - (-2 * u + 2) ** 3 / 2


def fit(rect: dict, view: dict) -> tuple[float, float, float, float]:
    """The mark's rectangle grown to the GIF's shape, kept on screen."""
    vw, vh = view["width"], view["height"]
    aspect = vw / vh
    x, y, w, h = rect["x"], rect["y"], rect["width"], rect["height"]
    cx, cy = x + w / 2, y + h / 2
    w = max(w, h * aspect, vw / MAX_ZOOM)
    h = w / aspect
    if w > vw:
        w, h = vw, vh
    x = min(max(cx - w / 2, 0), vw - w)
    y = min(max(cy - h / 2, 0), vh - h)
    return (x, y, w, h)


def camera(scene: dict):
    view = scene["viewport"]
    whole = (0.0, 0.0, float(view["width"]), float(view["height"]))
    moves = []
    current = whole
    for mark in sorted(scene["marks"], key=lambda m: m["t"]):
        target = whole if mark["kind"] == "wide" else fit(mark["rect"], view)
        moves.append((mark["t"], mark["ease"], current, target))
        current = target

    def at(t: float) -> tuple[float, float, float, float]:
        rect = whole
        for start, length, src, dst in moves:
            if t < start:
                break
            k = ease((t - start) / length) if length > 0 else 1.0
            rect = tuple(a + (b - a) * k for a, b in zip(src, dst))
        return rect

    return at


def render(scene_dir: Path, out: Path, width: int, fps: int, trim: float, tail: float, colors: int = 255) -> None:
    scene = json.loads((scene_dir / "scene.json").read_text())
    frames = scene["frames"]
    if not frames:
        raise SystemExit(f"{scene_dir}: no frames were recorded")
    times = [f["t"] for f in frames]
    view = scene["viewport"]
    height = round(width * view["height"] / view["width"])
    at = camera(scene)
    end = scene["end"]

    cache: dict[str, Image.Image] = {}

    def frame_at(t: float) -> Image.Image:
        i = max(0, bisect_right(times, t) - 1)
        name = frames[i]["file"]
        if name not in cache:
            cache.clear()
            cache[name] = Image.open(scene_dir / name).convert("RGB")
        return cache[name]

    fast = scene.get("fast", [])

    def speed_at(t: float) -> float:
        return next((f["speed"] for f in fast if f["from"] <= t < f["to"]), 1.0)

    # While the camera moves every pixel changes, so a moving frame costs
    # a whole frame where a still one costs only what changed.  The camera
    # is therefore drawn at half the rate while it moves: a glide of 0.7 s
    # still reads as a glide, and a GIF of mostly gliding halves in size.
    shots: list[Image.Image] = []
    holds: list[int] = []
    step = 1 / fps
    t = trim
    last_box = None
    moving_skip = False
    while t <= end:
        full = frame_at(t)
        sx = full.width / view["width"]
        x, y, w, h = at(t)
        box = (round(x * sx), round(y * sx), round((x + w) * sx), round((y + h) * sx))
        moving = last_box is not None and box != last_box
        last_box = box
        if moving and moving_skip and shots:
            holds[-1] += 1
            moving_skip = False
        else:
            shots.append(full.crop(box).resize((width, height), Image.LANCZOS))
            holds.append(1)
            moving_skip = moving
        t += step * speed_at(t)

    # One palette, from frames spread across the scene.
    sample = shots[:: max(1, len(shots) // 12)]
    mosaic = Image.new("RGB", (width, height * len(sample)))
    for k, im in enumerate(sample):
        mosaic.paste(im, (0, k * height))
    palette = mosaic.quantize(colors=colors, method=Image.Quantize.MEDIANCUT)

    # Identical neighbours become one frame held longer.
    out_frames: list[Image.Image] = []
    durations: list[int] = []
    last = None
    for im, hold in zip(shots, holds):
        q = im.quantize(palette=palette, dither=Image.Dither.NONE)
        raw = q.tobytes()
        if raw == last:
            durations[-1] += hold * round(1000 / fps)
            continue
        out_frames.append(q)
        durations.append(hold * round(1000 / fps))
        last = raw
    durations[-1] += round(tail * 1000)
    out_frames[0].save(
        out, save_all=True, append_images=out_frames[1:], duration=durations,
        loop=0, optimize=True, disposal=1,
    )
    size = out.stat().st_size / 1e6
    print(f"{out.name}: {len(out_frames)} frames, {sum(durations) / 1000:.1f} s, {size:.2f} MB")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("scene", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--width", type=int, default=880)
    parser.add_argument("--fps", type=int, default=12)
    parser.add_argument("--trim", type=float, default=0.0, help="seconds to drop from the start")
    parser.add_argument("--tail", type=float, default=1.5, help="seconds to hold the last frame")
    parser.add_argument("--colors", type=int, default=255, help="palette size; fewer is smaller")
    args = parser.parse_args()
    render(args.scene, args.out, args.width, args.fps, args.trim, args.tail, args.colors)


if __name__ == "__main__":
    main()
