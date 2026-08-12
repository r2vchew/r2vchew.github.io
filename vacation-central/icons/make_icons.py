"""Generate Route Optimizer PWA PNG icons with pure stdlib (no Pillow).

Draws the app mark: a warm-dark rounded tile with a blue location pin +
a route line, matching the mockup accent (#4f8cff on #1c1a22).
"""
import struct, zlib, math, os

ACCENT = (0x4f, 0x8c, 0xff)
BG     = (0x1c, 0x1a, 0x22)
WHITE  = (0xff, 0xff, 0xff)


def blend(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def make(size, maskable=False):
    px = bytearray([0]) * (size * size * 4)  # RGBA

    def put(x, y, rgb, alpha=255):
        if 0 <= x < size and 0 <= y < size:
            i = (y * size + x) * 4
            ca = px[i + 3]
            if alpha >= ca:
                px[i] = rgb[0]; px[i+1] = rgb[1]; px[i+2] = rgb[2]; px[i+3] = alpha

    # rounded tile background (full bleed for maskable, inset for normal)
    pad = 0 if maskable else int(size * 0.06)
    radius = 0 if maskable else int(size * 0.22)
    for y in range(size):
        for x in range(size):
            if maskable:
                put(x, y, BG, 255)
            else:
                # rounded rect test
                cx = min(max(x, pad + radius), size - pad - radius)
                cy = min(max(y, pad + radius), size - pad - radius)
                inside = (pad <= x < size - pad) and (pad <= y < size - pad)
                if inside:
                    dx = x - cx; dy = y - cy
                    if dx*dx + dy*dy <= radius*radius or (abs(x-cx) <= radius and abs(y-cy) <= radius):
                        # subtle vertical gradient
                        t = y / size
                        put(x, y, blend(BG, (0x25, 0x22, 0x30), t), 255)

    cx, cy = size / 2, size * 0.46
    R = size * 0.20  # pin head radius

    # route line (behind pin) - a gentle blue curve
    steps = 400
    lw = max(2, int(size * 0.03))
    for s in range(steps):
        t = s / steps
        x = size * (0.22 + 0.56 * t)
        y = size * (0.78 - 0.30 * math.sin(t * math.pi * 0.9))
        for oy in range(-lw, lw + 1):
            for ox in range(-lw, lw + 1):
                if ox*ox + oy*oy <= lw*lw:
                    put(int(x+ox), int(y+oy), blend(ACCENT, BG, 0.35), 230)

    # pin teardrop: circle head + triangle tail
    tip_y = cy + size * 0.30
    for y in range(size):
        for x in range(size):
            dx = x - cx; dy = y - cy
            d = math.hypot(dx, dy)
            in_head = d <= R
            # tail: triangle narrowing to tip
            in_tail = False
            if cy <= y <= tip_y:
                span = R * (1 - (y - cy) / (tip_y - cy))
                if abs(x - cx) <= span:
                    in_tail = True
            if in_head or in_tail:
                put(x, y, ACCENT, 255)

    # inner white dot
    r2 = size * 0.075
    for y in range(int(cy - r2 - 2), int(cy + r2 + 2)):
        for x in range(int(cx - r2 - 2), int(cx + r2 + 2)):
            if math.hypot(x - cx, y - cy) <= r2:
                put(x, y, WHITE, 255)

    return bytes(px)


def write_png(path, size, rgba):
    def chunk(typ, data):
        c = typ + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)
    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)
        raw += rgba[y*stride:(y+1)*stride]
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
    print("wrote", path, os.path.getsize(path), "bytes")


here = os.path.dirname(os.path.abspath(__file__))
write_png(os.path.join(here, "icon-192.png"), 192, make(192))
write_png(os.path.join(here, "icon-512.png"), 512, make(512))
write_png(os.path.join(here, "icon-maskable-512.png"), 512, make(512, maskable=True))
