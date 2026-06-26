# ST7735S display driver for 128×128 panels (Waveshare Pico LCD 1.44").
#
# Colour note: MicroPython's framebuf.RGB565 stores pixels in CPU-native
# (little-endian) byte order, but the ST7735S SPI interface expects
# big-endian RGB565.  Callers must therefore pass byte-swapped colour
# values — use swap16() in main.py or define colours via c16().
#   Example: standard RGB565 green = 0x07E0  →  c16(0x07E0) = 0xE007

import machine
import utime

_SWRESET = 0x01
_SLPOUT  = 0x11
_NORON   = 0x13
_INVOFF  = 0x20
_DISPON  = 0x29
_CASET   = 0x2A
_RASET   = 0x2B
_RAMWR   = 0x2C
_MADCTL  = 0x36
_COLMOD  = 0x3A
_FRMCTR1 = 0xB1
_FRMCTR2 = 0xB2
_FRMCTR3 = 0xB3
_INVCTR  = 0xB4
_PWCTR1  = 0xC0
_PWCTR2  = 0xC1
_PWCTR3  = 0xC2
_PWCTR4  = 0xC3
_PWCTR5  = 0xC4
_VMCTR1  = 0xC5
_GMCTRP1 = 0xE0
_GMCTRN1 = 0xE1


def c16(rgb565):
    """Byte-swap a standard RGB565 value for use with framebuf.RGB565."""
    return ((rgb565 & 0xFF) << 8) | (rgb565 >> 8)


class ST7735:
    def __init__(self, cfg):
        self._w  = cfg.LCD_WIDTH
        self._h  = cfg.LCD_HEIGHT
        self._ox = cfg.LCD_X_OFFSET
        self._oy = cfg.LCD_Y_OFFSET
        self._madctl = cfg.LCD_MADCTL

        self._spi = machine.SPI(
            cfg.LCD_SPI_ID,
            baudrate=cfg.LCD_SPI_FREQ,
            polarity=0, phase=0,
            sck=machine.Pin(cfg.LCD_SCK),
            mosi=machine.Pin(cfg.LCD_MOSI),
        )
        self._cs  = machine.Pin(cfg.LCD_CS,  machine.Pin.OUT, value=1)
        self._dc  = machine.Pin(cfg.LCD_DC,  machine.Pin.OUT, value=0)
        self._rst = machine.Pin(cfg.LCD_RST, machine.Pin.OUT, value=1)
        self._bl  = machine.Pin(cfg.LCD_BL,  machine.Pin.OUT, value=0)

        self._reset()
        self._init()
        self._bl.value(1)

    # ── low level ─────────────────────────────────────────────────────────────

    def _reset(self):
        self._rst.value(0); utime.sleep_ms(10)
        self._rst.value(1); utime.sleep_ms(120)

    def _cmd(self, cmd, data=None):
        self._cs.value(0)
        self._dc.value(0)
        self._spi.write(bytes([cmd]))
        if data is not None:
            self._dc.value(1)
            self._spi.write(bytes(data))
        self._cs.value(1)

    # ── initialisation ────────────────────────────────────────────────────────

    def _init(self):
        self._cmd(_SWRESET);                           utime.sleep_ms(150)
        self._cmd(_SLPOUT);                            utime.sleep_ms(500)
        self._cmd(_FRMCTR1, (0x01, 0x2C, 0x2D))
        self._cmd(_FRMCTR2, (0x01, 0x2C, 0x2D))
        self._cmd(_FRMCTR3, (0x01, 0x2C, 0x2D, 0x01, 0x2C, 0x2D))
        self._cmd(_INVCTR,  (0x07,))
        self._cmd(_PWCTR1,  (0xA2, 0x02, 0x84))
        self._cmd(_PWCTR2,  (0xC5,))
        self._cmd(_PWCTR3,  (0x0A, 0x00))
        self._cmd(_PWCTR4,  (0x8A, 0x2A))
        self._cmd(_PWCTR5,  (0x8A, 0xEE))
        self._cmd(_VMCTR1,  (0x0E,))
        self._cmd(_INVOFF)
        self._cmd(_MADCTL,  (self._madctl,))
        self._cmd(_COLMOD,  (0x05,))                  # 16-bit RGB565
        self._cmd(_GMCTRP1, (0x0F, 0x1A, 0x0F, 0x18, 0x2F, 0x28,
                              0x20, 0x22, 0x1F, 0x1B, 0x23, 0x37,
                              0x00, 0x07, 0x02, 0x10))
        self._cmd(_GMCTRN1, (0x0F, 0x1B, 0x0F, 0x17, 0x33, 0x2C,
                              0x29, 0x2E, 0x30, 0x30, 0x39, 0x3F,
                              0x00, 0x07, 0x03, 0x10))
        self._cmd(_NORON);                             utime.sleep_ms(10)
        self._cmd(_DISPON);                            utime.sleep_ms(100)

    # ── public ────────────────────────────────────────────────────────────────

    def show(self, buf):
        """Blit a 128×128 framebuf.RGB565 buffer to the display."""
        ox, oy, w, h = self._ox, self._oy, self._w, self._h
        self._cmd(_CASET, (0x00, ox,      0x00, ox + w - 1))
        self._cmd(_RASET, (0x00, oy,      0x00, oy + h - 1))
        self._cs.value(0)
        self._dc.value(0)
        self._spi.write(bytes([_RAMWR]))
        self._dc.value(1)
        self._spi.write(buf)
        self._cs.value(1)
