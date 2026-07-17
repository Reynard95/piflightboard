#!/usr/bin/env python3
"""
Regenerate logos.h for the ESP32 e-paper flight board using airline logos
from the repo's images/airline_logos/ directory.

Run from the repo root (or from this sketch folder):
    python esp32-epaper/FlightBoard_EPaper/gen_logos.py

Each logo is pre-converted at build time to a 64x64 1-bit XBM bitmap and
embedded directly in flash (PROGMEM) — same technique as the AMOLED board's
gen_logos.py, just 1-bit instead of RGB565 since this display is monochrome.
This replaces fetching + decoding a PNG on-device at runtime (which needed
PNGdec and was the source of the "logos render as a black blob" / "light
logos vanish" bugs): pre-baking means the alpha-aware thresholding only has
to be gotten right once, here, in a well-tested library, not every boot.

Ink/background decision per pixel:
  - If the source PNG has real transparency, use its ALPHA channel directly:
    any sufficiently-opaque pixel is "solid logo ink" regardless of its own
    color (so light-colored logo marks render solid instead of vanishing),
    and only truly transparent pixels are left as background.
  - If the source PNG has no real transparency (flat/opaque image), fall
    back to a luma threshold against the pixel's own color.
"""

import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Install Pillow first:  pip install Pillow")

# ── configuration ──────────────────────────────────────────────────────────────

LOGO_DIR = Path(__file__).parent / "../../images/airline_logos"
DST      = Path(__file__).parent / "logos.h"
W = H    = 64   # pixel dimensions — matches the .ino's LOGO_SIZE

# Trimmed from esp32-amoled/arduino-radar/ESP32_Radar/gen_logos.py's list —
# dropped carriers with no plausible NL/EU presence (domestic-only on other
# continents: VIV, WJA, TAM, PAL, HVN, GLO, NAX, BPA, CJT, FCA, TUA) to cut
# compile time further. If scripts/settings-api.py's logo_gaps.json shows
# real traffic under a dropped code, add it back here — KNOWN_LOGO_ICAOS in
# settings-api.py must stay in sync with this list.
INCLUDE = [
    "AAL","AAR","ABY","ACA","AEA","AEE","AFR","AHK","AMX","ANA","ANZ","ASA",
    "ATN","AUA","AVA","AZA","AZU","BAW","BCY","BEE","BEL","BTI","CCA",
    "CES","CFG","CPA","CSA","CSN","DAL","DLH","EIN","EJU","ELY","ETD",
    "ETH","EVA","EWG","EXS","EZS","EZY","FDB","FDX","FIN","GIA",
    "IBE","IBS","ICE","JAL","JBU","KAC","KAL","KLM","KQA","LAM","LAN",
    "LBT","LOT","MAS","MEA","MSR","NOZ","OAL","OAW","PGT","QFA",
    "QTR","RAM","RJA","ROT","RYR","SAA","SAS","SIA","SVA","SWA","SWR","SXS",
    "TAP","TFL","THA","THY","TOM","TRA","TRS","TUI","UAE","UAL",
    "UPS","VLG","WUK","WZZ",
]

# alpha >= this (0-255) counts as "opaque enough" to be ink
ALPHA_THRESHOLD = 128
# for images with no real alpha channel, luma below this (0-255) is ink
LUMA_THRESHOLD  = 190
# alpha channel must dip below this somewhere to count as "has real transparency"
ALPHA_VARIES_BELOW = 250

# Per-icon knobs for logos the defaults above get wrong — rather than retune
# the global thresholds (and risk regressing the ~70 other logos that render
# fine today), override just the offenders:
#
#   LUMA_OVERRIDE: DLH (Lufthansa) fills its whole canvas edge-to-edge with
#   a yellow whose luma (~184) sits just 6 units under LUMA_THRESHOLD — tiny
#   Lanczos resize ringing at the crane/ring edges flips scattered pixels
#   across that razor-thin margin, producing the dashed/"incomplete line"
#   look. VLG (Vueling) has the same problem the other way: its yellow
#   badge (~luma 153) is well *under* 190, so the whole disc reads as ink
#   and swallows the darker wordmark inside it ("just black"). Each needs a
#   threshold that sits between that icon's own badge-fill luma and its
#   ink-mark luma instead of the global default.
#
#   FORCE_NO_ALPHA: VLG's source PNG is fully opaque (white background,
#   alpha 255) but a handful of anti-aliased edge pixels dip to alpha 167 —
#   just enough to trip the "has real transparency" heuristic below and
#   make the whole image ink regardless of color. Force it onto the luma
#   path instead, where LUMA_OVERRIDE above applies.
#
#   INVERT: KLM's logo is white crown/wordmark on a *solid blue* square, so
#   the luma rule (correctly) marks the dark blue fill as ink and the white
#   mark as background — the opposite of every other logo's "ink = the
#   mark" convention, and it reads as a heavy solid block next to them.
#   Invert just this one so the crown/wordmark become the ink.
LUMA_OVERRIDE   = {"DLH": 110, "VLG": 125}
FORCE_NO_ALPHA  = {"VLG"}
INVERT          = {"KLM"}

