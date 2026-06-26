/*
  AudioTest for Waveshare ESP32-S3-Touch-AMOLED-1.8
  Plays a 440Hz sine wave through the ES8311 codec and speaker.

  Pins (from board.rs):
    I2C:   SDA=15, SCL=14   (shared with display)
    I2S:   MCLK=16, SCLK=9, LRCK=45, DOUT=8, DIN=10
    PA:    GPIO 46 HIGH = speaker on  (keep LOW during init!)
    ES8311 I2C addr: 0x18

  Register values derived from waveshare-watch-rs source (audio.rs):
    MCLK = 16000 x 256 = 4,096,000 Hz
    pre_div=2  → reg 0x02 = (2-1)<<5 = 0x20
    bclk_div=4 → reg 0x06 = (4-1)    = 0x03
    lrck       → reg 0x07=0x00, 0x08=0xFF

  Board: ESP32S3 Dev Module, USB CDC on Boot: Enabled
*/

#include <Wire.h>
#include <driver/i2s.h>
#include <math.h>

// I2C
#define I2C_SDA     15
#define I2C_SCL     14

// ES8311
#define ES8311_ADDR 0x18

// I2S
#define I2S_PORT    I2S_NUM_0
#define I2S_MCLK    16
#define I2S_SCLK     9
#define I2S_LRCK    45
#define I2S_DOUT     8
#define I2S_DIN     10

// Speaker PA amplifier — LOW during init, HIGH to enable
#define PA_CTRL     46

#define SAMPLE_RATE 16000
#define TONE_HZ     440
#define BUF_LEN     512   // samples per channel per write

// ── ES8311 ────────────────────────────────────────────────────────────────────

void esWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(ES8311_ADDR);
  Wire.write(reg);
  Wire.write(val);
  uint8_t err = Wire.endTransmission();
  if (err) Serial.printf("  [ES8311] reg 0x%02X err=%d\n", reg, err);
}

void es8311Init() {
  Serial.print("[ES8311] init... ");

  esWrite(0x00, 0x1F);  // reset all modules
  delay(50);
  esWrite(0x00, 0x00);  // clear reset
  delay(10);
  esWrite(0x00, 0x80);  // power-on

  esWrite(0x01, 0x3F);  // enable all clocks, MCLK from pin
  esWrite(0x02, 0x20);  // pre_div=2:  (2-1)<<5 = 0x20
  esWrite(0x03, 0x10);  // ADC OSR
  esWrite(0x04, 0x10);  // DAC OSR
  esWrite(0x05, 0x00);  // ADC/DAC CLK div = 1
  esWrite(0x06, 0x03);  // BCLK div=4: (4-1) = 0x03
  esWrite(0x07, 0x00);  // LRCK high byte
  esWrite(0x08, 0xFF);  // LRCK low byte  (→ /256)

  esWrite(0x09, 0x0C);  // DAC SDP: I2S 16-bit
  esWrite(0x0A, 0x0C);  // ADC SDP: I2S 16-bit

  // Analog power-up
  esWrite(0x0D, 0x01);
  esWrite(0x0E, 0x02);
  esWrite(0x12, 0x00);
  esWrite(0x13, 0x10);

  esWrite(0x1C, 0x6A);  // ADC EQ bypass + DC cancel
  esWrite(0x37, 0x08);  // DAC EQ bypass
  esWrite(0x32, 0xD9);  // volume 85%

  Serial.println("done");
}

// ── I2S ───────────────────────────────────────────────────────────────────────

void i2sInit() {
  Serial.print("[I2S] init... ");

  i2s_config_t cfg = {
    .mode                 = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX | I2S_MODE_RX),
    .sample_rate          = SAMPLE_RATE,
    .bits_per_sample      = I2S_BITS_PER_SAMPLE_16BIT,
    .channel_format       = I2S_CHANNEL_FMT_RIGHT_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags     = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count        = 6,
    .dma_buf_len          = 128,
    .use_apll             = true,
    .tx_desc_auto_clear   = true,
    .mclk_multiple        = I2S_MCLK_MULTIPLE_256,  // MCLK = 256 x 16000 = 4.096MHz
  };
  i2s_driver_install(I2S_PORT, &cfg, 0, NULL);

  i2s_pin_config_t pins = {
    .mck_io_num   = I2S_MCLK,
    .bck_io_num   = I2S_SCLK,
    .ws_io_num    = I2S_LRCK,
    .data_out_num = I2S_DOUT,
    .data_in_num  = I2S_DIN,
  };
  i2s_set_pin(I2S_PORT, &pins);
  i2s_zero_dma_buffer(I2S_PORT);

  Serial.println("done");
}

// ── Tone ──────────────────────────────────────────────────────────────────────

// Stereo interleaved buffer: L, R, L, R ...
static int16_t audioBuf[BUF_LEN * 2];

void buildTone() {
  // One buffer worth of 440Hz sine, looped continuously
  for (int i = 0; i < BUF_LEN; i++) {
    int16_t s = (int16_t)(28000.0f * sinf(2.0f * M_PI * TONE_HZ * i / SAMPLE_RATE));
    audioBuf[i * 2]     = s;  // L
    audioBuf[i * 2 + 1] = s;  // R
  }
}

// ── Setup / Loop ──────────────────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println("\n=== AudioTest ===");

  // PA off during init to avoid noise pop
  pinMode(PA_CTRL, OUTPUT);
  digitalWrite(PA_CTRL, LOW);

  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.setClock(400000);

  // I2S must be running (MCLK active) before ES8311 init
  i2sInit();
  delay(20);

  es8311Init();
  delay(100);

  buildTone();

  // Enable speaker
  digitalWrite(PA_CTRL, HIGH);
  Serial.printf("PA enabled — playing %dHz tone at %dHz sample rate\n", TONE_HZ, SAMPLE_RATE);
}

void loop() {
  size_t written;
  i2s_write(I2S_PORT, audioBuf, sizeof(audioBuf), &written, portMAX_DELAY);
}
