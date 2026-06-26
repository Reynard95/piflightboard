/*
  ESP32-S3 AMOLED Flight Board — Airbus ECAM v2.0
  Waveshare ESP32-S3-Touch-AMOLED-1.8 (CO5300, 368×448)

  BOOT button (GPIO 0):
    short press        = next screen
    long press (1 s)   = cycle selected aircraft
    double press       = home (Dashboard)

  9 screens: Dashboard | Radar | List | Detail |
             Pi Telemetry | ESP32 | ADS-B Health | Stats | Clock

  Libraries: GFX Library for Arduino, ArduinoJson
  Board: ESP32S3 Dev Module, USB CDC on Boot: Enabled,
         PSRAM: QSPI PSRAM, Partition: 16M Flash (3MB APP/9.9MB FATFS)
*/

#include <Wire.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <Arduino_GFX_Library.h>
#include <time.h>
#include <math.h>

// ── CONFIGURATION ─────────────────────────────────────────────────────────────
// Copy secrets.h.example → secrets.h and fill in your values. Never commit secrets.h.
#include "secrets.h"

// ── DISPLAY PINS ──────────────────────────────────────────────────────────────
#define LCD_CS   12
#define LCD_SCK  11
#define LCD_D0    4
#define LCD_D1    5
#define LCD_D2    6
#define LCD_D3    7
#define I2C_SDA  15
#define I2C_SCL  14
#define TCA9554_ADDR  0x20

#define W    368
#define H    448
#define MX    8     // horizontal margin (design system: 8 px all sides)
#define MY    22    // top chrome / header height
#define SB_H  20    // status bar height
#define SB_Y  (H - SB_H)   // 430
#define SAFE_W    (W - MX * 2)
#define CONTENT_H (SB_Y - MY)
#define CORNER_R  80   // display physical corner radius — tune to match hardware
#define BAR_INSET 48   // safe content margin inside header/status bars (keeps text clear of masked corners)

// ── DESIGN SYSTEM v1.0 — Aviation Modern Theme ───────────────────────────────
#define C_BG         0x0000   // #000000 — AMOLED black
#define C_PANEL      0x10A2   // #151515 — card / panel fill
#define C_BORDER     0x39E7   // #3C3C3C — border / divider
#define C_FG         0xFFFF   // #FFFFFF — primary text
#define C_TEXT_SEC   0xAD75   // #AFAFAF — secondary text / labels
#define C_BLUE       0x4D1F   // #4BA3FF — Airbus blue accent / left borders
#define C_BLUE_INFO  0x2E3F   // #2AC6FF — info blue / route highlights
#define C_GREEN      0x4ECC   // #4CD964 — normal / OK
#define C_AMBER      0xFE08   // #FFC247 — caution
#define C_RED        0xFA69   // #FF4D4D — critical
// Aliases kept for backward compatibility with non-dashboard screens
#define C_GRAY       C_TEXT_SEC
#define C_DIM        C_BORDER
#define C_SEP        C_PANEL
#define C_CYAN       C_BLUE_INFO

// ── PINS ──────────────────────────────────────────────────────────────────────
#define BOOT_PIN    0
#define TOUCH_INT   21
#define FT3168_ADDR 0x38

// ── VIEWS ─────────────────────────────────────────────────────────────────────
enum View {
  V_DASHBOARD = 0,
  V_RADAR,
  V_LIST,
  V_DETAIL,
  V_PI,
  V_ESP,
  V_ADSB,
  V_STATS,
  V_CLOCK,
  V_SETTINGS,
  V_COUNT
};
View currentView = V_DASHBOARD;

const char* VIEW_ABBR[] = {
  "DASH","RADAR","LIST","DETL","PI","ESP32","ADS-B","STATS","CLOCK","SET"
};
const char* VIEW_TITLE[] = {
  "DASHBOARD","RADAR","AIRCRAFT","DETAILS",
  "RASPBERRY PI","ESP32-S3","ADS-B HEALTH","STATISTICS","CLOCK","SETTINGS"
};

// ── AIRCRAFT DATA ─────────────────────────────────────────────────────────────
#define MAX_AC 60
struct AcEntry {
  char  callsign[10];
  char  reg[10];
  char  type[8];
  char  icao[8];
  char  squawk[6];
  float dist_nm;
  float lat, lon;
  int   alt_ft;
  int   spd_kts;
  int   track_deg;
  int   vrate;
};
AcEntry acList[MAX_AC];
static AcEntry fetchBuf[MAX_AC];
int     acCount       = 0;
int     selectedAcIdx = 0;   // set by list-view touch; used in detail view only
unsigned long lastAcFetchMs = 0;
unsigned long lastTouchMs   = 0;

// ── ROUTE CACHE ───────────────────────────────────────────────────────────────
char routeForCs[10]      = "";
char routeOrigin[5]      = "";
char routeDest[5]        = "";
char routeOriginCity[28] = "";
char routeDestCity[28]   = "";
char routeAirline[52]    = "";
bool routeValid          = false;

// ── WEATHER ───────────────────────────────────────────────────────────────────
float  wxTemp    = 0;
float  wxWind    = 0;
int    wxWindDir = 0;
int    wxCode    = -1;
bool   wxFresh   = false;
unsigned long lastWxMs = 0;

// ── PI VITALS ─────────────────────────────────────────────────────────────────
float  piCpuPct      = 0;
float  piCpuTemp     = 0;
float  piMemPct      = 0;
int    piMemUsedMb   = 0;
int    piMemTotalMb  = 0;
float  piDiskPct     = 0;
float  piDiskUsedGb  = 0;
float  piDiskTotalGb = 0;
long   piNetRxBps    = 0;
long   piNetTxBps    = 0;
char   piUptime[24]  = "--";
char   piHostname[32]= "pi";
int    piAdsbMsgS    = 0;
int    piAdsbRange   = 0;
float  piAdsbGoodCrc = 0;
float  piAdsbBadCrc  = 0;
bool   piOnline      = false;
unsigned long lastVitalsMs = 0;

// ── STATISTICS (session) ──────────────────────────────────────────────────────
int   statsHighestFl   = 0;
int   statsFastestKph  = 0;
float statsLongestKm   = 0;
int   statsSeenCount   = 0;
char  statsSeenCs[150][10];
int   statsAirlineCount= 0;
char  statsAirlinePfx[50][4];

// ── SETTINGS ──────────────────────────────────────────────────────────────────
// Units mode: 0=METRIC (km, km/h, °C), 1=AVIATION (NM, KT, FL feet)
int settingUnits      = 0;
// Brightness: 0=25%, 1=50%, 2=75%, 3=100%
int settingBrightness = 3;
// Theme: 0=ECAM (only option for now)
int settingTheme      = 0;
// Which setting row is selected/highlighted on the settings screen
int settingSelected   = 0;
const int SETTINGS_COUNT = 3;

// ── DISPLAY OBJECTS ───────────────────────────────────────────────────────────
Arduino_DataBus *bus      = nullptr;
Arduino_CO5300  *display  = nullptr;
Arduino_GFX     *gfx      = nullptr;   // Arduino_Canvas when PSRAM available, else display directly
bool             hasCanvas = false;
static uint8_t   expanderState = 0x00;

// ── BUTTON STATE ──────────────────────────────────────────────────────────────
bool          btnWasLow   = false;
unsigned long btnDownAt   = 0;
bool          longFired   = false;
unsigned long lastShortMs = 0;
int           shortCount  = 0;
bool          pendingShort= false;
unsigned long shortAt     = 0;

// ── LOOP / FPS TIMING ────────────────────────────────────────────────────────
unsigned long loopMs       = 0;
unsigned long loopStart    = 0;
uint32_t      fpsDisplay   = 0;
uint32_t      fpsCount     = 0;
unsigned long fpsWinStart  = 0;
unsigned long lastFetchMs  = 0;
unsigned long lastRenderMs = 0;

// ═════════════════════════════════════════════════════════════════ EXPANDER ════

void expanderWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(TCA9554_ADDR);
  Wire.write(reg); Wire.write(val);
  Wire.endTransmission();
}

void expanderSetBit(uint8_t bit, bool high) {
  if (high) expanderState |=  (1 << bit);
  else      expanderState &= ~(1 << bit);
  expanderWrite(0x01, expanderState);
}

