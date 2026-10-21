#!/usr/bin/env python3
"""Draw the install icons and iOS splash screens.

The mark is an original feed glyph: three bars and a dot. It is not the X logo.
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BLUE = (29, 155, 240, 255)
WHITE = (255, 255, 255, 255)
BLACK = (0, 0, 0, 255)

# 5x7 glyphs for the splash wordmark.
FONT = {
    "F": ["11110", "10000", "11100", "10000", "10000", "10000", "10000"],
    "E": ["11110", "10000", "11100", "10000", "10000", "10000", "11110"],
    "D": ["11100", "10010", "10010", "10010", "10010", "10010", "11100"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
}


def chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def png(width: int, height: int, raw: bytes) -> bytes:
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def blank(width: int, height: int, color: tuple[int, int, int, int]) -> bytearray:
    pixel = bytes(color)
    row = b"\x00" + pixel * width
    return bytearray(row * height)


def put(buf: bytearray, width: int, x: int, y: int, color: tuple[int, int, int, int], height: int) -> None:
    if x < 0 or y < 0 or x >= width or y >= height:
        return
    start = y * (width * 4 + 1) + 1 + x * 4
    buf[start:start + 4] = bytes(color)


def fill_round_rect(buf, width, height, x, y, rw, rh, radius, color) -> None:
    radius = min(radius, rw // 2, rh // 2)
    for dy in range(rh):
        for dx in range(rw):
            px, py = x + dx, y + dy
            if dx < radius and dy < radius:
                if (dx - radius) ** 2 + (dy - radius) ** 2 > radius ** 2:
                    continue
            elif dx >= rw - radius and dy < radius:
                if (dx - (rw - radius - 1)) ** 2 + (dy - radius) ** 2 > radius ** 2:
                    continue
            elif dx < radius and dy >= rh - radius:
                if (dx - radius) ** 2 + (dy - (rh - radius - 1)) ** 2 > radius ** 2:
                    continue
            elif dx >= rw - radius and dy >= rh - radius:
                if (dx - (rw - radius - 1)) ** 2 + (dy - (rh - radius - 1)) ** 2 > radius ** 2:
                    continue
            put(buf, width, px, py, color, height)


def fill_circle(buf, width, height, cx, cy, radius, color) -> None:
    r2 = radius * radius
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            if dx * dx + dy * dy <= r2:
                put(buf, width, cx + dx, cy + dy, color, height)


def draw_mark(size: int, background: tuple[int, int, int, int], accent: tuple[int, int, int, int]) -> bytearray:
    buf = blank(size, size, background)
    # Keep the mark inside the maskable safe zone (center 80%).
    bar_w = int(size * 0.42)
    bar_h = max(6, int(size * 0.055))
    gap = int(size * 0.045)
    left = (size - bar_w) // 2
    top = int(size * 0.30)
    radius = bar_h // 2
    widths = (1, 0.72, 0.48)
    for index, scale in enumerate(widths):
        fill_round_rect(buf, size, size, left, top + index * (bar_h + gap), int(bar_w * scale), bar_h, radius, WHITE)
    dot = max(8, int(size * 0.075))
    fill_circle(buf, size, size, left + bar_w - dot // 2, top - int(size * 0.06), dot // 2, accent)
    return buf


def blit(dest, dw, dh, src, sw, sh, x, y) -> None:
    for row in range(sh):
        if y + row < 0 or y + row >= dh:
            continue
        for col in range(sw):
            if x + col < 0 or x + col >= dw:
                continue
            si = row * (sw * 4 + 1) + 1 + col * 4
            if src[si + 3] == 0:
                continue
            di = (y + row) * (dw * 4 + 1) + 1 + (x + col) * 4
            dest[di:di + 4] = src[si:si + 4]


def scale(src, sw, sh, size) -> bytearray:
    out = blank(size, size, (0, 0, 0, 0))
    for y in range(size):
        sy = min(sh - 1, y * sh // size)
        for x in range(size):
            sx = min(sw - 1, x * sw // size)
            si = sy * (sw * 4 + 1) + 1 + sx * 4
            put(out, size, x, y, tuple(src[si:si + 4]), size)  # type: ignore[arg-type]
    return out


def word(buf, width, height, text, x, y, scale, color) -> None:
    cursor = x
    for ch in text:
        glyph = FONT[ch]
        for row, bits in enumerate(glyph):
            for col, bit in enumerate(bits):
                if bit != "1":
                    continue
                fill_round_rect(buf, width, height, cursor + col * scale, y + row * scale, scale, scale, 0, color)
        cursor += 6 * scale


def splash(width: int, height: int, mark: bytearray) -> bytes:
    buf = blank(width, height, BLACK)
    icon =  min(width, height) // 5
    scaled = scale(mark, 512, 512, icon)
    blit(buf, width, height, scaled, icon, icon, (width - icon) // 2, int(height * 0.40) - icon // 2)
    text_scale = max(3, icon // 28)
    text_w = 5 * 6 * text_scale - text_scale
    word(buf, width, height, "FEEDS", (width - text_w) // 2, int(height * 0.40) + icon // 2 + text_scale * 4, text_scale, WHITE)
    raw = bytes(buf)
    return png(width, height, raw)


def write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def draw_monochrome(size: int) -> bytearray:
    """A single-color mark. Android uses the alpha channel for themed icons."""
    buf = blank(size, size, (0, 0, 0, 0))
    bar_w = int(size * 0.42)
    bar_h = max(6, int(size * 0.055))
    gap = int(size * 0.045)
    left = (size - bar_w) // 2
    top = int(size * 0.30)
    radius = bar_h // 2
    widths = (1, 0.72, 0.48)
    ink = (255, 255, 255, 255)
    for index, scale_by in enumerate(widths):
        fill_round_rect(buf, size, size, left, top + index * (bar_h + gap), int(bar_w * scale_by), bar_h, radius, ink)
    dot = max(8, int(size * 0.075))
    fill_circle(buf, size, size, left + bar_w - dot // 2, top - int(size * 0.06), dot // 2, ink)
    return buf


def main() -> None:
    any_icon = draw_mark(512, BLACK, BLUE)
    mask_icon = draw_mark(512, BLUE, WHITE)
    write(ROOT / "icons" / "icon-512.png", png(512, 512, bytes(any_icon)))
    write(ROOT / "icons" / "icon-192.png", png(192, 192, bytes(scale(any_icon, 512, 512, 192))))
    write(ROOT / "icons" / "icon-maskable-512.png", png(512, 512, bytes(mask_icon)))
    write(ROOT / "icons" / "icon-monochrome-512.png", png(512, 512, bytes(draw_monochrome(512))))
    write(ROOT / "icons" / "apple-touch-icon.png", png(180, 180, bytes(scale(any_icon, 512, 512, 180))))
    shots = {
        "narrow": (1080, 1920),
        "wide": (1920, 1080),
    }
    for name, (w, h) in shots.items():
        write(ROOT / "screenshots" / f"{name}.png", splash(w, h, any_icon))
    splashes = [
        ("iphone-se", 640, 1136),
        ("iphone-8", 750, 1334),
        ("iphone-8-plus", 1242, 2208),
        ("iphone-x", 1125, 2436),
        ("iphone-xr", 828, 1792),
        ("iphone-xs-max", 1242, 2688),
        ("iphone-12", 1170, 2532),
        ("iphone-14-plus", 1284, 2778),
        ("iphone-14-pro", 1179, 2556),
        ("iphone-14-pro-max", 1290, 2796),
        ("iphone-16-pro-max", 1320, 2868),
        ("ipad", 1536, 2048),
        ("ipad-10", 1620, 2160),
        ("ipad-pro-11", 1668, 2388),
        ("ipad-pro-12", 2048, 2732),
    ]
    for name, w, h in splashes:
        write(ROOT / "splash" / f"{name}.png", splash(w, h, any_icon))
        print(name, w, h)


if __name__ == "__main__":
    main()
