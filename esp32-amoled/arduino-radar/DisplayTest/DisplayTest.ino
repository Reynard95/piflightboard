/*
  DisplayTest for Waveshare ESP32-S3-Touch-AMOLED-1.8 (CO5300, 368x448, QSPI)

  Key facts from board schematic (board.rs):
    - Display controller: CO5300 (not ST7789, not SH8601)
    - Interface: QSPI  SCK=11, D0=4, D1=5, D2=6, D3=7, CS=12
    - LCD Reset + DSI_PWR_EN controlled via TCA9554 I2C expander (addr 0x20)
    - I2C bus: SDA=15, SCL=14
    - GPIO 46 = audio PA power — must stay LOW, do not touch

  Library (Library Manager): GFX Library for Arduino (Moon On Our Nation)
  Board: ESP32S3 Dev Module, USB CDC on Boot: Enabled
*/

#include <Wire.h>
#include <Arduino_GFX_Library.h>

// QSPI pins
#define LCD_CS    12
#define LCD_SCK   11
#define LCD_D0     4
#define LCD_D1     5
#define LCD_D2     6
#define LCD_D3     7

// I2C
#define I2C_SDA   15
#define I2C_SCL   14

// TCA9554 I2C expander (addr 0x20) — controls LCD_RST, DSI_PWR_EN, TP_RST
#define TCA9554_ADDR  0x20
#define TCA9554_OUT   0x01   // Output Port register
#define TCA9554_CFG   0x03   // Configuration register (0=output)
#define PIN_LCD_RST   0      // expander bit 0
#define PIN_PWR_EN    1      // expander bit 1
#define PIN_TP_RST    2      // expander bit 2

uint8_t expanderState = 0x00;

void expanderWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(TCA9554_ADDR);
  Wire.write(reg);
  Wire.write(val);
  Wire.endTransmission();
}

void expanderSetBit(uint8_t bit, bool high) {
  if (high) expanderState |=  (1 << bit);
  else      expanderState &= ~(1 << bit);
  expanderWrite(TCA9554_OUT, expanderState);
}

Arduino_DataBus *bus = nullptr;
Arduino_GFX    *gfx = nullptr;

void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println("\n=== DisplayTest CO5300 ===");

  // I2C for TCA9554
  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.setClock(400000);
  Serial.println("I2C init done");

  // TCA9554: all pins as outputs
  expanderWrite(TCA9554_CFG, 0x00);
  expanderWrite(TCA9554_OUT, 0x00);  // everything low
  delay(20);

  // Power on display
  expanderSetBit(PIN_PWR_EN, true);
  delay(20);
  Serial.println("DSI_PWR_EN HIGH");

  // Reset LCD
  expanderSetBit(PIN_LCD_RST, false);
  delay(20);
  expanderSetBit(PIN_LCD_RST, true);
  delay(20);
  Serial.println("LCD reset done");

  // QSPI + CO5300 (reset already done via expander, pass -1)
  bus = new Arduino_ESP32QSPI(LCD_CS, LCD_SCK, LCD_D0, LCD_D1, LCD_D2, LCD_D3);
  gfx = new Arduino_CO5300(bus, GFX_NOT_DEFINED /* rst */, 0, 368, 448);

  Serial.print("gfx->begin(80MHz)... ");
  if (!gfx->begin(80000000)) {
    Serial.println("FAILED");
  } else {
    Serial.println("OK");
  }

  Serial.print("fillScreen RED... ");
  gfx->fillScreen(0xF800);
  Serial.println("done");
  delay(1000);

  Serial.print("fillScreen GREEN... ");
  gfx->fillScreen(0x07E0);
  Serial.println("done");
  delay(1000);

  Serial.print("fillScreen BLUE... ");
  gfx->fillScreen(0x001F);
  Serial.println("done");
  delay(1000);

  gfx->fillScreen(0x0000);
  gfx->setTextColor(0xFFFF);
  gfx->setTextSize(3);
  gfx->setCursor(20, 180);
  gfx->println("HELLO");
  gfx->setCursor(20, 220);
  gfx->println("CO5300");
  Serial.println("Text drawn. Done.");
}

void loop() {
  delay(5000);
  Serial.println("Running...");
}