void expanderInit() {
  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.setClock(400000);
  expanderWrite(0x03, 0x00);  // all outputs
  expanderWrite(0x01, 0x00);  // all low
  delay(20);
  expanderSetBit(1, true);    // DSI_PWR_EN
  delay(20);
  expanderSetBit(0, false);   // RST low
  delay(20);
  expanderSetBit(0, true);    // RST high
  delay(20);
  bus     = new Arduino_ESP32QSPI(LCD_CS, LCD_SCK, LCD_D0, LCD_D1, LCD_D2, LCD_D3);
  display = new Arduino_CO5300(bus, GFX_NOT_DEFINED, 0, W, H);
  display->begin(80000000);   // init CO5300 hardware once

  // Arduino_Canvas::begin() calls _output->begin() unconditionally unless the speed
  // argument is GFX_SKIP_OUTPUT_BEGIN (-2). Pass that to avoid a second
  // spi_bus_initialize() call on the already-live SPI bus → ESP_ERR_INVALID_STATE → abort().
  Arduino_Canvas *canvas = new Arduino_Canvas(W, H, display);
  if (canvas->begin(GFX_SKIP_OUTPUT_BEGIN)) {
    gfx       = canvas;
    hasCanvas = true;
  } else {
    delete canvas;
    gfx       = display;   // fallback: direct drawing, flicker but functional
    hasCanvas = false;
    Serial.println("WARN: PSRAM canvas failed — check Tools > PSRAM > QSPI PSRAM");
  }
}

// ════════════════════════════════════════════════════════════════════════ TOUCH ══

bool readTouch(int16_t &tx, int16_t &ty) {
  Wire.beginTransmission(FT3168_ADDR);
  Wire.write(0x02);                        // TD_STATUS register
  if (Wire.endTransmission(false) != 0) return false;
  Wire.requestFrom(FT3168_ADDR, 5);
  if (Wire.available() < 5) return false;
  uint8_t num = Wire.read();
  if (num == 0 || num > 5) return false;
  uint8_t xh = Wire.read(), xl = Wire.read();
  uint8_t yh = Wire.read(), yl = Wire.read();
  if (((xh >> 6) & 0x03) == 1) return false;  // lift-up only — skip
  tx = ((int16_t)(xh & 0x0F) << 8) | xl;
  ty = ((int16_t)(yh & 0x0F) << 8) | yl;
  return (tx >= 0 && tx < W && ty >= 0 && ty < H);
}

// ═════════════════════════════════════════════════════════════════ UTILITIES ═══

float degToRad(float d) { return d * PI / 180.0f; }

float haversineNM(float lat1, float lon1, float lat2, float lon2) {
  float dLat = degToRad(lat2 - lat1), dLon = degToRad(lon2 - lon1);
  float a = sinf(dLat/2)*sinf(dLat/2)
           + cosf(degToRad(lat1))*cosf(degToRad(lat2))*sinf(dLon/2)*sinf(dLon/2);
  return 3440.65f * 2.0f * atan2f(sqrtf(a), sqrtf(1.0f - a));
}

const char* compass8(int deg) {
  const char* d[] = {"N","NE","E","SE","S","SW","W","NW"};
  return d[((deg + 22) % 360) / 45];
}

const char* wxDesc(int code) {
  if (code < 0)   return "---";
  if (code == 0)  return "CLEAR";
  if (code <= 3)  return "CLOUDY";
  if (code <= 48) return "FOG";
  if (code <= 55) return "DRIZZLE";
  if (code <= 65) return "RAIN";
  if (code <= 75) return "SNOW";
  if (code == 95) return "STORM";
  if (code >= 96) return "HAIL";
  return "UNKNOWN";
}

// Unit-aware helpers — format into buf[len]
void fmtDist(char* buf, int len, float nm) {
  if (settingUnits == 1) snprintf(buf, len, "%.1f NM", nm);
  else                   snprintf(buf, len, "%.1f KM", nm * 1.852f);
}
void fmtSpd(char* buf, int len, int kts) {
  if (settingUnits == 1) snprintf(buf, len, "%d KT", kts);
  else                   snprintf(buf, len, "%d KM/H", (int)(kts * 1.852f));
}
void fmtAlt(char* buf, int len, int ft) {
  if (settingUnits == 1) snprintf(buf, len, "FL%d", ft / 100);
  else                   snprintf(buf, len, "%d", (int)(ft * 0.3048f));
}

void applyBrightness() {
  // CO5300 brightness control (MIPI DCS 0x51 WRDISBV) is not exposed by
  // the current GFX library version — setting is stored for future use.
}

uint16_t barColor(float pct, float cautionAt = 70.0f, float warningAt = 85.0f) {
  if (pct >= warningAt) return C_RED;
  if (pct >= cautionAt) return C_AMBER;
  return C_GREEN;
}

uint16_t tempColor(float c) {
  if (c >= 70) return C_RED;
  if (c >= 55) return C_AMBER;
  return C_GREEN;
}

void hline(int y, uint16_t col = C_DIM) {
  gfx->drawFastHLine(0, y, W, col);
}

void printCtr(const char* s, int y, uint8_t sz, uint16_t col = C_FG) {
  gfx->setTextSize(sz);
  gfx->setTextColor(col, C_BG);
  int w = strlen(s) * 6 * sz;
  gfx->setCursor((W - w) / 2, y);
  gfx->print(s);
}

void drawBar(int x, int y, int bw, int bh, float pct, uint16_t col) {
  int filled = (int)(bw * constrain(pct, 0.0f, 100.0f) / 100.0f);
  gfx->fillRect(x, y, bw, bh, C_SEP);
  if (filled > 0) gfx->fillRect(x, y, filled, bh, col);
  gfx->drawRect(x, y, bw, bh, C_DIM);
}

// ECAM label + value: label small/dim, value large/colored below
void drawField(int x, int y, const char* label, const char* value,
               uint16_t valCol = C_FG, uint8_t valSz = 2) {
  gfx->setTextSize(1); gfx->setTextColor(C_DIM, C_BG);
  gfx->setCursor(x, y); gfx->print(label);
  gfx->setTextSize(valSz); gfx->setTextColor(valCol, C_BG);
  gfx->setCursor(x, y + 10); gfx->print(value);
}

// Format integer with thousands comma: 37000 → "37,000"
void fmtThousands(char* buf, int len, int val) {
  if (abs(val) >= 1000)
    snprintf(buf, len, "%s%d,%03d", val < 0 ? "-" : "", abs(val) / 1000, abs(val) % 1000);
  else
    snprintf(buf, len, "%d", val);
}

// Panel card: rounded rect fill + border
void drawPanel(int x, int y, int w, int h) {
  gfx->fillRoundRect(x, y, w, h, 4, C_PANEL);
  gfx->drawRoundRect(x, y, w, h, 4, C_BORDER);
}

// Data cell: label top-left | value right-aligned | unit in right column
void drawDataCell(int x, int y, int w, int h,
                  const char* label, const char* value, const char* unit,
                  uint16_t valCol = C_FG) {
  drawPanel(x, y, w, h);
  gfx->fillRect(x + 1, y + 4, 3, h - 8, C_BLUE);   // left accent

  // Label — top of card
  gfx->setTextSize(1); gfx->setTextColor(C_TEXT_SEC, C_PANEL);
  gfx->setCursor(x + 8, y + 6); gfx->print(label);

  bool hasUnit = unit && unit[0];
  const int unitW = 48;                              // right-column width
  const int divX  = x + w - unitW;

  // Vertical divider + unit centred in right column
  if (hasUnit) {
    gfx->drawFastVLine(divX, y + 4, h - 8, C_BORDER);
    gfx->setTextSize(1); gfx->setTextColor(C_TEXT_SEC, C_PANEL);
    int utw = strlen(unit) * 6;
    gfx->setCursor(divX + (unitW - utw) / 2, y + 26);  // vertically centred with value
    gfx->print(unit);
  }

  // Value — right-aligned against the divider (or card edge if no unit)
  int rightEdge = hasUnit ? divX - 4 : x + w - 4;
  int vtw       = strlen(value) * 6 * 3;            // size-3 pixel width
  int valX      = rightEdge - vtw;
  if (valX < x + 8) valX = x + 8;                   // clamp
  gfx->setTextSize(3); gfx->setTextColor(valCol, C_PANEL);
  gfx->setCursor(valX, y + 18); gfx->print(value);
}

// Top-down aircraft silhouette drawn with GFX primitives
// cx,cy = centre; scale = half-height (~28 works well inside r=68 circle)
void drawAircraftSilhouette(int cx, int cy, int scale, uint16_t col) {
  int fw = max(scale / 5, 3);   // fuselage half-width
  // Fuselage
  gfx->fillRoundRect(cx - fw, cy - scale, fw * 2, scale * 2, fw, col);
  // Main wings (swept)
  gfx->fillTriangle(cx - fw,     cy - scale / 4,
                    cx - scale,  cy + scale / 5,
                    cx - fw,     cy + scale / 2, col);
  gfx->fillTriangle(cx + fw,     cy - scale / 4,
                    cx + scale,  cy + scale / 5,
                    cx + fw,     cy + scale / 2, col);
  // Horizontal tail stabilisers
  int ts = scale * 2 / 5;
  gfx->fillTriangle(cx - fw, cy + scale * 7 / 10,
                    cx - ts, cy + scale * 9 / 10,
                    cx - fw, cy + scale * 9 / 10, col);
  gfx->fillTriangle(cx + fw, cy + scale * 7 / 10,
                    cx + ts, cy + scale * 9 / 10,
                    cx + fw, cy + scale * 9 / 10, col);
}

