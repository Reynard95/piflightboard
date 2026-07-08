/*
  FlightBoard_RLCD — Waveshare ESP32-S3-RLCD-4.2
  ──────────────────────────────────────────────────────────────────────────────
  Design language matches the ESP32-S3 AMOLED Flight Board:
  bubble cards with rounded-rect borders, inverted chrome bars (top/bottom),
  "LIVE TELEMETRY" section label with extending rule, route banner.

  Layout (landscape 400×300): 

  ┌─────────────────────────────────────────────────────────────────────────┐
  │ FLIGHTBOARD              5 AC                                   12:34   │  ← status bar (inverted)
  ├─────────┬─────────────────────────────────────┬───────────────────────┤
  │         │╔═══════════════════════════════════╗ │┌─────────────────────┐│
  │  KLM    │║  CALLSIGN                         ║ ││  TAIL               ││
  │  logo   │║        KLM1234                    ║ ││      PH-BXA         ││  ← header (88 px tall)
  │  bubble │║  KLM ROYAL DUTCH AIRLINES         ║ ││  BOEING 737-800     ││
  │  (88px) │╚═══════════════════════════════════╝ │└─────────────────────┘│
  ├─────────┴─────────────────────────────────────┴───────────────────────┤
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
  │ ┌─────────────────────────────────────────────────────────────────────┐  │
  │ │                                ROUTE                                │  │
  │ │ AMS ───────────────✈︎────────────────────────────────────────── LHR │  │  ← route banner
  │ │ Amsterdam Schiphol              1:30                London Heathrow │  │
  │ └─────────────────────────────────────────────────────────────────────┘  │
  ├──────┬──────┬──────┬──────┬──────┬──────┬──────┬───────────────────────┤
  │ SRC  │ SIG  │ SQK  │ MACH │ IAS  │ OAT  │ HDG  │ MSGS                 │  ← telem strip
  │ADS-B │ -18  │ 2245 │.783  │280KT │ -42  │ 182° │ 12345                │
  ├──────┴──────┴──────┴──────┴──────┴──────┴──────┴───────────────────────┤
  │ 5 AC  KLM1234 · BAW456 · AFR789                                12:34   │  ← footer (inverted)
  └─────────────────────────────────────────────────────────────────────────┘

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
#include <PNGdec.h>
#include "ST7305_U8g2.h"
#include "A3_xbm.h"
#include "plane_xbm.h"
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

// Route banner
#define RT_Y    (BR2_Y + BH + DS_G)             // 217
#define RT_H    36

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
static char      lastLogoCs[10] = "";
static bool      piOnline     = false;
static unsigned long lastFetchMs = 0;

// Boot button (GPIO 0) toggles display inversion
static bool      invertColors = false;
static bool      lastBtnState = true;   // HIGH = not pressed
static unsigned long lastBtnMs = 0;

// Airline logo fetched from Pi as PNG, decoded to 80×80 1-bit XBM in RAM.
// 80 divides evenly by 8 so no row-padding needed.
#define LOGO_XBM_W   80
#define LOGO_XBM_H   80
#define LOGO_XBM_BPR (LOGO_XBM_W / 8)   // 10 bytes per row
static uint8_t  logoBuf[LOGO_XBM_H * LOGO_XBM_BPR];  // 800 bytes
static bool     logoLoaded = false;
static PNG      s_png;
static int      s_srcW, s_srcH;

static int pngRow(PNGDRAW* pDraw) {
  uint16_t line[100];
  // 0x00FFFFFF (white, format 00BBGGRR) instead of the disable-alpha
  // sentinel 0xffffffff — composites transparent source pixels toward white
  // so they luma-threshold as "not ink" and blend into the bubble's own
  // light fill, instead of returning raw un-composited (often black) RGB.
  ((PNG*)pDraw->pUser)->getLineAsRGB565(pDraw, line, PNG_RGB565_LITTLE_ENDIAN, 0x00FFFFFF);
  int dstY = (int)pDraw->y * LOGO_XBM_H / s_srcH;
  if (dstY < 0 || dstY >= LOGO_XBM_H) return 1;
  uint8_t* row = logoBuf + dstY * LOGO_XBM_BPR;
  memset(row, 0, LOGO_XBM_BPR);
  for (int dstX = 0; dstX < LOGO_XBM_W; dstX++) {
    int srcX = dstX * pDraw->iWidth / LOGO_XBM_W;
    uint16_t px = line[srcX];
    uint8_t r = (px >> 11) & 0x1F;
    uint8_t g = (px >>  5) & 0x3F;
    uint8_t b =  px        & 0x1F;
    // Weighted luma; threshold at 50% (32768 in scaled units)
    uint16_t luma = (uint16_t)(r << 3) * 77 + (uint16_t)(g << 2) * 150 + (uint16_t)(b << 3) * 29;
    if (luma < 32768u) row[dstX / 8] |= (1 << (dstX % 8));
  }
  return 1;
}

// Reused across calls — avoids malloc/free churn (was up to 32KB per aircraft
// change) that fragments the small internal heap on a PSRAM-disabled ESP32-S3.
#define PNG_DL_BUF_SIZE 32768
static uint8_t pngDlBuf[PNG_DL_BUF_SIZE];

static void fetchLogo(const char* icao3) {
  logoLoaded = false;
  memset(logoBuf, 0, sizeof(logoBuf));
  char url[80];
  snprintf(url, sizeof(url), "http://%s/airline_logos/airline_logo_%s.png", PI_IP, icao3);
  WiFiClient client;
  HTTPClient http;
  http.begin(client, url);
  http.setTimeout(5000);
  int code = http.GET();
  if (code != 200) {
    Serial.printf("[fetchLogo] GET %s failed: %d\n", icao3, code);
    http.end();
    return;
  }
  int len = http.getSize();
  if (len <= 0 || len > PNG_DL_BUF_SIZE) { http.end(); return; }
  int got = http.getStream().readBytes(pngDlBuf, len);
  http.end();
  if (got == len && s_png.openRAM(pngDlBuf, len, pngRow) == PNG_SUCCESS) {
    s_srcW = s_png.getWidth();
    s_srcH = s_png.getHeight();
    s_png.decode(&s_png, 0);
    s_png.close();
    logoLoaded = true;
  }
}

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
  u8g2->setDrawColor(0); u8g2->drawRBox(x, y, w, h, DS_R); u8g2->setDrawColor(1);
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
  u8g2->setDrawColor(0); u8g2->drawRBox(x, y, w, h, DS_R); u8g2->setDrawColor(1);
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
  u8g2->clearBuffer();
  u8g2->setDrawColor(1); u8g2->drawBox(0, 0, W, H);

  char cnt[16];
  if (piOnline) snprintf(cnt, sizeof(cnt), "%d AC", acCount);
  else          strncpy(cnt, "OFFLINE", sizeof(cnt));
  drawChromeBar(0, SB_H, SB_BASE, "FLIGHTBOARD", cnt);
  drawChromeBar(FT_Y, 18, FT_BASE, nullptr, nullptr, false);

  u8g2->setDrawColor(0);
  u8g2->setFont(FONT_LG);
  drawStrC(W/2, H/2, piOnline ? "SCANNING..." : "PI OFFLINE");
  u8g2->setFont(FONT_SM);
  char sub[48];
  if (piOnline) snprintf(sub, sizeof(sub), "Awaiting aircraft data");
  else          snprintf(sub, sizeof(sub), "Cannot reach %s", PI_IP);
  drawStrC(W/2, H/2 + 20, sub);
  u8g2->setDrawColor(1);
  applyAndSend();
}

static void renderAircraftScreen() {
  const AcEntry& a = closest;
  u8g2->clearBuffer();
  u8g2->setDrawColor(1); u8g2->setFontMode(0);
  u8g2->drawBox(0, 0, W, H);   // dark page — bubbles below punch light cards into it

  // ── STATUS BAR (top chrome, inverted) ──────────────────────────────────────
  char cnt[12]; snprintf(cnt, sizeof(cnt), "%d AC", acCount);
  drawChromeBar(0, SB_H, SB_BASE, "FLIGHTBOARD", cnt);

  // ── HEADER ─────────────────────────────────────────────────────────────────

  // Logo bubble: PNG fetched from Pi, decoded to 1-bit; fallback to ICAO text.
  u8g2->setDrawColor(0); u8g2->drawRBox(DS_M, HDR_Y, LOGO_W, HDR_H, DS_R); u8g2->setDrawColor(1);
  u8g2->drawRFrame(DS_M, HDR_Y, LOGO_W, HDR_H, DS_R);
  if (logoLoaded) {
    int lx = DS_M + (LOGO_W - LOGO_XBM_W) / 2;
    int ly = HDR_Y + (HDR_H  - LOGO_XBM_H) / 2;
    u8g2->drawXBM(lx, ly, LOGO_XBM_W, LOGO_XBM_H, logoBuf);
  } else if (a.callsign[0]) {
    char pfx[4] = { a.callsign[0], a.callsign[1], a.callsign[2], '\0' };
    u8g2->setFont(FONT_LG);
    drawStrC(DS_M + LOGO_W/2, HDR_Y + HDR_H/2 + 6, pfx);
  }

  // Callsign bubble (double-border = AMOLED teal-accent equivalent)
  // Placed to the right of the logo, full header height.
  // Top label: ATC phonetic callsign when known (e.g. "SPEEDBIRD"), else
  // literal "CALLSIGN". Sub-text: MILITARY/PRIVATE flag takes precedence
  // over the airline name.
  {
    const char* label = a.atc_callsign[0] ? a.atc_callsign : "CALLSIGN";
    const char* sub;
    char airline_upper[52] = "";
    if (a.military) {
      sub = "MILITARY";
    } else if (a.is_private) {
      sub = "PRIVATE";
    } else {
      if (a.airline[0]) {
        strncpy(airline_upper, a.airline, 51);
        for (size_t i = 0; i < strlen(airline_upper); i++)
          if (airline_upper[i] >= 'a' && airline_upper[i] <= 'z')
            airline_upper[i] -= 32;
      }
      sub = airline_upper[0] ? airline_upper : "---";
    }
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
  // Drawn directly on the dark page (not inside a bubble) — light ink.
  u8g2->setDrawColor(0);
  u8g2->setFont(FONT_TINY);
  const char* sl = "LIVE TELEMETRY";
  int slW = u8g2->getStrWidth(sl);
  u8g2->drawStr(DS_M, SL_Y + 9, sl);
  u8g2->drawHLine(DS_M + slW + 4, SL_Y + 5, W - DS_M - (DS_M + slW + 4));
  u8g2->setDrawColor(1);

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
  u8g2->setDrawColor(0); u8g2->drawRBox(DS_M, RT_Y, W - 2*DS_M, RT_H, DS_R); u8g2->setDrawColor(1);
  u8g2->drawRFrame(DS_M, RT_Y, W - 2*DS_M, RT_H, DS_R);

  u8g2->setFont(FONT_TINY);
  drawStrC(W/2, RT_Y + 8, "ROUTE");

  if (a.origin[0] && a.destination[0]) {
    // Row 2: airport IATA codes (origin left, destination right) + connecting
    // line with a plane icon centered on it.
    u8g2->setFont(FONT_MD);
    int ox    = DS_M + 8;
    int origW = u8g2->getStrWidth(a.origin);
    int destW = u8g2->getStrWidth(a.destination);
    int dx    = W - DS_M - 8 - destW;
    u8g2->drawStr(ox, RT_Y + 25, a.origin);
    u8g2->drawStr(dx, RT_Y + 25, a.destination);
    int lx1 = ox + origW + 4, lx2 = dx - 4;
    if (lx2 > lx1) u8g2->drawHLine(lx1, RT_Y + 18, lx2 - lx1);
    int px = (lx1 + lx2) / 2 - PLANE_XBM_W / 2;
    int py = RT_Y + 18 - PLANE_XBM_H / 2;
    u8g2->drawXBM(px, py, PLANE_XBM_W, PLANE_XBM_H, PLANE_XBM);

    // Row 3: origin city (left) + "H:MM" duration (center, when known) +
    // destination city (right) — all shown together.
    u8g2->setFont(FONT_TINY);
    bool haveEta = a.eta_min >= 0;
    int cityGap = haveEta ? 20 : 0;
    if (haveEta) {
      char eb[8]; fmtHM(eb, sizeof(eb), a.eta_min);
      drawStrC(W/2, RT_Y + 33, eb);
    }
    if (a.origin_name[0]) {
      char onb[22], dnb[22];
      fitStr(onb, sizeof(onb), a.origin_name, (W/2 - cityGap) - ox - 4);
      fitStr(dnb, sizeof(dnb), a.dest_name,   dx - (W/2 + cityGap) - 4);
      u8g2->drawStr(ox, RT_Y + 33, onb);
      drawStrR(dx + destW, RT_Y + 33, dnb);
    }
  } else {
    u8g2->setFont(FONT_SM);
    drawStrC(W/2, RT_Y + 21, "ROUTE UNAVAILABLE");
  }

  // ── TELEMETRY STRIP ────────────────────────────────────────────────────────
  // 8 cells separated by vertical rules, framed by horizontal lines at top/bottom.
  // Drawn directly on the dark page (not inside a bubble) — light ink.
  u8g2->setDrawColor(0);
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
  u8g2->setDrawColor(1);

  // ── FOOTER BAR (bottom chrome, inverted — mirrors AMOLED tab bar) ──────────
  {
    char fc[8]; snprintf(fc, sizeof(fc), "%d AC", acCount);
    char list[100] = "";
    for (int i = 0; i < acListCount && i < 20; i++) {
      if (i > 0) strncat(list, "\xB7", sizeof(list) - strlen(list) - 1);
      strncat(list, acList[i], sizeof(list) - strlen(list) - 1);
    }
    char footer[120];
    snprintf(footer, sizeof(footer), "%s  %s", fc, list);
    // Truncate so it doesn't overlap the clock (clock is ~30px)
    u8g2->setFont(FONT_TINY);
    fitStr(footer, sizeof(footer), footer, W - 36);
    drawChromeBar(FT_Y, 18, FT_BASE, footer, nullptr);
  }

  applyAndSend();
}

// ── WIFI ──────────────────────────────────────────────────────────────────────

static bool connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(true);
  delay(100);
  // Reduce TX power to lower peak current draw and prevent brownout resets.
  // The board is close to the router so signal strength is not a concern.
  WiFi.setTxPower(WIFI_POWER_8_5dBm);
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
    u8g2->setDrawColor(1); u8g2->drawBox(0, 0, W, H);
    drawChromeBar(0, SB_H, SB_BASE, "FLIGHTBOARD", status, false);
    // Aircraft graphic + title text drawn directly on the dark page — light ink.
    u8g2->setDrawColor(0);
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
    u8g2->setDrawColor(1);
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
  if (acCount > 0 && closest.callsign[0]) {
    char icao3[4] = { closest.callsign[0], closest.callsign[1], closest.callsign[2], '\0' };
    fetchLogo(icao3);
    strncpy(lastLogoCs, closest.callsign, 9);
  }

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

  Serial.printf("[loop] fetch, heap=%u\n", ESP.getFreeHeap());

  if (!fetchAircraft()) {
    piOnline = false;
    renderNoAircraft();
    return;
  }

  if (closest.callsign[0] && strcmp(closest.callsign, lastLogoCs) != 0) {
    char icao3[4] = { closest.callsign[0], closest.callsign[1], closest.callsign[2], '\0' };
    fetchLogo(icao3);
    strncpy(lastLogoCs, closest.callsign, 9);
  }

  char newKey[56];
  buildKey(closest, newKey, sizeof(newKey));
  if (strcmp(newKey, lastKey) != 0) {
    renderAircraftScreen();
    strncpy(lastKey, newKey, sizeof(lastKey) - 1);
  }
}