# ── helpers ────────────────────────────────────────────────────────────────────

def img_to_mono_bits(icao: str, path: Path) -> list[int]:
    img   = Image.open(path).convert("RGBA")
    alpha = img.split()[3]
    has_real_alpha = alpha.getextrema()[0] < ALPHA_VARIES_BELOW and icao not in FORCE_NO_ALPHA
    luma_threshold = LUMA_OVERRIDE.get(icao, LUMA_THRESHOLD)
    invert = icao in INVERT

    bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
    bg.paste(img, mask=alpha)
    gray    = bg.convert("RGB").resize((W, H), Image.LANCZOS).convert("L")
    alpha_r = alpha.resize((W, H), Image.LANCZOS)

    bits = []
    for y in range(H):
        for x in range(W):
            if has_real_alpha:
                ink = alpha_r.getpixel((x, y)) >= ALPHA_THRESHOLD
            else:
                ink = gray.getpixel((x, y)) < luma_threshold
            if invert:
                ink = not ink
            bits.append(1 if ink else 0)
    return bits

def bits_to_xbm_bytes(bits: list[int]) -> list[int]:
    """Pack into XBM byte order: LSB-first per row (bit0 = leftmost column),
    matching u8g2's drawXBM/drawXBMP convention."""
    out = []
    for y in range(H):
        row = bits[y*W:(y+1)*W]
        for bx in range(0, W, 8):
            byte = 0
            for i in range(8):
                if row[bx + i]:
                    byte |= (1 << i)
            out.append(byte)
    return out

# ── generate ───────────────────────────────────────────────────────────────────

found = []
for icao in INCLUDE:
    src = LOGO_DIR / f"airline_logo_{icao}.png"
    if not src.exists():
        print(f"  SKIP {icao} — not found in repo")
        continue
    found.append((icao, bits_to_xbm_bytes(img_to_mono_bits(icao, src))))
    print(f"  OK {icao}")

found.sort(key=lambda t: t[0])   # binary search needs sorted keys
BPR   = W // 8         # bytes per row
BYTES = BPR * H         # bytes per logo

lines = [
    "// Auto-generated by gen_logos.py — do not edit manually.",
    f"// Source: images/airline_logos/   Size: {W}x{H} 1-bit XBM (monochrome)",
    "#pragma once",
    "#include <pgmspace.h>",
    "#include <string.h>",
    "#include <ctype.h>",
    "",
    f"#define LOGO_SIZE   {W}",
    f"#define LOGO_BPR    {BPR}",
    f"#define LOGO_BYTES  {BYTES}",
    f"#define LOGO_COUNT  {len(found)}",
    "",
    f"static const uint8_t LOGO_DATA[{len(found)} * LOGO_BYTES] PROGMEM = {{",
]
for icao, data in found:
    lines.append(f"  // {icao}")
    for i in range(0, len(data), BPR):
        row = data[i:i+BPR]
        lines.append("  " + ",".join(f"0x{v:02X}" for v in row) + ",")
lines += [
    "};",
    "",
    "struct AirlogoIdx { char icao[4]; uint16_t idx; };",
    f"static const AirlogoIdx LOGO_IDX[{len(found)}] PROGMEM = {{",
]
for i, (icao, _) in enumerate(found):
    lines.append(f'  {{"{icao}", {i}}},')
lines += [
    "};",
    "",
    "// Binary search — LOGO_IDX must stay sorted by icao (gen_logos.py sorts it).",
    "static const uint8_t* logoForCallsign(const char* cs) {",
    "  if (!cs || !cs[0]) return nullptr;",
    "  char key[4] = {0};",
    "  int n = 0;",
    "  while (n < 3 && cs[n] && isalpha((uint8_t)cs[n])) { key[n] = toupper((uint8_t)cs[n]); n++; }",
    "  if (n < 2) return nullptr;",
    "  int lo = 0, hi = LOGO_COUNT - 1;",
    "  while (lo <= hi) {",
    "    int mid = (lo + hi) / 2;",
    "    char mkey[4];",
    "    memcpy_P(mkey, LOGO_IDX[mid].icao, 4);",
    "    int cmp = strncmp(key, mkey, 3);",
    "    if (cmp == 0) {",
    "      uint16_t idx = pgm_read_word(&LOGO_IDX[mid].idx);",
    "      return LOGO_DATA + (uint32_t)idx * LOGO_BYTES;",
    "    }",
    "    if (cmp < 0) hi = mid - 1; else lo = mid + 1;",
    "  }",
    "  return nullptr;",
    "}",
]

DST.write_text("\n".join(lines) + "\n", encoding="utf-8")
total_kb = len(found) * BYTES // 1024
print(f"\nWritten {len(found)}/{len(INCLUDE)} logos to {DST.name}")
print(f"PROGMEM usage: ~{total_kb} KB")