// Draw a rotated heading arrow at (cx, cy) pointing in trackDeg direction
void drawHeadingArrow(int cx, int cy, int sz, int trackDeg) {
  float rad = degToRad((float)trackDeg);
  float sr = sinf(rad), cr = cosf(rad);
  int tx = cx + (int)(sr * sz);
  int ty = cy - (int)(cr * sz);
  float bsz = sz * 0.55f;
  int lx = cx + (int)(sinf(rad + 2.5f) * bsz);
  int ly = cy - (int)(cosf(rad + 2.5f) * bsz);
  int rx = cx + (int)(sinf(rad - 2.5f) * bsz);
  int ry = cy - (int)(cosf(rad - 2.5f) * bsz);
  gfx->fillTriangle(tx, ty, lx, ly, rx, ry, C_GREEN);
  int tailx = cx - (int)(sr * bsz * 0.8f);
  int taily = cy + (int)(cr * bsz * 0.8f);
  gfx->drawLine(cx, cy, tailx, taily, C_DIM);
}

// ════════════════════════════════════════════════════════════════ STATUS BAR ═══

void drawStatusBar() {
  gfx->fillRoundRect(0, SB_Y - CORNER_R, W, SB_H + CORNER_R, CORNER_R, C_PANEL);
  gfx->fillRect(0, SB_Y - CORNER_R, W, CORNER_R, C_BG);
  hline(SB_Y, C_BORDER);
  gfx->setTextSize(1);
  int y = SB_Y + 6;
  // All x positions stay within BAR_INSET from each edge so they clear the
  // display's physically rounded corners (which mask pixels below x=BAR_INSET).
  const int lx = BAR_INSET;
  const int rx = W - BAR_INSET;
  const int sp = (rx - lx) / 4;  // even spacing across safe width

  gfx->setTextColor(C_BLUE_INFO, C_PANEL);
  gfx->setCursor(lx, y);
  gfx->print(VIEW_ABBR[(int)currentView]);

  char acbuf[8]; snprintf(acbuf, sizeof(acbuf), "%d AC", acCount);
  gfx->setTextColor(C_GREEN, C_PANEL);
  gfx->setCursor(lx + sp, y);
  gfx->print(acbuf);

  char msgbuf[8]; snprintf(msgbuf, sizeof(msgbuf), "%d/s", piAdsbMsgS);
  gfx->setTextColor(C_TEXT_SEC, C_PANEL);
  gfx->setCursor(lx + sp * 2, y);
  gfx->print(msgbuf);

  int rssi = WiFi.RSSI();
  uint16_t rssiCol = rssi > -70 ? C_GREEN : rssi > -85 ? C_AMBER : C_RED;
  char wifibuf[10]; snprintf(wifibuf, sizeof(wifibuf), "%ddBm", rssi);
  gfx->setTextColor(rssiCol, C_PANEL);
  gfx->setCursor(lx + sp * 3, y);
  gfx->print(wifibuf);

  struct tm t;
  if (getLocalTime(&t, 0)) {
    char timebuf[8]; snprintf(timebuf, sizeof(timebuf), "%02d:%02dZ", t.tm_hour, t.tm_min);
    gfx->setTextColor(C_FG, C_PANEL);
    gfx->setCursor(rx - (int)strlen(timebuf) * 6, y);
    gfx->print(timebuf);
  }
}

void drawChrome(const char* title) {
  gfx->fillScreen(C_BG);
  // Rounded top corners follow the display's physical corner curve.
  // Extend down by CORNER_R, then clear the rounded-bottom area back to BG
  // so the bottom of the header remains a straight line at MY.
  gfx->fillRoundRect(0, 0, W, MY + CORNER_R, CORNER_R, C_PANEL);
  gfx->fillRect(0, MY, W, CORNER_R, C_BG);
  hline(MY, C_BORDER);
  // Title centred in header
  gfx->setTextSize(1); gfx->setTextColor(C_FG, C_PANEL);
  int tw = strlen(title) * 6;
  gfx->setCursor((W - tw) / 2, (MY - 8) / 2);
  gfx->print(title);
  // Blue left accent on header
  gfx->fillRect(0, 0, 3, MY, C_BLUE);
  drawStatusBar();
}

// ═══════════════════════════════════════════════════════════ SCREEN 1: DASHBOARD

