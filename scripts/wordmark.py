#!/usr/bin/env python3
"""Draw the SIntelApp wordmark from Inter outlines.

SI is Inter Black and a little larger. ntelApp is Inter Regular.
The spelling is S-I-n-t-e-l-A-p-p. The files are vectors, not a scaled photo.
"""

from __future__ import annotations

import re
import struct
from pathlib import Path

import cairosvg
import uharfbuzz as hb
from fontTools.misc.transform import Transform
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
BLACK_CANDIDATES = [
    Path("/tmp/fonts/Inter-Black.ttf"),
    Path("/usr/share/fonts/truetype/macos/Inter-Bold.ttf"),
]
REGULAR = Path("/usr/share/fonts/truetype/macos/Inter-Regular.ttf")
SUB_FONT = Path("/usr/share/fonts/truetype/macos/Inter-Bold.ttf")
HEAVY = "SI"
LIGHT = "ntelApp"
HEAVY_SCALE = 1.1
GAP = 80


def black_font() -> Path:
    for path in BLACK_CANDIDATES:
        if path.is_file():
            return path
    raise SystemExit("Inter Black or Bold is not installed")


def shape(path: Path, text: str) -> list[tuple[str, float, float]]:
    blob = hb.Blob.from_file_path(str(path))
    face = hb.Face(blob)
    font = hb.Font(face)
    font.scale = (face.upem, face.upem)
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf)
    tt = TTFont(path)
    placed = []
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        placed.append((tt.getGlyphName(info.codepoint), float(pos.x_advance), float(pos.x_offset)))
    return placed


def run_path(font_path: Path, placed, scale: float, x: float) -> tuple[str, float, tuple[float, float, float, float]]:
    """Draw a run on the baseline y=0 in SVG space (y grows downward)."""
    tt = TTFont(font_path)
    gs = tt.getGlyphSet()
    commands = []
    cursor = x
    box = None
    for name, advance, offset in placed:
        pen = BoundsPen(gs)
        gs[name].draw(pen)
        x0, y0, x1, y1 = pen.bounds
        left = cursor + offset * scale + x0 * scale
        right = cursor + offset * scale + x1 * scale
        top = -(y1 * scale)
        bottom = -(y0 * scale)
        rect = (left, top, right, bottom)
        box = rect if box is None else (
            min(box[0], rect[0]), min(box[1], rect[1]), max(box[2], rect[2]), max(box[3], rect[3])
        )
        svg = SVGPathPen(gs)
        matrix = Transform(scale, 0, 0, -scale, cursor + offset * scale, 0)
        gs[name].draw(TransformPen(svg, matrix))
        commands.append(svg.getCommands())
        cursor += advance * scale
    return " ".join(commands), cursor, box


def round_path(commands: str) -> str:
    def repl(match: re.Match) -> str:
        value = round(float(match.group(0)), 2)
        text = f"{value:.2f}".rstrip("0").rstrip(".")
        if text in ("", "-0"):
            return "0"
        return text

    return re.sub(r"-?\d+\.\d+(?:e[+-]?\d+)?", repl, commands)


def shift_path(commands: str, dx: float, dy: float) -> str:
    tt_dummy = None
    # Rebuild by translating every coordinate pair is fragile. Draw again shifted.
    return commands  # caller draws with the translation in the glyph matrix


def compose(fill: str) -> tuple[str, str]:
    black = black_font()
    heavy = shape(black, HEAVY)
    light = shape(REGULAR, LIGHT)
    heavy_d, cursor, heavy_box = run_path(black, heavy, HEAVY_SCALE, 0)
    light_d, end, light_box = run_path(REGULAR, light, 1, cursor + GAP)
    box = (
        min(heavy_box[0], light_box[0]),
        min(heavy_box[1], light_box[1]),
        max(heavy_box[2], light_box[2]),
        max(heavy_box[3], light_box[3]),
    )
    full = fit(black, heavy, light, box, fill, "SIntelApp")
    si = fit_si(black, heavy, fill)
    return full, si


def fit(black, heavy, light, box, fill: str, title: str) -> str:
    x0, y0, x1, y1 = box
    width = x1 - x0
    height = y1 - y0
    heavy_d, cursor, _heavy_box = run_path(black, heavy, HEAVY_SCALE, -x0)
    light_d, _end, _light_box = run_path(REGULAR, light, 1, cursor + GAP)
    # run_path baseline is 0. Ink top is negative. Shift down by -y0 so top is 0.
    # y0 is the top (smaller svg y). Translating by -y0 moves top to 0.
    path = translate_commands(heavy_d + " " + light_d, 0, -y0)
    return svg_doc(width, height, path, fill, title)


