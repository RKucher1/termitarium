#!/usr/bin/env python3
"""Generate viewer/favicon.png from the same geometry as viewer/favicon.svg.

    python3 tools/gen-favicon.py

MAINTAINER TOOL. Not needed at runtime and not shipped to users. It exists so
the committed PNG is reproducible rather than an opaque binary — run it and
diff if you ever doubt what the bytes are.

Safari does not load SVG favicons from data: URIs, so numbatd serves this PNG
at /favicon.ico. The inline SVG stays in viewer.html for the file:// case,
where there is no server to fetch anything from.

Standard library only: zlib and struct. No Pillow, no network.
"""

import struct
import zlib
import pathlib

SIZE = 32
RADIUS = 7

BG = (0x17, 0x13, 0x10)  # --bark
RUST = (0xC9, 0x55, 0x2B)  # --rufous
BONE = (0xED, 0xE6, 0xDA)  # --band

# x, y, w, h, colour — identical to the <rect> list in favicon.svg
BARS = [
    (6, 17, 4, 9, RUST),
    (12, 11, 4, 15, BONE),
    (18, 7, 4, 19, RUST),
    (24, 14, 3, 12, BONE),
]


def inside_rounded_rect(x, y, size, radius):
    """True if pixel centre (x, y) falls inside a rounded square."""
    cx = min(max(x + 0.5, radius), size - radius)
    cy = min(max(y + 0.5, radius), size - radius)
    dx, dy = (x + 0.5) - cx, (y + 0.5) - cy
    return dx * dx + dy * dy <= radius * radius


def build_pixels():
    rows = []
    for y in range(SIZE):
        row = []
        for x in range(SIZE):
            if not inside_rounded_rect(x, y, SIZE, RADIUS):
                row.append((0, 0, 0, 0))  # transparent outside the corner
                continue
            colour = BG
            for bx, by, bw, bh, c in BARS:
                if bx <= x < bx + bw and by <= y < by + bh:
                    colour = c
                    break
            row.append((colour[0], colour[1], colour[2], 255))
        rows.append(row)
    return rows


def chunk(tag, data):
    out = struct.pack(">I", len(data)) + tag + data
    return out + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def encode_png(rows):
    raw = bytearray()
    for row in rows:
        raw.append(0)  # filter type 0 (None) — keeps the encoder trivial
        for r, g, b, a in row:
            raw += bytes((r, g, b, a))

    ihdr = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)  # 8-bit RGBA
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def main():
    out = pathlib.Path(__file__).resolve().parent.parent / "viewer" / "favicon.png"
    png = encode_png(build_pixels())
    out.write_bytes(png)
    print(f"wrote {out} ({len(png)} bytes, {SIZE}x{SIZE} RGBA)")


if __name__ == "__main__":
    main()