void renderDashboard() {
  gfx->fillScreen(C_BG);
  drawStatusBar();

  // ── Header panel — rounded top corners follow display curve ──────────────
  gfx->fillRoundRect(0, 0, W, MY + CORNER_R, CORNER_R, C_PANEL);
  gfx->fillRect(0, MY, W, CORNER_R, C_BG);
  hline(MY, C_BORDER);
  gfx->fillRect(0, 0, 3, MY, C_BLUE);   // left accent
  gfx->setTextSize(1); gfx->setTextColor(C_TEXT_SEC, C_PANEL);
  gfx->setCursor(BAR_INSET, (MY - 8) / 2);
  gfx->print(acCount == 0 ? "NO AIRCRAFT" : "CLOSEST AIRCRAFT");
  struct tm tmNow;
  if (getLocalTime(&tmNow, 0)) {
    char tbuf[12]; snprintf(tbuf, sizeof(tbuf), "%02d:%02d UTC", tmNow.tm_hour, tmNow.tm_min);
    gfx->setTextColor(C_FG, C_PANEL);
    gfx->setCursor(W - BAR_INSET - (int)strlen(tbuf) * 6, (MY - 8) / 2);
    gfx->print(tbuf);
  }

  if (acCount == 0) { printCtr("NO AIRCRAFT", MY + CONTENT_H / 2 - 8, 2, C_BORDER); return; }
  AcEntry& a = acList[0];  // always closest

  // ── Left column: radar circle + aircraft silhouette ────────────────────────
  const int cx = MX + 76, cy = MY + 84, cr = 68;

  // Radar rings
  gfx->drawCircle(cx, cy, cr,        C_BORDER);
  gfx->drawCircle(cx, cy, cr * 2/3,  C_PANEL);
  gfx->drawCircle(cx, cy, cr / 3,    C_PANEL);
  gfx->drawFastHLine(cx - cr, cy, cr * 2, C_PANEL);
  gfx->drawFastVLine(cx, cy - cr,    cr * 2, C_PANEL);

  // Aircraft silhouette (dim so it reads as a watermark inside the circle)
  drawAircraftSilhouette(cx, cy, 28, C_TEXT_SEC);

  // FL badge below circle
  char flBuf[10]; fmtAlt(flBuf, sizeof(flBuf), a.alt_ft);
  gfx->setTextSize(1); gfx->setTextColor(C_GREEN, C_BG);
  gfx->setCursor(cx - (int)strlen(flBuf) * 3, cy + cr + 5);
  gfx->print(flBuf);

  // ── Right column: callsign, type, route, ICAO ─────────────────────────────
  const int rx = MX + 158, ry = MY + 6;

  // Callsign — large (size 4 for short names, size 3 for longer)
  const char* cs = a.callsign[0] ? a.callsign : "------";
  uint8_t csSz = strlen(cs) > 7 ? 3 : 4;
  gfx->setTextSize(csSz); gfx->setTextColor(C_FG, C_BG);
  gfx->setCursor(rx, ry); gfx->print(cs);

  // Aircraft type — small gray
  int typeY = ry + csSz * 8 + 4;
  if (a.type[0]) {
    gfx->setTextSize(1); gfx->setTextColor(C_TEXT_SEC, C_BG);
    gfx->setCursor(rx, typeY); gfx->print(a.type);
  }

  // Airline name — secondary text, below type
  if (routeValid && routeAirline[0]) {
    gfx->setTextSize(1); gfx->setTextColor(C_TEXT_SEC, C_BG);
    // Truncate to right-column width
    char al[28]; strncpy(al, routeAirline, 27); al[27] = '\0';
    int maxAl = (W - rx - MX) / 6;
    if ((int)strlen(al) > maxAl) al[maxAl] = '\0';
    gfx->setCursor(rx, typeY + 10); gfx->print(al);
  }

  // Route — city names in info blue
  int routeY = ry + csSz * 8 + 26;
  if (routeValid && strcmp(routeForCs, a.callsign) == 0 && routeOrigin[0]) {
    gfx->setTextSize(1); gfx->setTextColor(C_BLUE_INFO, C_BG);
    gfx->setCursor(rx, routeY);
    gfx->print(routeOriginCity[0] ? routeOriginCity : routeOrigin);
    gfx->setCursor(rx + 4, routeY + 12); gfx->print(">");
    gfx->setCursor(rx, routeY + 24);
    gfx->print(routeDestCity[0] ? routeDestCity : routeDest);
  } else {
    gfx->setTextSize(1); gfx->setTextColor(C_BORDER, C_BG);
    gfx->setCursor(rx, routeY); gfx->print("ROUTE N/A");
  }

  // ICAO badge
  if (a.icao[0]) {
    char icaoBuf[16]; snprintf(icaoBuf, sizeof(icaoBuf), "ICAO %s", a.icao);
    int bw = strlen(icaoBuf) * 6 + 8;
    int badgeY = routeY + 44;
    gfx->fillRoundRect(rx, badgeY, bw, 14, 2, C_PANEL);
    gfx->drawRoundRect(rx, badgeY, bw, 14, 2, C_BORDER);
    gfx->setTextSize(1); gfx->setTextColor(C_BLUE_INFO, C_PANEL);
    gfx->setCursor(rx + 4, badgeY + 3); gfx->print(icaoBuf);
  }

  // ── Data grid: 3 rows × 2 columns ─────────────────────────────────────────
  const int cw = (W - 2 * MX - 4) / 2;   // cell width  = 174
  const int ch = 62;                        // cell height
  const int gx0 = MX, gx1 = MX + cw + 4;
  const int gy  = MY + 166;

  // Row 1: Altitude | Ground Speed
  {
    char altVal[10], altUnit[4], spdVal[10], spdUnit[8];
    if (settingUnits == 1) { fmtThousands(altVal, sizeof(altVal), a.alt_ft); strcpy(altUnit, "ft"); }
    else                   { snprintf(altVal, sizeof(altVal), "%d", (int)(a.alt_ft * 0.3048f)); strcpy(altUnit, "m"); }
    if (settingUnits == 1) { snprintf(spdVal, 10, "%d",  a.spd_kts);                strcpy(spdUnit, "KT");   }
    else                   { snprintf(spdVal, 10, "%d",  (int)(a.spd_kts * 1.852f)); strcpy(spdUnit, "km/h"); }
    drawDataCell(gx0, gy,      cw, ch, "ALTITUDE",     altVal, altUnit, C_FG);
    drawDataCell(gx1, gy,      cw, ch, "GROUND SPEED", spdVal, spdUnit, C_FG);
  }

  // Row 2: Distance | Heading
  {
    char distVal[10], distUnit[4], hdgVal[8];
    if (settingUnits == 1) { snprintf(distVal, 10, "%.1f", a.dist_nm);              strcpy(distUnit, "NM"); }
    else                   { snprintf(distVal, 10, "%.1f", a.dist_nm * 1.852f);     strcpy(distUnit, "km"); }
    snprintf(hdgVal, sizeof(hdgVal), "%d", a.track_deg);
    drawDataCell(gx0, gy + ch + 4,      cw, ch, "DISTANCE", distVal, distUnit, C_FG);
    drawDataCell(gx1, gy + ch + 4,      cw, ch, "HEADING",  hdgVal,  "\xB0",   C_FG);
  }

  // Row 3: Vertical Speed | Bearing
  {
    char vsVal[10];
    if      (a.vrate >  50) snprintf(vsVal, sizeof(vsVal), "+%d", a.vrate);
    else if (a.vrate < -50) snprintf(vsVal, sizeof(vsVal), "%d",  a.vrate);
    else                    strcpy(vsVal, "0");
    float dLat = a.lat - RECEIVER_LAT;
    float dLon = (a.lon - RECEIVER_LON) * cosf(degToRad(RECEIVER_LAT));
    int bearDeg = (int)(atan2f(dLon, dLat) * 180.0f / PI + 360) % 360;
    uint16_t vsCol = a.vrate > 50 ? C_GREEN : a.vrate < -50 ? C_RED : C_TEXT_SEC;
    drawDataCell(gx0, gy + 2 * (ch + 4), cw, ch, "VERT SPEED", vsVal,           "ft/min", vsCol);
    drawDataCell(gx1, gy + 2 * (ch + 4), cw, ch, "BEARING",    compass8(bearDeg), "",     C_FG);
  }

  // ── Route bar ─────────────────────────────────────────────────────────────
  const int routeBarY = gy + 3 * (ch + 4) + 2;
  if (routeBarY + 30 < SB_Y) {
    drawPanel(MX, routeBarY, W - 2 * MX, 28);
    gfx->setTextSize(1);
    if (routeValid && routeOrigin[0]) {
      char rstr[56];
      if (routeOriginCity[0] && routeDestCity[0])
        snprintf(rstr, sizeof(rstr), "%s (%s)  >  %s (%s)",
                 routeOriginCity, routeOrigin, routeDestCity, routeDest);
      else
        snprintf(rstr, sizeof(rstr), "%s  >  %s", routeOrigin, routeDest);
      // Truncate to fit panel
      int maxCh = (W - 2 * MX - 16) / 6;
      rstr[maxCh] = '\0';
      gfx->setTextColor(C_TEXT_SEC, C_PANEL);
      gfx->setCursor(MX + 8, routeBarY + 10); gfx->print(rstr);
    } else {
      gfx->setTextColor(C_BORDER, C_PANEL);
      gfx->setCursor(MX + 8, routeBarY + 10); gfx->print("ROUTE DATA UNAVAILABLE");
    }
  }
}

// ════════════════════════════════════════════════════════════════ SCREEN 2: RADAR

void renderRadar() {
  drawChrome(VIEW_TITLE[V_RADAR]);

  const int cx = W / 2;
  const int cy = MY + 170;
  const int rr = 138;

  // Compute dynamic range
  float maxRange = 50.0f;
  for (int i = 0; i < acCount; i++)
    if (acList[i].dist_nm > maxRange) maxRange = acList[i].dist_nm;
  maxRange = ceilf(maxRange / 50.0f) * 50.0f;

  // Range rings
  for (int ring = 1; ring <= 3; ring++) {
    int pr = rr * ring / 3;
    gfx->drawCircle(cx, cy, pr, C_SEP);
  }
  gfx->drawCircle(cx, cy, rr, C_DIM);

  // Cardinal labels
  gfx->setTextSize(1); gfx->setTextColor(C_DIM, C_BG);
  gfx->setCursor(cx - 3, cy - rr - 12); gfx->print("N");
  gfx->setCursor(cx - 3, cy + rr + 4);  gfx->print("S");
  gfx->setCursor(cx + rr + 4, cy - 4);  gfx->print("E");
  gfx->setCursor(cx - rr - 10, cy - 4); gfx->print("W");

  // Cross hairs
  gfx->drawFastHLine(cx - rr, cy, rr * 2, C_SEP);
  gfx->drawFastVLine(cx, cy - rr, rr * 2, C_SEP);

  // Receiver dot
  gfx->fillCircle(cx, cy, 4, C_AMBER);

  // Aircraft dots
  for (int i = 0; i < acCount; i++) {
    if (acList[i].lat == 0 && acList[i].lon == 0) continue;
    float dLat = acList[i].lat - RECEIVER_LAT;
    float dLon = (acList[i].lon - RECEIVER_LON) * cosf(degToRad(RECEIVER_LAT));
    float bearing = atan2f(dLon, dLat);
    float distFrac = acList[i].dist_nm / maxRange;
    if (distFrac > 1.0f) distFrac = 1.0f;
    int sx = cx + (int)(sinf(bearing) * distFrac * rr);
    int sy = cy - (int)(cosf(bearing) * distFrac * rr);
    if (i == selectedAcIdx) {
      gfx->fillCircle(sx, sy, 5, C_CYAN);
    } else {
      gfx->fillCircle(sx, sy, 3, C_GREEN);
    }
  }

  // Range label and count
  char rlbl[16]; snprintf(rlbl, sizeof(rlbl), "%.0f NM", maxRange);
  gfx->setTextSize(1); gfx->setTextColor(C_DIM, C_BG);
  gfx->setCursor(cx + rr - strlen(rlbl)*6, cy + rr + 4);
  gfx->print(rlbl);
  char cnt[16]; snprintf(cnt, sizeof(cnt), "%d AIRCRAFT", acCount);
  printCtr(cnt, cy + rr + 18, 1, C_DIM);
}

// ════════════════════════════════════════════════════════════════ SCREEN 3: LIST

// First visible row Y — must match touch calculation in loop()
#define LIST_ROW_Y0  (MY + 26)
#define LIST_ROW_H   28