def fit_si(black, heavy, fill: str) -> str:
    _d, _cursor, box = run_path(black, heavy, HEAVY_SCALE, 0)
    x0, y0, x1, y1 = box
    d, _cursor, _box = run_path(black, heavy, HEAVY_SCALE, -x0)
    path = translate_commands(d, 0, -y0)
    return svg_doc(x1 - x0, y1 - y0, path, fill, "SI")


def translate_commands(commands: str, dx: float, dy: float) -> str:
    if dx == 0 and dy == 0:
        return commands

    def repl(match: re.Match) -> str:
        kind = match.group(1)
        numbers = [float(item) for item in re.findall(r"-?\d+(?:\.\d+)?", match.group(2))]
        if kind in ("M", "L", "T"):
            pairs = [(numbers[i] + dx, numbers[i + 1] + dy) for i in range(0, len(numbers), 2)]
        elif kind == "C":
            pairs = []
            for i in range(0, len(numbers), 6):
                pairs.extend((
                    (numbers[i] + dx, numbers[i + 1] + dy),
                    (numbers[i + 2] + dx, numbers[i + 3] + dy),
                    (numbers[i + 4] + dx, numbers[i + 5] + dy),
                ))
        elif kind == "Q":
            pairs = []
            for i in range(0, len(numbers), 4):
                pairs.extend((
                    (numbers[i] + dx, numbers[i + 1] + dy),
                    (numbers[i + 2] + dx, numbers[i + 3] + dy),
                ))
        elif kind == "H":
            return kind + " " + " ".join(str(n + dx) for n in numbers)
        elif kind == "V":
            return kind + " " + " ".join(str(n + dy) for n in numbers)
        else:
            return match.group(0)
        body = " ".join(f"{x:.2f} {y:.2f}" for x, y in pairs)
        return kind + " " + body

    return re.sub(r"([MLCQTHV])([^MLCQTHVZ]*)", repl, commands)


def svg_doc(width: float, height: float, commands: str, fill: str, title: str) -> str:
    path = round_path(commands)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.2f} {height:.2f}" '
        f'fill="{fill}" role="img" aria-label="{title}">'
        f"<title>{title}</title><path d=\"{path}\"/></svg>"
    )


def path_of(svg: str) -> str:
    return re.search(r'<path d="([^"]+)"/>', svg).group(1)


def view_of(svg: str) -> tuple[float, float]:
    found = re.search(r'viewBox="0 0 ([0-9.]+) ([0-9.]+)"', svg)
    return float(found.group(1)), float(found.group(2))


def placed_mark(word_svg: str, size: int, ratio: float, monochrome: bool) -> str:
    mark_w, mark_h = view_of(word_svg)
    target = size * ratio
    scale = target / mark_w
    draw_w = mark_w * scale
    draw_h = mark_h * scale
    x = (size - draw_w) / 2
    y = (size - draw_h) / 2
    background = "" if monochrome else f'<rect width="{size}" height="{size}" fill="#000"/>'
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">'
        f"{background}<g transform=\"translate({x:.2f} {y:.2f}) scale({scale:.6f})\">"
        f'<path fill="#fff" d="{path_of(word_svg)}"/></g></svg>'
    )


def favicon_svg(si: str) -> str:
    mark_w, mark_h = view_of(si)
    size = 32
    scale = 18 / mark_w
    draw_w = mark_w * scale
    draw_h = mark_h * scale
    x = (size - draw_w) / 2
    y = (size - draw_h) / 2
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
        "<!-- SIntelApp -->"
        '<rect width="32" height="32" rx="7" fill="#000"/>'
        f'<g transform="translate({x:.2f} {y:.2f}) scale({scale:.6f})">'
        f'<path fill="#fff" d="{path_of(si)}"/></g></svg>'
    )


def splash_svg(word: str, width: int, height: int) -> str:
    mark_w, mark_h = view_of(word)
    target = min(width * 0.72, height * 0.62)
    scale = target / mark_w
    draw_w = mark_w * scale
    draw_h = mark_h * scale
    x = (width - draw_w) / 2
    y = (height - draw_h) / 2
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">'
        f'<rect width="{width}" height="{height}" fill="#000"/>'
        f'<g transform="translate({x:.2f} {y:.2f}) scale({scale:.6f})">'
        f'<path fill="#fff" d="{path_of(word)}"/></g></svg>'
    )


def normalized_run(font_path: Path, text: str, scale: float = 1.0):
    placed = shape(font_path, text)
    commands, _cursor, box = run_path(font_path, placed, scale, 0)
    path = round_path(translate_commands(commands, -box[0], -box[1]))
    return path, box[2] - box[0], box[3] - box[1]


