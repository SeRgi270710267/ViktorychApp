#!/usr/bin/env python3
"""Install icons and splash screens.

The shipped mark is the Viktorych V from scripts/brand_assets.py.
This file no longer draws a logo of its own.
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BLUE = (29, 155, 240, 255)
WHITE = (255, 255, 255, 255)
BLACK = (0, 0, 0, 255)

# 5x7 glyphs for the splash wordmark. The home-screen icons stay the feed glyph.
SITE_WORD = "VIKTORYCHAPP"
FONT = {
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "E": ["11110", "10000", "11100", "10000", "10000", "10000", "11110"],
    "I": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "C": ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
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
    while text_scale > 2 and (len(SITE_WORD) * 6 * text_scale - text_scale) > width - 48:
        text_scale -= 1
    text_w = len(SITE_WORD) * 6 * text_scale - text_scale
    word(buf, width, height, SITE_WORD, (width - text_w) // 2, int(height * 0.40) + icon // 2 + text_scale * 4, text_scale, WHITE)
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
    from brand_assets import generate
    generate()


if __name__ == "__main__":
    main()