void renderList() {
  drawChrome(VIEW_TITLE[V_LIST]);
  int y = MY + 6;
  gfx->setTextSize(1); gfx->setTextColor(C_CYAN, C_BG);
  gfx->setCursor(MX, y); gfx->print("NEARBY  \xBB TAP TO SELECT");
  y += 14;
  hline(y, C_DIM); y += 6;   // y is now LIST_ROW_Y0

  if (acCount == 0) { printCtr("NO AIRCRAFT", y + 40, 1, C_DIM); return; }

  int maxRows = (SB_Y - y) / LIST_ROW_H;
  int listEnd = min(acCount, maxRows);

  for (int i = 0; i < listEnd; i++) {
    AcEntry& a = acList[i];
    bool sel = (i == selectedAcIdx);

    if (sel) gfx->fillRect(0, y, W, LIST_ROW_H - 2, C_SEP);

    uint16_t bg  = sel ? C_SEP : C_BG;
    uint16_t col = sel ? C_CYAN : C_GRAY;

    gfx->setTextSize(2); gfx->setTextColor(col, bg);
    gfx->setCursor(MX + 2, y + 5);
    gfx->print(sel ? ">" : " ");
    gfx->setCursor(MX + 16, y + 5);
    gfx->printf("%-8s", a.callsign[0] ? a.callsign : "------");

    char distStr[12]; fmtDist(distStr, sizeof(distStr), a.dist_nm);
    gfx->setCursor(W - MX - (int)strlen(distStr) * 12, y + 5);
    gfx->print(distStr);
    y += LIST_ROW_H;
  }

  if (acCount > maxRows) {
    gfx->setTextSize(1); gfx->setTextColor(C_DIM, C_BG);
    char more[24]; snprintf(more, sizeof(more), "+%d MORE NOT SHOWN", acCount - maxRows);
    gfx->setCursor(MX, y + 4); gfx->print(more);
  }
}

// ══════════════════════════════════════════════════════════════ SCREEN 4: DETAIL

void renderDetail() {
  drawChrome(VIEW_TITLE[V_DETAIL]);
  if (acCount == 0) { printCtr("NO AIRCRAFT", MY + 120, 2, C_DIM); return; }
  AcEntry& a = acList[selectedAcIdx];
  int y = MY + 6;

  // Callsign
  gfx->setTextSize(3); gfx->setTextColor(C_FG, C_BG);
  gfx->setCursor(MX, y); gfx->print(a.callsign[0] ? a.callsign : "------");
  y += 30;

  // Type / reg
  gfx->setTextSize(1); gfx->setTextColor(C_GRAY, C_BG);
  char typeReg[32] = "";
  if (a.type[0] && a.reg[0]) snprintf(typeReg, sizeof(typeReg), "%s   [%s]", a.type, a.reg);
  else if (a.type[0]) strncpy(typeReg, a.type, 31);
  else if (a.reg[0])  snprintf(typeReg, sizeof(typeReg), "[%s]", a.reg);
  gfx->setCursor(MX, y); gfx->print(typeReg);
  y += 14;

  // Route
  if (routeValid && strcmp(routeForCs, a.callsign) == 0 && routeOrigin[0]) {
    gfx->setTextSize(2); gfx->setTextColor(C_GREEN, C_BG);
    char route[14]; snprintf(route, sizeof(route), "%s  >  %s", routeOrigin, routeDest);
    gfx->setCursor(MX, y); gfx->print(route);
    y += 22;
    if (routeAirline[0]) {
      gfx->setTextSize(1); gfx->setTextColor(C_GRAY, C_BG);
      gfx->setCursor(MX, y); gfx->print(routeAirline);
      y += 12;
    }
  }
  hline(y, C_DIM); y += 8;

  // 2-column field grid
  char flStr[12], spdStr[14], hdgStr[12], vsStr[12], sqkStr[10], hexStr[10], altStr[12];
  fmtAlt(flStr, sizeof(flStr), a.alt_ft);
  snprintf(altStr, sizeof(altStr), "%d FT", a.alt_ft);
  fmtSpd(spdStr, sizeof(spdStr), a.spd_kts);
  snprintf(hdgStr, sizeof(hdgStr), "%d\xB0",        a.track_deg);
  if (a.vrate > 50)       snprintf(vsStr, sizeof(vsStr), "+%d", a.vrate);
  else if (a.vrate < -50) snprintf(vsStr, sizeof(vsStr), "%d",  a.vrate);
  else                    strncpy(vsStr, "LVL", sizeof(vsStr));
  strncpy(sqkStr, a.squawk[0] ? a.squawk : "----", sizeof(sqkStr)-1);
  strncpy(hexStr, a.icao[0]   ? a.icao   : "------", sizeof(hexStr)-1);

  int cx = W / 2;
  drawField(MX, y, "ALTITUDE",  flStr,  C_GREEN); drawField(cx, y, "SPEED",   spdStr, C_FG);    y += 30;
  drawField(MX, y, "HEADING",   hdgStr, C_FG);    drawField(cx, y, "V/SPEED", vsStr,  a.vrate > 50 ? C_GREEN : a.vrate < -50 ? C_RED : C_DIM); y += 30;
  drawField(MX, y, "SQUAWK",    sqkStr, C_AMBER);  drawField(cx, y, "ICAO HEX", hexStr, C_CYAN); y += 30;
  drawField(MX, y, "ALT FEET",  altStr, C_DIM);
  char dstStr[16]; fmtDist(dstStr, sizeof(dstStr), a.dist_nm);
  drawField(cx, y, "DISTANCE", dstStr, C_FG);
}

// ═════════════════════════════════════════════════════════ SCREEN 5: PI TELEMETRY

void renderPi() {
  drawChrome(VIEW_TITLE[V_PI]);
  int y = MY + 6;

  if (!piOnline) {
    printCtr("PI OFFLINE", y + 60, 2, C_RED);
    printCtr("CHECK NETWORK", y + 90, 1, C_DIM);
    return;
  }

  auto piRow = [&](const char* label, float pct, const char* valStr, uint16_t col) {
    gfx->setTextSize(1);
    gfx->setTextColor(C_DIM, C_BG); gfx->setCursor(MX, y);     gfx->print(label);
    gfx->setTextColor(col,   C_BG); gfx->setCursor(MX + 42, y); gfx->print(valStr);
    y += 11;
    drawBar(MX, y, SAFE_W, 4, pct, col);
    y += 8;
  };

  char buf[32];
  snprintf(buf, sizeof(buf), "%.0f%%  %.1f\xB0 C", piCpuPct, piCpuTemp);
  piRow("CPU", piCpuPct, buf, barColor(piCpuPct));

  snprintf(buf, sizeof(buf), "%.0f%%  %d / %d MB", piMemPct, piMemUsedMb, piMemTotalMb);
  piRow("MEM", piMemPct, buf, barColor(piMemPct));

  snprintf(buf, sizeof(buf), "%.0f%%  %.1f / %.1f GB", piDiskPct, piDiskUsedGb, piDiskTotalGb);
  piRow("DISK", piDiskPct, buf, barColor(piDiskPct, 75, 90));

  hline(y + 2, C_DIM); y += 10;

  gfx->setTextSize(1); gfx->setTextColor(C_DIM, C_BG);

  gfx->setCursor(MX, y); gfx->print("NET");
  gfx->setTextColor(C_FG, C_BG); gfx->setCursor(MX + 30, y);
  if (piNetRxBps < 1024)
    gfx->printf("RX %ld B/s  TX %ld B/s",   piNetRxBps,       piNetTxBps);
  else
    gfx->printf("RX %ld kB/s  TX %ld kB/s", piNetRxBps/1024,  piNetTxBps/1024);
  y += 12;

  gfx->setTextColor(C_DIM, C_BG); gfx->setCursor(MX, y); gfx->print("ADS-B");
  gfx->setTextColor(C_FG, C_BG);  gfx->setCursor(MX + 42, y);
  gfx->printf("%d MSG/S  %d KM RANGE", piAdsbMsgS, piAdsbRange);
  y += 12;

  gfx->setTextColor(C_DIM, C_BG); gfx->setCursor(MX, y); gfx->print("UPTIME");
  gfx->setTextColor(C_FG, C_BG);  gfx->setCursor(MX + 48, y);
  gfx->print(piUptime);
  y += 12;

  gfx->setTextColor(C_DIM, C_BG); gfx->setCursor(MX, y);
  unsigned long age = (millis() - lastVitalsMs) / 1000;
  gfx->printf("(%s  %lus ago)", piHostname, age);
}

// ════════════════════════════════════════════════════════ SCREEN 6: ESP32 TELEMETRY

