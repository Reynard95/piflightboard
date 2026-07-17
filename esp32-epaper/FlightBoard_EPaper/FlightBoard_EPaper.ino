/*
  FlightBoard_RLCD — Waveshare ESP32-S3-RLCD-4.2
  ──────────────────────────────────────────────────────────────────────────────
  Design language matches the ESP32-S3 AMOLED Flight Board:
  bubble cards with rounded-rect borders, inverted chrome bars (top/bottom),
  "LIVE TELEMETRY" section label with extending rule, route banner.

  Layout (landscape 400×300): 

  ┌─────────────────────────────────────────────────────────────────────────┐
  │ FLIGHTBOARD                    12:34                  ▂▄▆█  [ ⚡ ]▷   │  ← status bar (title | clock | wifi bars + battery; bolt replaces the fill bar while charging)
  ├─────────┬─────────────────────────────────────┬─────────────────────────┤
  │         │┌───────────────────────────────────┐│ ┌─────────────────────┐ │
  │  KLM    ││  CALLSIGN                         ││ │  TAIL               │ │
  │  logo   ││        KLM1234                    ││ │      PH-BXA         │ │  ← header (88 px tall; sub-text row is MILITARY/PRIVATE only, no airline name)
  │  bubble ││                                   ││ │  BOEING 737-800     │ │
  │  (88px) │└───────────────────────────────────┘│ └─────────────────────┘ │
  ├─────────┴─────────────────────────────────────┴─────────────────────────┤
  │ LIVE TELEMETRY ──────────────────────────────────────────────────────── │
  │ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                      │
  │ │  ALTITUDE    │ │  V-SPEED     │ │  GND SPD     │                      │  ← bubble grid row 1
  │ │    32100     │ │    +1200     │ │     456      │                      │
  │ │     FT       │ │     FPM      │ │     KTS      │                      │
  │ └──────────────┘ └──────────────┘ └──────────────┘                      │
  │ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                      │
  │ │  HEADING     │ │  DISTANCE    │ │  STATUS      │                      │  ← bubble grid row 2
  │ │    180°      │ │    59.4      │ │  CLIMBING    │                      │
  │ │     S        │ │     KM       │ │              │                      │
  │ └──────────────┘ └──────────────┘ └──────────────┘                      │
  │ ┌───────────────────────────────────────────────────────────┐ ┌───────┐ │
  │ │                          ROUTE                              │ │  .N.  │ │
  │ │ AMS ─────────────✈︎────────────────────────────────── LHR │ │ .  ↗  │ │  ← route banner (narrower) + compass panel
  │ │ Amsterdam Schiphol         1:30            London Heathrow  │ │  ...  │ │     (needle = aircraft bearing, rotated
  │ └───────────────────────────────────────────────────────────┘ └───────┘ │      by screen facing_deg from RLCDsettings.html)
  ├──────┬──────┬──────┬──────┬──────┬──────┬──────┬────────────────────────┤
  │ SRC  │ SIG  │ SQK  │ MACH │ IAS  │ OAT  │ HDG  │ MSGS                   │  ← telem strip
  │ADS-B │ -18  │ 2245 │.783  │280KT │ -42  │ 182° │ 12345                  │
  ├──────┴──────┴──────┴──────┴──────┴──────┴──────┴────────────────────────┤
  │ 5 AC │          │ KLM1234 │[BAW456]│ AFR789 │ KLM1252 │ BAW460 │ AFR845 │  ← footer strip: callsign cells right-aligned to the bar edge (dead space, if any, sits after "N AC" instead of trailing off the end); on-screen aircraft ([BAW456]) punched out to normal colours
  └──────┴──────────┴─────────┴────────┴────────┴─────────┴────────┴────────┘

  Boot button (GPIO 0): short press toggles display colour inversion.

  BEFORE COMPILING — copy into this sketch folder:
    ST7305_U8g2.h  and  ST7305_U8g2.cpp
  from: https://github.com/waveshareteam/ESP32-S3-RLCD-4.2/tree/main/02_Example/Arduino/10_U8G2_Test/

  Libraries (Arduino Library Manager):   U8g2   ArduinoJson
  Board settings: ESP32S3 Dev Module | USB CDC: Enabled | PSRAM: Disabled
                  Partition: Huge APP (3MB No OTA/1MB SPIFFS)
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <U8g2lib.h>
#include <math.h>
#include "ST7305_U8g2.h"
#include "A3_xbm.h"
#include "plane_xbm.h"
#include "logos.h"
#include "secrets.h"

// ── DISPLAY PINS ──────────────────────────────────────────────────────────────
#define RLCD_SCK    11
#define RLCD_MOSI   12
#define RLCD_DC      5
#define RLCD_CS     40
#define RLCD_RST    41

static ST7305_U8g2 lcd(RLCD_SCK, RLCD_MOSI, RLCD_DC, RLCD_CS, RLCD_RST);
static U8G2* u8g2 = nullptr;

// ── CANVAS (400×300 after U8G2_R1 rotation) ──────────────────────────────────
#define W  400
#define H  300

// ── FONTS ─────────────────────────────────────────────────────────────────────
// _tf = full charset (needed for ° 0xB0)
#define FONT_TINY  u8g2_font_5x7_tr       // 5×7 px — labels, section headers
#define FONT_SM    u8g2_font_helvR08_tf   // ~8 pt  — sub-text, telem values
#define FONT_MD    u8g2_font_helvR12_tf   // ~12 pt — bubble values, airports
#define FONT_LG    u8g2_font_helvB18_tf   // ~18 pt — logo bubble text

// ── DESIGN CONSTANTS (AMOLED aviation language → monochrome) ─────────────────
#define DS_M    4           // outer margin
#define DS_G    6           // inter-bubble gap
#define DS_R    4           // drawRFrame corner radius

// Top chrome bar
#define SB_H    20
#define SB_BASE 13

// Header zone: logo bubble left + callsign + tail bubbles side-by-side right
#define HDR_Y   (SB_H + 2)                      // 22
#define HDR_H   88
#define LOGO_W  88
#define ID_X    (DS_M + LOGO_W + DS_G)          // 98
#define ID_W    (W - ID_X - DS_M)               // 298
#define CS_W    182                              // callsign bubble (bigger)
#define RG_X    (ID_X + CS_W + DS_G)            // 286 — tail bubble x
#define RG_W    (ID_W - CS_W - DS_G)            // 110 — tail bubble width

// Section label "LIVE TELEMETRY"
#define SL_Y    (HDR_Y + HDR_H + 2)             // 112

// 2×3 bubble grid
#define BG_Y    (SL_Y + 13)                     // 125
#define BW      ((W - 2*DS_M - 2*DS_G) / 3)    // 126 px per bubble
#define BH      40                              // bubble height
#define BCX(c)  (DS_M + (c) * (BW + DS_G))     // col x: 0→4, 1→136, 2→268
#define BR2_Y   (BG_Y + BH + DS_G)             // 171 — row 2 top

// Route banner + compass panel (square, same height, right of the banner)
#define RT_Y    (BR2_Y + BH + DS_G)             // 217
#define RT_H    36
#define CMP_SIZE RT_H                            // 36 — square, matches banner height
#define CMP_X   (W - DS_M - CMP_SIZE)            // 360 — right-aligned
#define RT_W    (CMP_X - DS_G - DS_M)            // 350 — banner shrinks to make room

// Telem strip (flat, no card borders — like AMOLED's status bar content)
#define TL_Y    (RT_Y + RT_H + 4)               // 257
#define TL_H    18
#define TL_N    8
#define TL_CW   (W / TL_N)                      // 50 px per cell

// Bottom chrome bar
#define FT_Y    (H - 18)                         // 282
#define FT_BASE (FT_Y + 12)

// ── AIRCRAFT DATA ─────────────────────────────────────────────────────────────
// All selection, route lookup, and enrichment now happens server-side
// (Pi's GET /api/epaper) — this struct is just a flat copy of that response.
struct AcEntry {
  char  callsign[10];
  char  reg[10];
  char  type[8];
  char  type_full[40];
  char  icao[8];
  char  squawk[6];
  char  emergency[12];
  char  src[8];
  char  origin[5];
  char  destination[5];
  char  origin_name[40];
  char  dest_name[40];
  char  airline[52];
  char  atc_callsign[16];
  bool  military;
  bool  interesting;
  bool  pia;
  bool  ladd;
  bool  is_private;       // JSON key "private" — "private" is a reserved C++ word
  float dist_km;
  float bearing_deg;      // -1 = unknown; true bearing from receiver to aircraft
  float eta_min;          // -1 = unknown
  float route_dur_min;    // -1 = unknown
  bool  on_ground;
  int   alt_ft;
  int   spd_kts;
  int   track_deg;
  int   vrate;
  float mach;
  int   ias;
  float rssi;
  int   nav_heading;
  long  messages;
  float seen;
  int   wind_dir;
  int   wind_spd;
  float oat;
};

static AcEntry   closest      = {};
static char      acList[30][10] = {};
static int       acListCount  = 0;
static int       acCount      = 0;
static char      lastKey[56]  = "";
static bool      piOnline     = false;
static unsigned long lastFetchMs = 0;
static int       lastHttpCode = 0;   // last http.GET() result, for on-screen diagnostics

// Configured from the Pi's RLCDsettings.html (GET /api/settings/epaper)
// and echoed back on every /api/epaper poll — no separate fetch needed.
static int   facingDeg       = 0;     // compass heading the mounted screen faces (0-359)
static float wifiTxPowerDbm  = 8.5f;  // applied via WiFi.setTxPower() each fetch cycle

// Boot button (GPIO 0) toggles display inversion
static bool      invertColors = false;
static bool      lastBtnState = true;   // HIGH = not pressed
static unsigned long lastBtnMs = 0;

// Airline logos are pre-baked into flash by gen_logos.py (logos.h) — see
// that script for why: fetching + decoding a PNG on-device needed PNGdec
// and was the source of persistent "black blob" / "light logos vanish"
// bugs. logoForCallsign() below is just a flash lookup, no network/decode.

// ── TEXT HELPERS ──────────────────────────────────────────────────────────────

static void drawStrR(int rx, int by, const char* s) {
  u8g2->drawStr(rx - u8g2->getStrWidth(s), by, s);
}
static void drawStrC(int cx, int by, const char* s) {
  u8g2->drawStr(cx - u8g2->getStrWidth(s) / 2, by, s);
}
static void fitStr(char* dst, size_t len, const char* s, int max_px) {
  strncpy(dst, s, len - 1); dst[len - 1] = '\0';
  while (strlen(dst) > 0 && u8g2->getStrWidth(dst) > max_px)
    dst[strlen(dst) - 1] = '\0';
}

// ── BUBBLE PRIMITIVES (AMOLED card style for monochrome) ─────────────────────

// Standard data bubble: label (small/top) → value (large/centre) → unit (small/bottom)
static void drawBubble(int x, int y, int w, int h,
                       const char* label, const char* value, const char* unit) {
  u8g2->drawRFrame(x, y, w, h, DS_R);
  u8g2->setFont(FONT_TINY);
  drawStrC(x + w/2, y + 9,  label);
  u8g2->setFont(FONT_MD);
  char vb[16]; fitStr(vb, sizeof(vb), value, w - 8);
  drawStrC(x + w/2, y + 26, vb);
  if (unit && unit[0]) {
    u8g2->setFont(FONT_TINY);
    drawStrC(x + w/2, y + 36, unit);
  }
}

// Identity bubble: label top | big value middle | sub-text bottom.
// accent=true draws double border (teal-accent equivalent for callsign bubble).
static void drawIDBubble(int x, int y, int w, int h,
                         const char* label, const char* bigVal,
                         const char* subVal, bool accent) {
  u8g2->drawRFrame(x, y, w, h, DS_R);
  if (accent) u8g2->drawRFrame(x + 1, y + 1, w - 2, h - 2, DS_R > 1 ? DS_R - 1 : 1);

  u8g2->setFont(FONT_TINY);
  drawStrC(x + w/2, y + 10, label);

  u8g2->setFont(FONT_MD);
  char vb[20]; fitStr(vb, sizeof(vb), bigVal, w - 12);
  drawStrC(x + w/2, y + h/2 + 6, vb);   // vertically centred

  if (subVal && subVal[0]) {
    u8g2->setFont(FONT_TINY);
    char sb[52]; fitStr(sb, sizeof(sb), subVal, w - 12);
    drawStrC(x + w/2, y + h - 8, sb);   // near bottom
  }
}

// XOR-invert the framebuffer if invertColors is set, then flush to display.
// Works on any U8G2 display — no driver-specific command needed.
static void applyAndSend() {
  if (invertColors) {
    uint8_t*  buf   = u8g2->getBufferPtr();
    uint16_t  bytes = u8g2->getBufferTileWidth() * u8g2->getBufferTileHeight() * 8;
    for (uint16_t i = 0; i < bytes; i++) buf[i] ^= 0xFF;
  }
  u8g2->sendBuffer();
}

// Inverted chrome bar (status bar / footer bar)
static void drawChromeBar(int y, int h, int baseline,
                          const char* left, const char* centre,
                          bool showClock = true) {
  u8g2->setDrawColor(1);
  u8g2->drawBox(0, y, W, h);
  u8g2->setDrawColor(0); u8g2->setFontMode(1);
  u8g2->setFont(FONT_TINY);
  if (left)   u8g2->drawStr(DS_M, baseline, left);
  if (centre) drawStrC(W/2, baseline, centre);
  if (showClock) {
    struct tm t;
    if (getLocalTime(&t, 0)) {
      char tb[6]; snprintf(tb, sizeof(tb), "%02d:%02d", t.tm_hour, t.tm_min);
      drawStrR(W - DS_M, baseline, tb);
    }
  }
  u8g2->setDrawColor(1); u8g2->setFontMode(0);
}

// ── STATUS ICONS (wifi bars + horizontal battery) ─────────────────────────────
// Hand-drawn rather than a u8g2 icon font glyph — the built-in "battery"
// icons are a fixed vertical shape with no proportional fill; we want a
// horizontal battery whose fill tracks the live ADC reading.
#define ICN_H       8    // shared icon height
#define BATT_W      16
#define BATT_NUB_W  2
#define WIFI_BARS   4
#define WIFI_BAR_W  2
#define WIFI_GAP    1

// GPIO4 = BAT_ADC per the Waveshare ESP32-S3-RLCD-4.2 pinout table (SYS
// column). Board divides VBAT by 3 ahead of the ADC pin; cell range is a
// standard 18650 Li-ion, 2.5V (empty) – 4.2V (full).
#define BAT_ADC_PIN     4
#define BAT_DIVIDER     3.0f
#define BAT_VOLT_EMPTY  2.5f
#define BAT_VOLT_FULL   4.2f

// No dedicated CHRG status pin is broken out on this board's pinout table,
// so "on power" is inferred from the battery trend: rising level means
// something is actively charging it. Sampled at most once every ~8s so
// back-to-back renders (e.g. the invert-toggle button) don't add noise,
// and held steady (not re-evaluated) when the level is flat so it doesn't
// flicker off once the battery tops out at 100% while still plugged in.
static bool          batteryCharging  = false;
static int           battTrendLastPct = -1;
static unsigned long battTrendLastMs  = 0;

static int readBatteryPercent() {
  uint32_t mv   = analogReadMilliVolts(BAT_ADC_PIN);
  float    vbat = (mv / 1000.0f) * BAT_DIVIDER;
  float    pctF = (vbat - BAT_VOLT_EMPTY) / (BAT_VOLT_FULL - BAT_VOLT_EMPTY) * 100.0f;
  if (pctF < 0)   pctF = 0;
  if (pctF > 100) pctF = 100;
  int pct = (int)(pctF + 0.5f);

  unsigned long now = millis();
  if (battTrendLastPct < 0) {
    battTrendLastPct = pct;
    battTrendLastMs  = now;
  } else if (now - battTrendLastMs > 8000) {
    if      (pct > battTrendLastPct) batteryCharging = true;
    else if (pct < battTrendLastPct) batteryCharging = false;
    battTrendLastPct = pct;
    battTrendLastMs  = now;
  }
  return pct;
}

// Horizontal battery outline + end nub, right-aligned at rightX. Filled
// left-to-right proportional to percent normally; while charging, the fill
// is replaced with a lightning-bolt glyph instead — a proportional fill
// bar would be invisible against itself once charge nears 100%, since both
// bolt and fill would need the same single ink color on this 1-bit display.
static void drawBatteryIcon(int rightX, int cy, int percent, bool charging) {
  int x = rightX - BATT_W - BATT_NUB_W;
  int y = cy - ICN_H / 2;
  u8g2->drawFrame(x, y, BATT_W, ICN_H);
  u8g2->drawBox(x + BATT_W, y + (ICN_H - 4) / 2, BATT_NUB_W, 4);
  if (charging) {
    int cx = x + BATT_W / 2;
    u8g2->drawLine(cx + 1, y + 1,        cx - 2, y + ICN_H / 2);
    u8g2->drawLine(cx - 2, y + ICN_H / 2, cx + 1, y + ICN_H / 2);
    u8g2->drawLine(cx + 1, y + ICN_H / 2, cx - 2, y + ICN_H - 1);
  } else {
    int fillW = (BATT_W - 4) * percent / 100;
    if (fillW > 0) u8g2->drawBox(x + 2, y + 2, fillW, ICN_H - 4);
  }
}

// Classic ascending signal-strength bars, right-aligned at rightX. `bars`
// (0-4) are filled solid; the rest are drawn as outlines.
static void drawWifiIcon(int rightX, int cy, int bars) {
  int totalW = WIFI_BARS * WIFI_BAR_W + (WIFI_BARS - 1) * WIFI_GAP;
  int baseY  = cy + ICN_H / 2;
  for (int i = 0; i < WIFI_BARS; i++) {
    int h  = (ICN_H * (i + 1)) / WIFI_BARS;
    int bx = rightX - totalW + i * (WIFI_BAR_W + WIFI_GAP);
    int by = baseY - h;
    if (i < bars) u8g2->drawBox(bx, by, WIFI_BAR_W, h);
    else          u8g2->drawFrame(bx, by, WIFI_BAR_W, h);
  }
}

static int wifiBars() {
  if (WiFi.status() != WL_CONNECTED) return 0;
  int rssi = WiFi.RSSI();
  if (rssi >= -55) return 4;
  if (rssi >= -65) return 3;
  if (rssi >= -75) return 2;
  return 1;
}

// Battery (rightmost) + wifi bars (to its left), right-aligned at rightX.
static void drawStatusIcons(int rightX, int cy) {
  int pct = readBatteryPercent();
  drawBatteryIcon(rightX, cy, pct, batteryCharging);
  int wifiRightX = rightX - BATT_W - BATT_NUB_W - 6;
  drawWifiIcon(wifiRightX, cy, wifiBars());
}

// Main dashboard status bar: title | clock (centred) | wifi + battery icons.
// Distinct from drawChromeBar() — used for the top bar on the two live
// screens (renderNoAircraft / renderAircraftScreen), which always want a
// live clock and live radio/power state, not caller-supplied centre text.
static void drawTopBar() {
  u8g2->setDrawColor(1);
  u8g2->drawBox(0, 0, W, SB_H);
  u8g2->setDrawColor(0); u8g2->setFontMode(1);
  u8g2->setFont(FONT_TINY);
  u8g2->drawStr(DS_M, SB_BASE, "FLIGHTBOARD");

  struct tm t;
  char tb[6] = "--:--";
  if (getLocalTime(&t, 0)) snprintf(tb, sizeof(tb), "%02d:%02d", t.tm_hour, t.tm_min);
  drawStrC(W/2, SB_BASE, tb);

  drawStatusIcons(W - DS_M, SB_H / 2);

  u8g2->setDrawColor(1); u8g2->setFontMode(0);
}

// Footer strip: "N AC" cell at the left, then one cell per tracked callsign
// right-aligned against the bar's right edge (rather than left-packed,
// which left dead space trailing after the last callsign whenever the list
// didn't fill the bar). All cells are inverted (chrome-bar style) except
// the one matching the aircraft currently on screen, which is punched out
// to normal colours so it stands out from the rest of the list.
static void drawFooterStrip() {
  u8g2->setDrawColor(1);
  u8g2->drawBox(0, FT_Y, W, 18);
  u8g2->setFont(FONT_TINY);

  const int pad = 6;

  char cnt[12]; snprintf(cnt, sizeof(cnt), "%d AC", acCount);
  int cntW = u8g2->getStrWidth(cnt) + pad * 2;
  if (cntW > W) cntW = W;

  // First pass: how many callsigns (from the start of the list) fit in the
  // space right of the count cell — needed up front so the list can be
  // placed flush against the right edge instead of left-packed.
  int cellW[30];
  int fitCount = 0, usedW = 0;
  for (int i = 0; i < acListCount; i++) {
    int cw = u8g2->getStrWidth(acList[i]) + pad * 2;
    if (cntW + usedW + cw > W) break;
    cellW[fitCount++] = cw;
    usedW += cw;
  }

  u8g2->setDrawColor(0); u8g2->setFontMode(1);
  drawStrC(cntW / 2, FT_BASE, cnt);

  int  x = W - usedW;
  bool prevHighlighted = false;   // "N AC" cell is never highlighted
  for (int i = 0; i < fitCount; i++) {
    const char* cs = acList[i];
    int  cw = cellW[i];
    bool isCurrent = closest.callsign[0] && strcmp(cs, closest.callsign) == 0;

    // A divider is only needed between two same-colour (inverted) cells —
    // the highlighted cell's own fill already reads as a boundary.
    if (!isCurrent && !prevHighlighted) {
      u8g2->setDrawColor(0);
      u8g2->drawVLine(x, FT_Y, 18);
    }

    if (isCurrent) {
      u8g2->setDrawColor(0); u8g2->drawBox(x, FT_Y, cw, 18);
      u8g2->setDrawColor(1); u8g2->setFontMode(0);
      drawStrC(x + cw/2, FT_BASE, cs);
    } else {
      u8g2->setDrawColor(0); u8g2->setFontMode(1);
      drawStrC(x + cw/2, FT_BASE, cs);
    }
    x += cw;
    prevHighlighted = isCurrent;
  }

  u8g2->setDrawColor(1); u8g2->setFontMode(0);
}

// ── COMPASS PANEL (right of the route banner) ─────────────────────────────────
// Screen "up" is wherever the board is physically mounted to face
// (facingDeg, 0-359 true heading, set from the Pi's RLCDsettings.html) —
// not true north — so every angle drawn here is first converted from a
// true bearing into "degrees clockwise from screen-up" by subtracting
// facingDeg, matching what a viewer standing in front of the mounted
// screen actually sees.
static void polarOffset(float angleFromUpDeg, int r, int* dx, int* dy) {
  float rad = angleFromUpDeg * (float)PI / 180.0f;
  *dx = (int)roundf(r * sinf(rad));
  *dy = -(int)roundf(r * cosf(rad));
}

static void drawCompassPanel(int x, int y, int size, float bearingDeg) {
  u8g2->drawRFrame(x, y, size, size, DS_R);
  int cx = x + size / 2;
  int cy = y + size / 2;
  int r  = size / 2 - 6;   // ring radius, leaves margin inside the frame

  u8g2->drawCircle(cx, cy, r);

  // North tick (short radial line, not a label — no room for text at this
  // panel size without it colliding with the ring).
  int nx1, ny1, nx2, ny2;
  polarOffset(-facingDeg, r,     &nx1, &ny1);
  polarOffset(-facingDeg, r - 4, &nx2, &ny2);
  u8g2->drawLine(cx + nx2, cy + ny2, cx + nx1, cy + ny1);

  if (bearingDeg < 0) return;   // unknown — bare ring + N tick only

  // Aircraft bearing as a needle from center, with a small dot at the tip.
  int bx, by;
  polarOffset(bearingDeg - facingDeg, r - 2, &bx, &by);
  u8g2->drawLine(cx, cy, cx + bx, cy + by);
  u8g2->drawDisc(cx + bx, cy + by, 2);
}

// ── LOOKUP TABLES ─────────────────────────────────────────────────────────────

static const char* compass8(int deg) {
  const char* d[] = { "N","NE","E","SE","S","SW","W","NW" };
  return d[((deg + 22) % 360) / 45];
}

static const char* srcLabel(const char* t) {
  if (!t || !t[0])              return "---";
  if (strncmp(t,"adsb",4) == 0) return "ADS-B";
  if (strcmp (t,"mlat")   == 0) return "MLAT";
  if (strncmp(t,"tisb",4) == 0) return "TIS-B";
  if (strncmp(t,"adsr",4) == 0) return "ADS-R";
  if (strcmp (t,"mode_s") == 0) return "MODE-S";
  return t;
}

// ── FORMAT HELPERS ────────────────────────────────────────────────────────────

// "H:MM" — e.g. "1:30", "0:45". minutes < 0 means "unknown".
static void fmtHM(char* buf, size_t len, float minutes) {
  if (minutes < 0) { strncpy(buf, "--:--", len); return; }
  int h = (int)minutes / 60, m = (int)minutes % 60;
  snprintf(buf, len, "%d:%02d", h, m);
}

static void buildKey(const AcEntry& a, char* buf, size_t len) {
  snprintf(buf, len, "%s|%s|%s|%s|%d|%d|%d|%d",
    a.callsign, a.squawk, a.emergency, a.on_ground ? "GND" : "",
    (a.alt_ft   / 100) * 100,
    (a.spd_kts  /   5) *   5,
    (a.track_deg/   2) *   2,
    (a.vrate    / 100) * 100);
}

// ── DATA FETCHES ──────────────────────────────────────────────────────────────

static bool fetchAircraft() {
  HTTPClient http;
  char url[96];
  snprintf(url, sizeof(url), "http://%s:%d/api/epaper", PI_IP, PI_PORT);
  http.begin(url);
  http.setTimeout(8000);
  int code = http.GET();
  lastHttpCode = code;
  if (code != HTTP_CODE_OK) {
    Serial.printf("[fetchAircraft] GET failed: %d (heap=%u)\n", code, ESP.getFreeHeap());
    http.end();
    return false;
  }

  // Small — the Pi now sends one pre-selected, pre-enriched aircraft plus a
  // short callsign list, not the full raw aircraft.json (was 48KB).
  static DynamicJsonDocument doc(4 * 1024);
  doc.clear();
  DeserializationError err = deserializeJson(doc, http.getStream());
  http.end();
  if (err) {
    Serial.printf("[fetchAircraft] JSON parse failed: %s (heap=%u)\n", err.c_str(), ESP.getFreeHeap());
    return false;
  }

  acCount = doc["count"] | 0;
  piOnline = true;

  facingDeg      = doc["facing_deg"]        | 0;
  wifiTxPowerDbm = doc["wifi_tx_power_dbm"] | 8.5f;
  WiFi.setTxPower(dbmToWifiPower(wifiTxPowerDbm));

  acListCount = 0;
  for (JsonVariant cs : doc["list"].as<JsonArray>()) {
    if (acListCount >= 30) break;
    strncpy(acList[acListCount], cs.as<const char*>(), 9);
    acList[acListCount][9] = '\0';
    acListCount++;
  }

  JsonObject ac = doc["aircraft"];
  if (ac.isNull()) return false;

  AcEntry best = {};
  strncpy(best.callsign,     ac["callsign"]     | "", 9);  best.callsign[9]     = '\0';
  strncpy(best.reg,          ac["reg"]          | "", 9);  best.reg[9]          = '\0';
  strncpy(best.type,         ac["type"]         | "", 7);  best.type[7]         = '\0';
  strncpy(best.type_full,    ac["type_full"]    | "", 39); best.type_full[39]   = '\0';
  strncpy(best.icao,         ac["icao"]         | "", 7);  best.icao[7]         = '\0';
  strncpy(best.squawk,       ac["squawk"]       | "", 5);  best.squawk[5]       = '\0';
  strncpy(best.emergency,    ac["emergency"]    | "", 11); best.emergency[11]   = '\0';
  strncpy(best.src,          ac["src"]          | "adsb", 7); best.src[7]       = '\0';
  strncpy(best.origin,       ac["origin"]       | "", 4);  best.origin[4]       = '\0';
  strncpy(best.destination,  ac["destination"]  | "", 4);  best.destination[4]  = '\0';
  strncpy(best.origin_name,  ac["origin_city"]  | "", 39); best.origin_name[39] = '\0';
  strncpy(best.dest_name,    ac["dest_city"]    | "", 39); best.dest_name[39]   = '\0';
  strncpy(best.airline,      ac["airline"]      | "", 51); best.airline[51]     = '\0';
  strncpy(best.atc_callsign, ac["atc_callsign"] | "", 15); best.atc_callsign[15]= '\0';

  best.military    = ac["military"]    | false;
  best.interesting = ac["interesting"] | false;
  best.pia         = ac["pia"]         | false;
  best.ladd        = ac["ladd"]        | false;
  best.is_private   = ac["private"]     | false;

  best.dist_km       = ac["dist_km"]       | 0.0f;
  best.bearing_deg   = ac["bearing_deg"]   | -1.0f;
  best.eta_min       = ac["eta_min"]       | -1.0f;
  best.route_dur_min = ac["route_dur_min"] | -1.0f;

  best.on_ground   = ac["on_ground"] | false;
  best.alt_ft      = ac["alt_ft"]    | 0;
  best.spd_kts     = ac["spd_kts"]   | 0;
  best.track_deg   = ac["track_deg"] | 0;
  best.vrate       = ac["vrate"]     | 0;
  best.mach        = ac["mach"]      | 0.0f;
  best.ias         = ac["ias"]       | -1;
  best.rssi        = ac["rssi"]      | -99.0f;
  best.nav_heading = ac["nav_heading"] | -1;
  best.messages    = ac["messages"]  | 0;
  best.seen        = ac["seen"]      | 0.0f;
  best.wind_dir    = ac["wind_dir"]  | -1;
  best.wind_spd    = ac["wind_spd"]  | -1;
  best.oat         = ac["oat"]       | -999.0f;

  closest = best;
  return true;
}

// ── RENDERING ─────────────────────────────────────────────────────────────────

static void renderNoAircraft() {
  bool wifiDown = WiFi.status() != WL_CONNECTED;

  u8g2->clearBuffer();
  drawTopBar();
  drawChromeBar(FT_Y, 18, FT_BASE, nullptr, nullptr, false);

  u8g2->setFont(FONT_LG);
  drawStrC(W/2, H/2, wifiDown ? "WIFI LOST" : (piOnline ? "SCANNING..." : "PI OFFLINE"));
  u8g2->setFont(FONT_SM);
  char sub[48];
  // Diagnostics shown on-device since there's no way to attach a serial
  // cable while reproducing the "flight briefly appears then drops" bug on
  // battery/wall power — this line is the only signal we get in that case.
  if      (wifiDown) snprintf(sub, sizeof(sub), "status=%d  RSSI=%ddBm", (int)WiFi.status(), WiFi.RSSI());
  else if (piOnline)  snprintf(sub, sizeof(sub), "Awaiting aircraft data");
  else                snprintf(sub, sizeof(sub), "%s  HTTP %d  RSSI %ddBm", PI_IP, lastHttpCode, WiFi.RSSI());
  drawStrC(W/2, H/2 + 20, sub);
  applyAndSend();
}

static void renderAircraftScreen() {
  const AcEntry& a = closest;
  u8g2->clearBuffer();
  u8g2->setDrawColor(1); u8g2->setFontMode(0);

  // ── STATUS BAR (top chrome, inverted) ──────────────────────────────────────
  drawTopBar();

  // ── HEADER ─────────────────────────────────────────────────────────────────

  // Logo bubble: pre-baked flash lookup (logos.h); fallback to ICAO text.
  u8g2->drawRFrame(DS_M, HDR_Y, LOGO_W, HDR_H, DS_R);
  const uint8_t* logo = a.callsign[0] ? logoForCallsign(a.callsign) : nullptr;
  if (logo) {
    int lx = DS_M + (LOGO_W - LOGO_SIZE) / 2;
    int ly = HDR_Y + (HDR_H  - LOGO_SIZE) / 2;
    u8g2->drawXBM(lx, ly, LOGO_SIZE, LOGO_SIZE, logo);
  } else if (a.callsign[0]) {
    char pfx[4] = { a.callsign[0], a.callsign[1], a.callsign[2], '\0' };
    u8g2->setFont(FONT_LG);
    drawStrC(DS_M + LOGO_W/2, HDR_Y + HDR_H/2 + 6, pfx);
  }

  // Callsign bubble (double-border = AMOLED teal-accent equivalent)
  // Placed to the right of the logo, full header height.
  // Top label: ATC phonetic callsign when known (e.g. "SPEEDBIRD"), else
  // literal "CALLSIGN". Sub-text is reserved for MILITARY/PRIVATE flags
  // only — the airline name is redundant with the logo bubble to its left.
  {
    const char* label = a.atc_callsign[0] ? a.atc_callsign : "CALLSIGN";
    const char* sub = a.military ? "MILITARY" : (a.is_private ? "PRIVATE" : nullptr);
    drawIDBubble(ID_X, HDR_Y, CS_W, HDR_H,
                 label,
                 a.callsign[0] ? a.callsign : "------",
                 sub,
                 false);
  }

  // Tail / type bubble — sits to the right of callsign bubble, same height.
  // Full type description now comes pre-resolved from the Pi (readsb's own
  // aircraft database), no client-side lookup table needed.
  {
    const char* desc = a.type_full[0] ? a.type_full : (a.type[0] ? a.type : "");
    drawIDBubble(RG_X, HDR_Y, RG_W, HDR_H,
                 "TAIL",
                 a.reg[0] ? a.reg : "----",
                 desc,
                 false);
  }

  // ── SECTION LABEL (AMOLED style: label text + extending horizontal rule) ───
  u8g2->setFont(FONT_TINY);
  const char* sl = "LIVE TELEMETRY";
  int slW = u8g2->getStrWidth(sl);
  u8g2->drawStr(DS_M, SL_Y + 9, sl);
  u8g2->drawHLine(DS_M + slW + 4, SL_Y + 5, W - DS_M - (DS_M + slW + 4));

  // ── BUBBLE GRID 2×3 (mirrors AMOLED dashboard telemetry grid) ─────────────
  char vb[16];

  // Row 1: ALTITUDE | V-SPEED | GND SPD
  if (a.on_ground) strncpy(vb, "GND", sizeof(vb));
  else             snprintf(vb, sizeof(vb), "%d", a.alt_ft);
  drawBubble(BCX(0), BG_Y, BW, BH, "ALTITUDE", vb, a.on_ground ? "" : "FT");

  if      (a.vrate >  50) snprintf(vb, sizeof(vb), "+%d", a.vrate);
  else if (a.vrate < -50) snprintf(vb, sizeof(vb), "%d",  a.vrate);
  else                    strcpy(vb, "0");
  drawBubble(BCX(1), BG_Y, BW, BH, "V-SPEED", vb, "FPM");

  snprintf(vb, sizeof(vb), "%d", a.spd_kts);
  drawBubble(BCX(2), BG_Y, BW, BH, "GND SPD", vb, "KTS");

  // Row 2: HEADING | DISTANCE | STATUS
  snprintf(vb, sizeof(vb), "%d\xB0", a.track_deg);
  drawBubble(BCX(0), BR2_Y, BW, BH, "HEADING", vb, compass8(a.track_deg));

  snprintf(vb, sizeof(vb), "%.1f", a.dist_km);
  drawBubble(BCX(1), BR2_Y, BW, BH, "DISTANCE", vb, "KM");

  // Emergency status takes precedence over the normal flight-phase read.
  const char* st;
  if      (strcmp(a.squawk, "7500") == 0)                     st = "HIJACK";
  else if (strcmp(a.squawk, "7600") == 0)                     st = "RADIO FAIL";
  else if (strcmp(a.squawk, "7700") == 0)                     st = "EMERGENCY";
  else if (a.emergency[0] && strcmp(a.emergency, "none") != 0) st = "EMERGENCY";
  else st = a.on_ground    ? "ON GND"   :
            a.vrate >  300 ? "CLIMBING" :
            a.vrate < -300 ? "DESCEND"  : "EN ROUTE";
  drawBubble(BCX(2), BR2_Y, BW, BH, "STATUS", st, "");

  // ── ROUTE BANNER (3 rows: centered ROUTE label / codes+line+plane / city+ETA) ─
  // Width trimmed to RT_W (was full-width) to leave room for the compass
  // panel to its right — every "center on screen" position below now
  // centers on the banner's own midpoint (DS_M + RT_W/2) instead of W/2.
  u8g2->drawRFrame(DS_M, RT_Y, RT_W, RT_H, DS_R);

  int rtMidX = DS_M + RT_W / 2;
  u8g2->setFont(FONT_TINY);
  drawStrC(rtMidX, RT_Y + 8, "ROUTE");

  if (a.origin[0] && a.destination[0]) {
    // Row 2: airport IATA codes (origin left, destination right) + connecting
    // line with a plane icon centered on it.
    u8g2->setFont(FONT_MD);
    int ox    = DS_M + 8;
    int origW = u8g2->getStrWidth(a.origin);
    int destW = u8g2->getStrWidth(a.destination);
    int dx    = DS_M + RT_W - 8 - destW;
    u8g2->drawStr(ox, RT_Y + 25, a.origin);
    u8g2->drawStr(dx, RT_Y + 25, a.destination);
    int lx1 = ox + origW + 4, lx2 = dx - 4;
    if (lx2 > lx1) u8g2->drawHLine(lx1, RT_Y + 18, lx2 - lx1);
    // Plane position = fraction of the route already flown (elapsed / total
    // duration), so it sits a quarter of the way along the line at 25% done
    // etc. Falls back to the line's midpoint when duration isn't known.
    float progress = 0.5f;
    if (a.eta_min >= 0 && a.route_dur_min > 0) {
      progress = 1.0f - (a.eta_min / a.route_dur_min);
      if (progress < 0.0f) progress = 0.0f;
      if (progress > 1.0f) progress = 1.0f;
    }
    int px = lx1 + (int)(progress * (lx2 - lx1)) - PLANE_XBM_W / 2;
    int py = RT_Y + 18 - PLANE_XBM_H / 2;
    u8g2->drawXBM(px, py, PLANE_XBM_W, PLANE_XBM_H, PLANE_XBM);

    // Row 3: origin city (left) + "H:MM" duration (center, when known) +
    // destination city (right) — all shown together.
    u8g2->setFont(FONT_TINY);
    bool haveEta = a.eta_min >= 0;
    int cityGap = haveEta ? 20 : 0;
    if (haveEta) {
      char eb[8]; fmtHM(eb, sizeof(eb), a.eta_min);
      drawStrC(rtMidX, RT_Y + 33, eb);
    }
    if (a.origin_name[0]) {
      char onb[22], dnb[22];
      fitStr(onb, sizeof(onb), a.origin_name, (rtMidX - cityGap) - ox - 4);
      fitStr(dnb, sizeof(dnb), a.dest_name,   dx - (rtMidX + cityGap) - 4);
      u8g2->drawStr(ox, RT_Y + 33, onb);
      drawStrR(dx + destW, RT_Y + 33, dnb);
    }
  } else {
    u8g2->setFont(FONT_SM);
    drawStrC(rtMidX, RT_Y + 21, "ROUTE UNAVAILABLE");
  }

  // ── COMPASS PANEL (square, right of route banner) ───────────────────────────
  drawCompassPanel(CMP_X, RT_Y, CMP_SIZE, a.bearing_deg);

  // ── TELEMETRY STRIP ────────────────────────────────────────────────────────
  // 8 cells separated by vertical rules, framed by horizontal lines at top/bottom.
  u8g2->drawHLine(0, TL_Y,        W);
  u8g2->drawHLine(0, TL_Y + TL_H, W);

  char tSrc[8], tSig[8], tSqk[8], tMach[8], tIas[8], tOat[8], tHdg[8], tMsgs[10];
  strncpy(tSrc, srcLabel(a.src), 7);                                   tSrc[7]  = '\0';
  snprintf(tSig,  sizeof(tSig),  "%.1f",   a.rssi < -90.0f ? -99.0f : a.rssi);
  strncpy(tSqk,  a.squawk[0] ? a.squawk : "----", 7);                  tSqk[7]  = '\0';
  if (a.mach > 0.01f) snprintf(tMach, sizeof(tMach), "%.3f", a.mach);
  else                strncpy(tMach, "---", sizeof(tMach));
  if (a.ias >= 0)   snprintf(tIas, sizeof(tIas), "%dKT", a.ias);
  else              strncpy(tIas, "---", sizeof(tIas));
  if (a.oat > -900) snprintf(tOat, sizeof(tOat), "%.0f\xB0", a.oat);
  else              strncpy(tOat, "---", sizeof(tOat));
  if (a.nav_heading >= 0) snprintf(tHdg, sizeof(tHdg), "%d\xB0", a.nav_heading);
  else                    strncpy(tHdg, "---", sizeof(tHdg));
  snprintf(tMsgs, sizeof(tMsgs), "%ld", a.messages);

  const char* tlLabel[TL_N] = { "SRC","SIG","SQK","MACH","IAS","OAT","HDG","MSGS" };
  const char* tlVal[TL_N]   = { tSrc, tSig, tSqk, tMach, tIas, tOat, tHdg, tMsgs };

  for (int i = 0; i < TL_N; i++) {
    int cx = i * TL_CW + TL_CW / 2;
    u8g2->setFont(FONT_TINY);
    drawStrC(cx, TL_Y + 7,  tlLabel[i]);
    char vt[10]; fitStr(vt, sizeof(vt), tlVal[i], TL_CW - 4);
    drawStrC(cx, TL_Y + 15, vt);
    if (i > 0) u8g2->drawVLine(i * TL_CW, TL_Y, TL_H + 1);
  }

  // ── FOOTER BAR (bottom chrome, per-callsign cells) ──────────────────────────
  drawFooterStrip();

  applyAndSend();
}

// ── WIFI ──────────────────────────────────────────────────────────────────────

// Maps the Pi-configurable dBm setting (RLCDsettings.html -> wifi_tx_power_dbm)
// onto the nearest WIFI_POWER_* step the ESP32 Arduino core actually accepts.
// Lower power trades range for a lower current-draw TX peak — see the
// brownout-mitigation note below.
static wifi_power_t dbmToWifiPower(float dbm) {
  if (dbm >= 19.5f) return WIFI_POWER_19_5dBm;
  if (dbm >= 19.0f) return WIFI_POWER_19dBm;
  if (dbm >= 18.5f) return WIFI_POWER_18_5dBm;
  if (dbm >= 17.0f) return WIFI_POWER_17dBm;
  if (dbm >= 15.0f) return WIFI_POWER_15dBm;
  if (dbm >= 13.0f) return WIFI_POWER_13dBm;
  if (dbm >= 11.0f) return WIFI_POWER_11dBm;
  if (dbm >=  8.5f) return WIFI_POWER_8_5dBm;
  if (dbm >=  7.0f) return WIFI_POWER_7dBm;
  if (dbm >=  5.0f) return WIFI_POWER_5dBm;
  if (dbm >=  2.0f) return WIFI_POWER_2dBm;
  return WIFI_POWER_MINUS_1dBm;
}

static bool connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(true);
  delay(100);
  // Default (8.5dBm) reduces TX power to lower peak current draw and
  // prevent brownout resets on marginal power supplies; the board is close
  // to the router so signal strength is not a concern. Configurable from
  // the Pi (RLCDsettings.html) since wifiTxPowerDbm starts at that same
  // 8.5dBm default and is only overridden once a fetch succeeds.
  WiFi.setTxPower(dbmToWifiPower(wifiTxPowerDbm));
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long t = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - t > 20000) return false;
    delay(500);
  }
  return true;
}

// ── SETUP ─────────────────────────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  delay(500);   // let 3.3V rail stabilise before display init

  pinMode(0, INPUT_PULLUP);   // BOOT button — active LOW

  lcd.begin(0, U8G2_R1);
  u8g2 = lcd.getU8g2();
  // Show a full splash so there's no garbage outside the status bar
  auto splash = [](const char* status, const char* sub = nullptr) {
    u8g2->clearBuffer();
    drawChromeBar(0, SB_H, SB_BASE, "FLIGHTBOARD", status, false);
    // Aircraft graphic above the title text
    {
      int ix = (W - A3_XBM_SM_W) / 2;
      int iy = H/2 - A3_XBM_SM_H - 18;
      u8g2->drawXBM(ix, iy, A3_XBM_SM_W, A3_XBM_SM_H, A3_XBM_SM);
    }
    u8g2->setFont(FONT_LG);
    drawStrC(W/2, H/2 + 4, "FLIGHTBOARD");
    if (sub) {
      u8g2->setFont(FONT_SM);
      drawStrC(W/2, H/2 + 22, sub);
    }
    applyAndSend();
  };

  splash("CONNECTING...", WIFI_SSID);

  if (!connectWifi()) {
    splash("WIFI FAIL", WIFI_SSID);
    while (true) delay(5000);
  }

  splash("WIFI OK", "Loading aircraft data...");
  configTime(TZ_OFFSET_SEC, 0, "pool.ntp.org", "time.google.com");

  fetchAircraft();

  if (acCount == 0) renderNoAircraft();
  else              renderAircraftScreen();

  buildKey(closest, lastKey, sizeof(lastKey));
  lastFetchMs = millis();
  Serial.printf("[setup] done, heap=%u\n", ESP.getFreeHeap());
}

// ── LOOP ──────────────────────────────────────────────────────────────────────

void loop() {
  unsigned long now = millis();

  // Boot button (GPIO 0, active LOW) — debounced toggle of color inversion
  bool btnState = digitalRead(0);
  if (btnState == LOW && lastBtnState == HIGH && now - lastBtnMs > 250) {
    invertColors = !invertColors;
    lastBtnMs    = now;
    if (acCount > 0) renderAircraftScreen();
    else             renderNoAircraft();
  }
  lastBtnState = btnState;

  if (now - lastFetchMs < 10000) return;
  lastFetchMs = now;

  // WiFi has no built-in recovery in this sketch — if the radio dropped
  // (e.g. a brownout blip from a marginal power supply during a TX burst),
  // every subsequent fetch would otherwise fail forever with no retry.
  if (WiFi.status() != WL_CONNECTED) {
    Serial.printf("[loop] WiFi down (status=%d), reconnecting...\n", (int)WiFi.status());
    piOnline = false;
    renderNoAircraft();
    connectWifi();   // blocks up to 20s; harmless since we're already offline
    return;
  }

  Serial.printf("[loop] fetch, heap=%u\n", ESP.getFreeHeap());

  if (!fetchAircraft()) {
    piOnline = false;
    renderNoAircraft();
    return;
  }

  char newKey[56];
  buildKey(closest, newKey, sizeof(newKey));
  if (strcmp(newKey, lastKey) != 0) {
    renderAircraftScreen();
    strncpy(lastKey, newKey, sizeof(lastKey) - 1);
  }
}