def stack_block(si, sub, target_w: float, sub_width_ratio: float = 0.98, gap_ratio: float = 0.05):
    _si_path, si_w, si_h = si
    _sub_path, sub_w, sub_h = sub
    si_scale = target_w / si_w
    sub_target = target_w * sub_width_ratio
    sub_scale = sub_target / sub_w
    si_draw_h = si_h * si_scale
    sub_draw_h = sub_h * sub_scale
    gap = target_w * gap_ratio
    total_h = si_draw_h + gap + sub_draw_h
    sub_x = (target_w - sub_target) / 2
    return si_scale, sub_scale, si_draw_h, gap, sub_x, sub_draw_h, target_w, total_h


def largest_stack(si, sub, limit: float):
    lo, hi = 1.0, limit
    best = stack_block(si, sub, lo)
    for _ in range(28):
        mid = (lo + hi) / 2
        metrics = stack_block(si, sub, mid)
        if metrics[6] <= limit + 0.01 and metrics[7] <= limit + 0.01:
            best = metrics
            lo = mid
        else:
            hi = mid
    return best


def inside_round(x: float, y: float, size: int, radius: float, margin: float = 1.0) -> bool:
    if x < margin or y < margin or x > size - margin or y > size - margin:
        return False
    if radius <= 0:
        return True
    if radius <= x <= size - radius or radius <= y <= size - radius:
        return True
    cx = radius if x < size / 2 else size - radius
    cy = radius if y < size / 2 else size - radius
    limit = max(0.0, radius - margin)
    return (x - cx) ** 2 + (y - cy) ** 2 <= limit ** 2


def stack_fits(metrics, size: int, radius: float) -> bool:
    width, height = metrics[6], metrics[7]
    # Keep a couple of pixels of white between the ink and the tile edge.
    if width > size - 6 or height > size - 6:
        return False
    x0 = (size - width) / 2
    y0 = (size - height) / 2
    sub_w = width * 0.98
    sx = (size - sub_w) / 2
    points = (
        (x0, y0),
        (x0 + width, y0),
        (x0, y0 + metrics[2]),
        (x0 + width, y0 + metrics[2]),
        (sx, y0 + height),
        (sx + sub_w, y0 + height),
    )
    return all(inside_round(x, y, size, radius, 1.5) for x, y in points)


def largest_stack_rounded(si, sub, size: int, radius: float):
    lo, hi = 1.0, float(size)
    best = stack_block(si, sub, lo)
    for _ in range(28):
        mid = (lo + hi) / 2
        metrics = stack_block(si, sub, mid)
        if stack_fits(metrics, size, radius):
            best = metrics
            lo = mid
        else:
            hi = mid
    return best


def largest_stack_circle(si, sub, size: int, ratio: float = 0.395):
    """Fit the lockup inside the maskable safe circle (a bit inside 40%)."""
    radius = ratio * size
    lo, hi = 1.0, size * 0.8
    best = stack_block(si, sub, lo)
    for _ in range(28):
        mid = (lo + hi) / 2
        metrics = stack_block(si, sub, mid)
        if (metrics[6] / 2) ** 2 + (metrics[7] / 2) ** 2 <= radius ** 2:
            best = metrics
            lo = mid
        else:
            hi = mid
    return best


def ink_groups(si, sub, metrics, fill: str) -> str:
    si_scale, sub_scale, si_draw_h, gap, sub_x = metrics[:5]
    return (
        f'<g transform="scale({si_scale:.6f})"><path fill="{fill}" d="{si[0]}"/></g>'
        f'<g transform="translate({sub_x:.2f} {si_draw_h + gap:.2f}) scale({sub_scale:.6f})">'
        f'<path fill="{fill}" d="{sub[0]}"/></g>'
    )


def centered(group: str, block_w: float, block_h: float, size: int) -> str:
    x = (size - block_w) / 2
    y = (size - block_h) / 2
    return f'<g transform="translate({x:.2f} {y:.2f})">{group}</g>'