void renderEsp() {
  drawChrome(VIEW_TITLE[V_ESP]);
  int y = MY + 6;

  auto espRow = [&](const char* label, const char* val, uint16_t col = C_FG) {
    gfx->setTextSize(1); gfx->setTextColor(C_DIM, C_BG);
    gfx->setCursor(MX, y); gfx->print(label);
    gfx->setTextColor(col, C_BG);
    gfx->setCursor(MX + 66, y); gfx->print(val);
    y += 14;
  };

  char buf[32];
  // Battery (PMIC not yet mapped)
  espRow("BATTERY", "N/A  (PMIC PENDING)", C_DIM);

  snprintf(buf, sizeof(buf), "%d KB", (int)(ESP.getFreeHeap() / 1024));
  espRow("FREE HEAP", buf, C_GREEN);

  snprintf(buf, sizeof(buf), "%d MB", (int)(ESP.getFreePsram() / (1024*1024)));
  espRow("PSRAM", buf, C_GREEN);

  snprintf(buf, sizeof(buf), "%d MHz", ESP.getCpuFreqMHz());
  espRow("CPU FREQ", buf);

  snprintf(buf, sizeof(buf), "%d dBm", WiFi.RSSI());
  espRow("WIFI RSSI", buf, WiFi.RSSI() > -70 ? C_GREEN : WiFi.RSSI() > -85 ? C_AMBER : C_RED);

  snprintf(buf, sizeof(buf), "%s", WiFi.localIP().toString().c_str());
  espRow("IP ADDR", buf, C_GRAY);

  snprintf(buf, sizeof(buf), "%d FPS", (int)fpsDisplay);
  espRow("RENDER FPS", buf, C_CYAN);

  snprintf(buf, sizeof(buf), "%lu ms", loopMs);
  espRow("LOOP TIME", buf, C_CYAN);

  unsigned long upSec = millis() / 1000;
  snprintf(buf, sizeof(buf), "%02luh %02lum %02lus", upSec/3600, (upSec%3600)/60, upSec%60);
  espRow("UPTIME", buf, C_GRAY);
}

// ══════════════════════════════════════════════════════════ SCREEN 7: ADS-B HEALTH

void renderAdsb() {
  drawChrome(VIEW_TITLE[V_ADSB]);
  int y = MY + 8;

  auto adsbRow = [&](const char* label, const char* val, uint16_t col = C_FG) {
    gfx->setTextSize(1); gfx->setTextColor(C_DIM, C_BG);
    gfx->setCursor(MX, y); gfx->print(label);
    gfx->setTextSize(2); gfx->setTextColor(col, C_BG);
    gfx->setCursor(MX, y + 10); gfx->print(val);
    y += 36;
  };

  char buf[20];
  snprintf(buf, sizeof(buf), "%d", piAdsbMsgS);
  adsbRow("MESSAGES / S", buf, C_GREEN);

  snprintf(buf, sizeof(buf), "%.1f %%", piAdsbGoodCrc > 0 ? piAdsbGoodCrc : 0.0f);
  adsbRow("GOOD CRC", buf, C_GREEN);

  snprintf(buf, sizeof(buf), "%.1f %%", piAdsbBadCrc > 0 ? piAdsbBadCrc : 0.0f);
  adsbRow("BAD CRC", buf, piAdsbBadCrc > 5 ? C_AMBER : C_FG);

  snprintf(buf, sizeof(buf), "%d", acCount);
  adsbRow("AIRCRAFT", buf, C_FG);

  snprintf(buf, sizeof(buf), "%d KM", piAdsbRange);
  adsbRow("MAX RANGE", buf, C_CYAN);

  hline(y, C_DIM); y += 8;
  gfx->setTextSize(1); gfx->setTextColor(C_DIM, C_BG);
  gfx->setCursor(MX, y);
  unsigned long age = (millis() - lastVitalsMs) / 1000;
  gfx->printf("FROM PI VITALS  %lus AGO", age);
}

// ════════════════════════════════════════════════════════════ SCREEN 8: STATISTICS

void renderStats() {
  drawChrome(VIEW_TITLE[V_STATS]);
  int y = MY + 8;

  gfx->setTextSize(1); gfx->setTextColor(C_CYAN, C_BG);
  gfx->setCursor(MX, y); gfx->print("SESSION");
  y += 14; hline(y, C_DIM); y += 8;

  auto statRow = [&](const char* label, const char* val, uint16_t col = C_FG) {
    gfx->setTextSize(1); gfx->setTextColor(C_DIM, C_BG);
    gfx->setCursor(MX, y); gfx->print(label);
    gfx->setTextSize(2); gfx->setTextColor(col, C_BG);
    gfx->setCursor(MX, y + 10); gfx->print(val);
    y += 34;
  };

  char buf[20];
  snprintf(buf, sizeof(buf), "%d", statsSeenCount);
  statRow("AIRCRAFT SEEN", buf, C_GREEN);

  if (statsHighestFl > 0) { snprintf(buf, sizeof(buf), "FL %d", statsHighestFl); }
  else                       strncpy(buf, "---", sizeof(buf));
  statRow("HIGHEST", buf, C_FG);

  if (statsFastestKph > 0) { snprintf(buf, sizeof(buf), "%d KM/H", statsFastestKph); }
  else                        strncpy(buf, "---", sizeof(buf));
  statRow("FASTEST", buf, C_FG);

  if (statsLongestKm > 0) { snprintf(buf, sizeof(buf), "%.0f KM", statsLongestKm); }
  else                       strncpy(buf, "---", sizeof(buf));
  statRow("LONGEST RANGE", buf, C_FG);

  snprintf(buf, sizeof(buf), "%d", statsAirlineCount);
  statRow("AIRLINES SEEN", buf, C_CYAN);
}

// ═════════════════════════════════════════════════════════════════ SCREEN 9: CLOCK

void renderClockScreen() {
  drawChrome(VIEW_TITLE[V_CLOCK]);
  struct tm t;
  if (!getLocalTime(&t)) { printCtr("NO NTP", MY + 120, 2, C_RED); return; }

  // HH:MM large
  char buf[16];
  snprintf(buf, sizeof(buf), "%02d:%02d", t.tm_hour, t.tm_min);
  printCtr(buf, MY + 12, 5, C_FG);

  // Seconds
  snprintf(buf, sizeof(buf), ":%02d UTC", t.tm_sec);
  printCtr(buf, MY + 72, 1, C_DIM);

  hline(MY + 86, C_BLUE);

  // Day name
  char date[32]; strftime(date, sizeof(date), "%A", &t);
  printCtr(date, MY + 96, 2, C_GREEN);

  // Date
  strftime(date, sizeof(date), "%d %B %Y", &t);
  printCtr(date, MY + 120, 1, C_GRAY);

  hline(MY + 136, C_DIM);

  // Weather
  if (wxFresh) {
    snprintf(buf, sizeof(buf), "%.1f\xB0 C  %s", wxTemp, wxDesc(wxCode));
    printCtr(buf, MY + 148, 1, C_AMBER);
    char wind[32]; snprintf(wind, sizeof(wind), "WIND %.0f KM/H %s", wxWind, compass8(wxWindDir));
    printCtr(wind, MY + 162, 1, C_GRAY);
  }

  hline(MY + 178, C_DIM);

  // Status dots
  int dy = MY + 192;
  gfx->setTextSize(1);

  auto dot = [&](const char* label, bool ok) {
    gfx->setTextColor(C_DIM, C_BG); gfx->setCursor(MX, dy); gfx->print(label);
    gfx->fillCircle(MX + strlen(label)*6 + 6, dy + 3, 4, ok ? C_GREEN : C_RED);
    dy += 18;
  };

  dot("PI",    piOnline);
  dot("ADS-B", piAdsbMsgS > 0);
  dot("WIFI",  WiFi.status() == WL_CONNECTED);

  // Aircraft count
  gfx->setTextColor(C_DIM, C_BG); gfx->setCursor(MX, dy);
  gfx->printf("%d AIRCRAFT IN RANGE", acCount);
}

// ════════════════════════════════════════════════════════════════ SCREEN 10: SETTINGS

void renderSettings() {
  drawChrome(VIEW_TITLE[V_SETTINGS]);
  int y = MY + 8;

  gfx->setTextSize(1); gfx->setTextColor(C_CYAN, C_BG);
  gfx->setCursor(MX, y); gfx->print("LONG PRESS = CHANGE   SHORT = NEXT ITEM");
  y += 14; hline(y, C_DIM); y += 8;

  const char* brightLabels[] = { "25%", "50%", "75%", "100%" };
  const char* unitsLabels[]  = { "METRIC  (km, km/h)", "AVIATION  (NM, KT)" };
  const char* themeLabels[]  = { "ECAM  (Airbus)" };

  auto settRow = [&](int idx, const char* label, const char* value) {
    bool sel = (idx == settingSelected);
    uint16_t labelCol = sel ? C_CYAN  : C_DIM;
    uint16_t valCol   = sel ? C_FG    : C_GRAY;

    // Highlight bar for selected row
    if (sel) gfx->fillRect(0, y - 2, W, 34, C_SEP);

    gfx->setTextSize(1); gfx->setTextColor(labelCol, sel ? C_SEP : C_BG);
    gfx->setCursor(MX + 10, y); gfx->print(sel ? "> " : "  "); gfx->print(label);
    gfx->setTextSize(2); gfx->setTextColor(valCol, sel ? C_SEP : C_BG);
    gfx->setCursor(MX + 20, y + 10); gfx->print(value);
    y += 40;
  };

  settRow(0, "BRIGHTNESS", brightLabels[settingBrightness]);
  settRow(1, "UNITS",      unitsLabels[settingUnits]);
  settRow(2, "THEME",      themeLabels[settingTheme]);

  hline(y, C_DIM); y += 8;
  gfx->setTextSize(1); gfx->setTextColor(C_DIM, C_BG);
  gfx->setCursor(MX, y);
  gfx->print("MORE THEMES COMING SOON");
}

