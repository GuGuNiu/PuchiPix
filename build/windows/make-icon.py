#!/usr/bin/env python3
"""Generate PuchiPix application icons from the project accent palette."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw

SUPERSAMPLE = 8
CANVAS = 256
ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)

GRADIENT_START = (99, 102, 241)
GRADIENT_MIDDLE = (129, 140, 248)
GRADIENT_END = (165, 180, 252)
GLYPH = (255, 255, 255)

CORNER_RADIUS_RATIO = 0.225
TRIANGLE_WIDTH_RATIO = 0.40
TRIANGLE_HEIGHT_RATIO = 0.46
TRIANGLE_SHIFT_RATIO = 0.035


def diagonal_gradient(size: int) -> Image.Image:
    base = Image.new("RGB", (size, size))
    draw = ImageDraw.Draw(base)
    span = size - 1
    for offset in range(size):
        ratio = offset / span
        if ratio < 0.5:
            local = ratio / 0.5
            start, end = GRADIENT_START, GRADIENT_MIDDLE
        else:
            local = (ratio - 0.5) / 0.5
            start, end = GRADIENT_MIDDLE, GRADIENT_END
        colour = tuple(round(a + (b - a) * local) for a, b in zip(start, end))
        draw.line([(offset, 0), (0, offset)], fill=colour)
        draw.line([(offset, size - 1), (size - 1, offset)], fill=colour)
    return base


def rounded_mask(size: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    radius = round(size * CORNER_RADIUS_RATIO)
    ImageDraw.Draw(mask).rounded_rectangle(
        [(0, 0), (size - 1, size - 1)], radius=radius, fill=255
    )
    return mask


def play_triangle(size: int) -> Image.Image:
    width = round(size * TRIANGLE_WIDTH_RATIO)
    height = round(size * TRIANGLE_HEIGHT_RATIO)
    shift = round(size * TRIANGLE_SHIFT_RATIO)

    left = (size - width) // 2 + shift
    top = (size - height) // 2
    right = left + width
    middle = top + height / 2

    glyph = Image.new("L", (size, size), 0)
    ImageDraw.Draw(glyph).polygon(
        [(left, top), (right, middle), (left, top + height)], fill=255
    )
    return glyph


def build_icon() -> Image.Image:
    big = CANVAS * SUPERSAMPLE
    icon = diagonal_gradient(big).convert("RGBA")
    icon.putalpha(rounded_mask(big))

    glyph = play_triangle(big)
    glyph_layer = Image.new("RGBA", (big, big), (*GLYPH, 0))
    glyph_layer.putalpha(glyph)
    icon = Image.alpha_composite(icon, glyph_layer)

    return icon.resize((CANVAS, CANVAS), Image.LANCZOS)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="build/windows/icon.ico")
    parser.add_argument("--png-out", default=None)
    args = parser.parse_args()

    icon = build_icon()

    ico_path = Path(args.out)
    ico_path.parent.mkdir(parents=True, exist_ok=True)
    icon.save(ico_path, format="ICO", sizes=[(s, s) for s in ICO_SIZES])

    if args.png_out:
        png_path = Path(args.png_out)
        png_path.parent.mkdir(parents=True, exist_ok=True)
        icon.save(png_path, format="PNG")

    print(f"[icon] wrote {ico_path} with sizes {ICO_SIZES}")
    if args.png_out:
        print(f"[icon] wrote {args.png_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