def icon_svg(size: int, kind: str, si, sub) -> str:
    """Home-screen marks. kind is si, any, maskable, apple, or mono.

    16 and 32 are the SI monogram. Larger tiles stack a big SI over ntelApp.
    Maskable art stays inside the safe circle on a full-bleed white square.
    Other installed tiles are white with slightly rounded corners.
    """
    if kind == "si":
        target = size * (0.68 if size <= 16 else 0.74)
        scale = target / si[1]
        draw_h = si[2] * scale
        group = f'<g transform="scale({scale:.6f})"><path fill="#000" d="{si[0]}"/></g>'
        body = centered(group, target, draw_h, size)
        radius = max(2, round(size * 0.18))
        bg = f'<rect width="{size}" height="{size}" rx="{radius}" fill="#fff"/>'
    elif kind == "maskable":
        metrics = largest_stack_circle(si, sub, size)
        body = centered(ink_groups(si, sub, metrics, "#000"), metrics[6], metrics[7], size)
        bg = f'<rect width="{size}" height="{size}" fill="#fff"/>'
    elif kind == "mono":
        metrics = largest_stack_circle(si, sub, size)
        body = centered(ink_groups(si, sub, metrics, "#000"), metrics[6], metrics[7], size)
        bg = ""
    elif kind == "apple":
        # iOS masks the square. Transparent corners would come back black.
        metrics = largest_stack(si, sub, size * 0.80)
        body = centered(ink_groups(si, sub, metrics, "#000"), metrics[6], metrics[7], size)
        bg = f'<rect width="{size}" height="{size}" fill="#fff"/>'
    else:
        radius = max(3, round(size * 0.12))
        metrics = largest_stack_rounded(si, sub, size, radius)
        body = centered(ink_groups(si, sub, metrics, "#000"), metrics[6], metrics[7], size)
        bg = f'<rect width="{size}" height="{size}" rx="{radius}" fill="#fff"/>'
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">'
        f"<!-- SIntelApp -->{bg}{body}</svg>"
    )


def favicon_document(si) -> str:
    size = 32
    target = size * 0.74
    scale = target / si[1]
    draw_h = si[2] * scale
    group = f'<g transform="scale({scale:.6f})"><path fill="#000" d="{si[0]}"/></g>'
    body = centered(group, target, draw_h, size)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
        "<!-- SIntelApp -->"
        '<rect width="32" height="32" rx="6" fill="#fff"/>'
        f"{body}</svg>"
    )


def ico_bytes(pngs: list[tuple[int, bytes]]) -> bytes:
    count = len(pngs)
    offset = 6 + 16 * count
    entries = []
    blobs = []
    for size, data in pngs:
        dim = 0 if size >= 256 else size
        entries.append(struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset))
        offset += len(data)
        blobs.append(data)
    return struct.pack("<HHH", 0, 1, count) + b"".join(entries) + b"".join(blobs)


def draw_app_icons() -> None:
    """Installed icons only. Sidebar, header, and splash stay white on black."""
    si = normalized_run(black_font(), "SI", HEAVY_SCALE)
    sub = normalized_run(SUB_FONT, LIGHT, 1)
    write(ROOT / "favicon.svg", favicon_document(si))
    rasters = {
        "icon-192.png": (icon_svg(192, "any", si, sub), 192),
        "icon-512.png": (icon_svg(512, "any", si, sub), 512),
        "icon-maskable-512.png": (icon_svg(512, "maskable", si, sub), 512),
        "icon-monochrome-512.png": (icon_svg(512, "mono", si, sub), 512),
        "apple-touch-icon.png": (icon_svg(180, "apple", si, sub), 180),
    }
    for name, (svg, size) in rasters.items():
        write(ROOT / "icons" / name, png_from_svg(svg, size, size))
        print(name)
    frames = []
    for size, kind in ((16, "si"), (32, "si"), (48, "any"), (256, "any")):
        frames.append((size, png_from_svg(icon_svg(size, kind, si, sub), size, size)))
        print("ico", size)
    write(ROOT / "favicon.ico", ico_bytes(frames))


def png_from_svg(svg: str, width: int, height: int) -> bytes:
    return cairosvg.svg2png(bytestring=svg.encode("utf-8"), output_width=width, output_height=height)


def write(path: Path, data: bytes | str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(data, str):
        path.write_text(data, encoding="utf-8")
    else:
        path.write_bytes(data)


def main() -> None:
    full, si = compose("#fff")
    # UI copies use currentColor so the theme can invert them.
    ui_full = full.replace('fill="#fff"', 'fill="currentColor"', 1)
    ui_si = si.replace('fill="#fff"', 'fill="currentColor"', 1)
    write(ROOT / "logo" / "wordmark.svg", ui_full)
    write(ROOT / "logo" / "si.svg", ui_si)
    draw_app_icons()
    for name, w, h in (("narrow", 1080, 1920), ("wide", 1920, 1080)):
        write(ROOT / "screenshots" / f"{name}.png", png_from_svg(splash_svg(full, w, h), w, h))
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
        write(ROOT / "splash" / f"{name}.png", png_from_svg(splash_svg(full, w, h), w, h))
        print("splash", name)
    write(ROOT / "logo" / "preview.png", png_from_svg(splash_svg(full, 1400, 360), 1400, 360))
    write(ROOT / "logo" / "si-preview.png", png_from_svg(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120"><rect width="240" height="120" fill="#000"/>'
        f'<g transform="translate(20 20) scale({80 / view_of(si)[1]:.4f})"><path fill="#fff" d="{path_of(si)}"/></g></svg>',
        240, 120,
    ))


if __name__ == "__main__":
    main()