// ─── DISPATCH ─────────────────────────────────────────────────────────────────

void renderCurrentView() {
  unsigned long t0 = millis();
  switch (currentView) {
    case V_DASHBOARD: renderDashboard(); break;
    case V_RADAR:     renderRadar();     break;
    case V_LIST:      renderList();      break;
    case V_DETAIL:    renderDetail();    break;
    case V_PI:        renderPi();        break;
    case V_ESP:       renderEsp();       break;
    case V_ADSB:      renderAdsb();      break;
    case V_STATS:     renderStats();     break;
    case V_CLOCK:     renderClockScreen(); break;
    case V_SETTINGS:  renderSettings();    break;
    default: break;
  }
  gfx->flush();  // canvas: push complete PSRAM frame to display; direct: no-op

  // Update FPS counter (counts render calls per second)
  fpsCount++;
  unsigned long now = millis();
  if (now - fpsWinStart >= 1000) {
    fpsDisplay = fpsCount;
    fpsCount   = 0;
    fpsWinStart = now;
  }
}

// ═════════════════════════════════════════════════════════════════ BUTTON ACTIONS

void onSinglePress() {
  if (currentView == V_SETTINGS) {
    // Cycle highlighted setting; wrap exits to next screen
    settingSelected++;
    if (settingSelected >= SETTINGS_COUNT) {
      settingSelected = 0;
      currentView = (View)((currentView + 1) % V_COUNT);
    }
  } else {
    currentView = (View)((currentView + 1) % V_COUNT);
    if (currentView == V_SETTINGS) settingSelected = 0;
  }
  renderCurrentView();
}

void onLongPress() {
  if (currentView == V_SETTINGS) {
    // Change the selected setting's value
    switch (settingSelected) {
      case 0:
        settingBrightness = (settingBrightness + 1) % 4;
        applyBrightness();
        break;
      case 1:
        settingUnits = (settingUnits + 1) % 2;
        break;
      case 2:
        settingTheme = (settingTheme + 1) % 1;  // only one theme for now
        break;
    }
  }
  renderCurrentView();
}

void onDoublePress() {
  currentView = V_DASHBOARD;
  renderCurrentView();
}

// ═══════════════════════════════════════════════════════════════════════ FETCHES

void sortByDist() {
  for (int i = 0; i < acCount-1; i++)
    for (int j = i+1; j < acCount; j++)
      if (acList[j].dist_nm < acList[i].dist_nm)
        { AcEntry tmp = acList[i]; acList[i] = acList[j]; acList[j] = tmp; }
}

void updateStats(AcEntry* list, int n) {
  for (int i = 0; i < n; i++) {
    AcEntry& e = list[i];
    // Unique callsigns
    if (e.callsign[0]) {
      bool found = false;
      for (int j = 0; j < statsSeenCount && j < 150; j++) {
        if (strcmp(statsSeenCs[j], e.callsign) == 0) { found = true; break; }
      }
      if (!found && statsSeenCount < 150)
        strncpy(statsSeenCs[statsSeenCount++], e.callsign, 9);
    }
    // Highest FL
    int fl = e.alt_ft / 100;
    if (fl > statsHighestFl) statsHighestFl = fl;
    // Fastest
    int kph = (int)(e.spd_kts * 1.852f);
    if (kph > statsFastestKph) statsFastestKph = kph;
    // Longest distance
    float km = e.dist_nm * 1.852f;
    if (km > statsLongestKm) statsLongestKm = km;
    // Unique airline prefixes (first 3 chars of callsign)
    if (strlen(e.callsign) >= 3) {
      char pfx[4]; strncpy(pfx, e.callsign, 3); pfx[3] = '\0';
      bool found = false;
      for (int j = 0; j < statsAirlineCount && j < 50; j++) {
        if (strcmp(statsAirlinePfx[j], pfx) == 0) { found = true; break; }
      }
      if (!found && statsAirlineCount < 50)
        strncpy(statsAirlinePfx[statsAirlineCount++], pfx, 3);
    }
  }
}

void fetchRoute(const char* cs) {
  if (!cs || !cs[0]) return;
  // GET http://PI_IP:8088/?callsign=KLM641
  // Proxy returns normalised flat JSON — no guessing at upstream API structure.
  // Test from Pi: curl "http://localhost:8088/?callsign=KLM641"
  HTTPClient http;
  char url[72]; snprintf(url, sizeof(url), "http://%s:8088/?callsign=%s", PI_IP, cs);
  http.begin(url);
  int code = http.GET();
  if (code != HTTP_CODE_OK) {
    Serial.printf("fetchRoute: HTTP %d for %s\n", code, cs);
    http.end(); return;
  }
  DynamicJsonDocument doc(512);
  if (deserializeJson(doc, http.getStream())) {
    Serial.println("fetchRoute: JSON parse failed");
    http.end(); return;
  }
  http.end();
  if (!doc["ok"]) { Serial.println("fetchRoute: ok=false"); return; }
  strncpy(routeOrigin,     doc["origin"]       | "?", 4);
  strncpy(routeDest,       doc["destination"]  | "?", 4);
  strncpy(routeOriginCity, doc["origin_city"]  | "",  27);
  strncpy(routeDestCity,   doc["dest_city"]    | "",  27);
  strncpy(routeAirline,    doc["airline"]      | "",  51);
  strncpy(routeForCs, cs, 9);
  routeValid = true;
  Serial.printf("fetchRoute OK: %s %s->%s (%s)\n", cs, routeOrigin, routeDest, routeAirline);
}

void fetchWeather() {
  // Only fetch if vitals didn't supply weather recently
  if (wxFresh && millis() - lastWxMs < 300000) return;
  // Plain HTTP — open-meteo serves both http and https; avoid WiFiClientSecure
  // whose TLS handshake can spike heap by ~256 KB and OOM-crash the ESP32.
  HTTPClient http;
  char url[200];
  snprintf(url, sizeof(url),
    "http://api.open-meteo.com/v1/forecast"
    "?latitude=%.5f&longitude=%.5f"
    "&current=temperature_2m,wind_speed_10m,wind_direction_10m,weather_code"
    "&wind_speed_unit=kmh",
    RECEIVER_LAT, RECEIVER_LON);
  http.begin(url);
  if (http.GET() != HTTP_CODE_OK) { http.end(); return; }
  DynamicJsonDocument doc(2048);
  if (deserializeJson(doc, http.getStream())) { http.end(); return; }
  http.end();
  JsonObject cw = doc["current"];
  if (cw.isNull()) return;
  wxTemp    = cw["temperature_2m"]     | wxTemp;
  wxWind    = cw["wind_speed_10m"]     | wxWind;
  wxWindDir = cw["wind_direction_10m"] | wxWindDir;
  wxCode    = cw["weather_code"]       | wxCode;
  wxFresh   = true;
  lastWxMs  = millis();
}

void fetchVitals() {
  HTTPClient http;
  char url[64]; snprintf(url, sizeof(url), "http://%s:%d/api/vitals", PI_IP, PI_PORT);
  http.begin(url); http.setTimeout(5000);
  if (http.GET() != HTTP_CODE_OK) { http.end(); return; }
  DynamicJsonDocument doc(4096);
  if (deserializeJson(doc, http.getStream())) { http.end(); return; }
  http.end();

  piCpuPct      = doc["cpu_pct"]       | piCpuPct;
  piCpuTemp     = doc["cpu_temp"]      | piCpuTemp;
  piMemPct      = doc["mem_pct"]       | piMemPct;
  piMemUsedMb   = doc["mem_used_mb"]   | piMemUsedMb;
  piMemTotalMb  = doc["mem_total_mb"]  | piMemTotalMb;
  piDiskPct     = doc["disk_pct"]      | piDiskPct;
  piDiskUsedGb  = doc["disk_used_gb"]  | piDiskUsedGb;
  piDiskTotalGb = doc["disk_total_gb"] | piDiskTotalGb;
  piNetRxBps    = doc["net_rx_bps"]    | piNetRxBps;
  piNetTxBps    = doc["net_tx_bps"]    | piNetTxBps;
  strncpy(piUptime,   doc["uptime"]   | piUptime,   23);
  strncpy(piHostname, doc["hostname"] | piHostname, 31);

  JsonObject adsb = doc["adsb"];
  if (!adsb.isNull()) {
    piAdsbMsgS    = adsb["messages"]  | piAdsbMsgS;
    piAdsbRange   = adsb["range"]     | piAdsbRange;
    piAdsbGoodCrc = adsb["good_crc"]  | piAdsbGoodCrc;
    piAdsbBadCrc  = adsb["bad_crc"]   | piAdsbBadCrc;
  }

  // Weather may come from Pi vitals (optional)
  JsonObject wx = doc["weather"];
  if (!wx.isNull()) {
    wxTemp    = wx["temp"]     | wxTemp;
    wxWind    = wx["wind_kmh"] | wxWind;
    wxWindDir = wx["wind_dir"] | wxWindDir;
    wxCode    = wx["code"]     | wxCode;
    wxFresh   = true;
    lastWxMs  = millis();
  }

  piOnline     = true;
  lastVitalsMs = millis();
}

void fetchAircraft() {
  HTTPClient http;
  char url[128]; snprintf(url, sizeof(url), "http://%s:%d/data/aircraft.json", PI_IP, PI_PORT);
  http.begin(url); http.setTimeout(8000);
  char pendingRouteCs[10] = "";   // set if route needs refresh after this fetch
  if (http.GET() == HTTP_CODE_OK) {
    // Scope the JSON doc so it is freed before fetchRoute() allocates its TLS buffer.
    // Peak heap without scoping: 48 KB doc + 4 KB route doc + ~50 KB TLS = ~102 KB.
    {
      DynamicJsonDocument doc(32 * 1024);
      if (!deserializeJson(doc, http.getStream())) {
        int nc = 0;
        for (JsonObject ac : doc["aircraft"].as<JsonArray>()) {
          if (!ac.containsKey("lat") || !ac.containsKey("lon")) continue;
          if (nc >= MAX_AC) break;
          AcEntry& e = fetchBuf[nc];
          const char* fl = ac["flight"] | "";
          strncpy(e.callsign, fl, 9); e.callsign[9] = '\0';
          for (int i = strlen(e.callsign)-1; i >= 0 && e.callsign[i] == ' '; i--) e.callsign[i] = '\0';
          strncpy(e.reg,    ac["r"]      | "", 9); e.reg[9]    = '\0';
          strncpy(e.type,   ac["t"]      | "", 7); e.type[7]   = '\0';
          strncpy(e.squawk, ac["squawk"] | "", 5); e.squawk[5] = '\0';
          strncpy(e.icao,   ac["hex"]    | "", 7); e.icao[7]   = '\0';
          e.lat      = ac["lat"] | 0.0f;
          e.lon      = ac["lon"] | 0.0f;
          e.dist_nm  = ac.containsKey("r_dst")
                       ? (float)ac["r_dst"]
                       : haversineNM(RECEIVER_LAT, RECEIVER_LON, e.lat, e.lon);
          e.alt_ft   = ac["alt_baro"].is<int>() ? (int)ac["alt_baro"] : 0;
          e.spd_kts  = (int)(ac["gs"].as<float>());
          e.track_deg= (int)(ac["track"].as<float>());
          e.vrate    = ac["baro_rate"].is<int>() ? (int)ac["baro_rate"] : 0;
          nc++;
        }
        memcpy(acList, fetchBuf, nc * sizeof(AcEntry));
        acCount = nc;
        sortByDist();

        // Clamp selectedAcIdx (may be out of range after re-sort)
        if (selectedAcIdx >= acCount) selectedAcIdx = 0;

        // Route always for closest aircraft (dashboard)
        if (acCount > 0 && strcmp(acList[0].callsign, routeForCs) != 0) {
          routeValid = false;
          strncpy(pendingRouteCs, acList[0].callsign, 9);
        }

        updateStats(fetchBuf, nc);
        lastAcFetchMs = millis();
        piOnline = true;
      }
    } // doc freed here — TLS buffer for fetchRoute now has room
  }
  http.end();  // http freed here too

  if (pendingRouteCs[0]) fetchRoute(pendingRouteCs);
}

// ═══════════════════════════════════════════════════════════════════════ WIFI ═══

bool connectWifi() {
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long t = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - t > 20000) return false;
    delay(250);
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════════════ SETUP ══

void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(BOOT_PIN,  INPUT_PULLUP);
  pinMode(TOUCH_INT, INPUT_PULLUP);

  expanderInit();   // inits CO5300 + allocates canvas if PSRAM available
  gfx->fillScreen(C_BG);

  // Boot splash — each flush() sends the completed canvas frame to the display
  gfx->fillRoundRect(0, 0, W, MY + CORNER_R, CORNER_R, C_PANEL);
  gfx->fillRect(0, MY, W, CORNER_R, C_BG);
  gfx->fillRect(0, 0, 3, MY, C_BLUE);
  hline(MY, C_BORDER);
  gfx->setTextSize(2); gfx->setTextColor(C_FG, C_PANEL);
  gfx->setCursor(MX + 4, 7); gfx->print("FLIGHTBOARD");
  gfx->setTextSize(1); gfx->setTextColor(C_TEXT_SEC, C_BG);
  gfx->setCursor(MX, MY + 16); gfx->print("CONNECTING TO WIFI...");
  gfx->flush();

  if (!connectWifi()) {
    gfx->fillScreen(C_BG);
    printCtr("WIFI FAIL",           H/2 - 24, 2, C_RED);
    char ssidMsg[52]; snprintf(ssidMsg, sizeof(ssidMsg), "SSID: %s", WIFI_SSID);
    printCtr(ssidMsg,               H/2 + 2,  1, C_AMBER);
    printCtr("CHECK SSID/PASSWORD", H/2 + 16, 1, C_BORDER);
    gfx->flush();
    while (true) delay(1000);
  }

  configTime(TZ_OFFSET_SEC, 0, "pool.ntp.org", "time.google.com");

  // Update status line for each boot step; flush pushes the frame to display
  auto bootStep = [&](const char* msg, uint16_t col = C_TEXT_SEC) {
    gfx->fillRect(MX, MY + 16, SAFE_W, 10, C_BG);
    gfx->setTextSize(1); gfx->setTextColor(col, C_BG);
    gfx->setCursor(MX, MY + 16); gfx->print(msg);
    gfx->flush();
  };

  bootStep("WIFI OK", C_GREEN);
  bootStep("FETCHING AIRCRAFT...");
  fetchAircraft();

  bootStep("FETCHING WEATHER...");
  fetchWeather();

  bootStep("FETCHING VITALS...");
  fetchVitals();

  fpsWinStart = millis();
  loopStart   = millis();
  renderCurrentView();
}

// ════════════════════════════════════════════════════════════════════════ LOOP ══

void loop() {
  unsigned long now = millis();

  // ── Button logic ──────────────────────────────────────────────────────
  bool btnLow = (digitalRead(BOOT_PIN) == LOW);

  // Press down
  if (btnLow && !btnWasLow) {
    delay(30);
    if (digitalRead(BOOT_PIN) == LOW) {
      btnDownAt = now;
      longFired = false;
    }
  }

  // Hold: check long press (1 s threshold)
  if (btnLow && btnWasLow && !longFired) {
    if (now - btnDownAt >= 1000) {
      longFired = true;
      onLongPress();
      lastRenderMs = now;
    }
  }

  // Release: register short press (if not long)
  if (!btnLow && btnWasLow && !longFired) {
    if (now - lastShortMs < 450) {
      shortCount++;
    } else {
      shortCount = 1;
    }
    lastShortMs  = now;
    pendingShort = true;
    shortAt      = now;

    if (shortCount >= 2) {
      shortCount   = 0;
      pendingShort = false;
      onDoublePress();
      lastRenderMs = now;
    }
  }

  // Single short press fires after 450 ms (waiting for possible double)
  if (pendingShort && (now - shortAt) > 450) {
    pendingShort = false;
    onSinglePress();
    lastRenderMs = now;
  }

  btnWasLow = btnLow;

  // ── List view touch: tap row → select aircraft → go to detail ────────
  if (currentView == V_LIST && digitalRead(TOUCH_INT) == LOW
      && (now - lastTouchMs) > 350) {
    int16_t tx, ty;
    if (readTouch(tx, ty) && ty >= LIST_ROW_Y0) {
      int row = (ty - LIST_ROW_Y0) / LIST_ROW_H;
      if (row >= 0 && row < acCount && row < (SB_Y - LIST_ROW_Y0) / LIST_ROW_H) {
        selectedAcIdx = row;
        currentView   = V_DETAIL;
        renderCurrentView();
        lastRenderMs = now;
      }
    }
    lastTouchMs = now;
  }

  // ── Periodic data fetches ─────────────────────────────────────────────
  if (now - lastFetchMs >= 5000) {
    lastFetchMs = now;
    fetchAircraft();
    if (now - lastVitalsMs >= 10000) fetchVitals();
    if (now - lastWxMs     >= 300000) fetchWeather();
    renderCurrentView();
    lastRenderMs = now;
  }

  // Clock screen updates every second
  if (currentView == V_CLOCK && now - lastRenderMs >= 1000) {
    lastRenderMs = now;
    renderCurrentView();  // use renderCurrentView so flush() is called
  }

  // Loop timing (for ESP32 screen)
  unsigned long loopEnd = millis();
  loopMs    = loopEnd - loopStart;
  loopStart = millis();
}
