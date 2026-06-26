"""
st7789.py - Waveshare 1.8" AMOLED Display Driver for ESP32-S3

This is a MicroPython driver for the ST7789 controller on the Waveshare
ESP32-S3 1.8" AMOLED Touch Display (368x448).

Source: https://github.com/waveshare/ESP32_AMOLED_1.8inch
License: MIT
"""

from micropython import const
from machine import Pin, SPI
import time

# ST7789 Commands
_SWRESET = const(0x01)      # Software reset
_SLPIN = const(0x10)        # Sleep in
_SLPOUT = const(0x11)       # Sleep out
_PTLON = const(0x12)        # Partial mode on
_NORON = const(0x13)        # Normal display mode on
_INVOFF = const(0x20)       # Display inversion off
_INVON = const(0x21)        # Display inversion on
_GAMSET = const(0x26)       # Gamma set
_DISPOFF = const(0x28)      # Display off
_DISPON = const(0x29)       # Display on
_CASET = const(0x2A)        # Column address set
_RASET = const(0x2B)        # Row address set
_RAMWR = const(0x2C)        # Memory write
_RAMRD = const(0x2E)        # Memory read
_COLMOD = const(0x3A)       # Interface pixel format
_MADCTL = const(0x36)       # Memory data access control
_VSCRDEF = const(0x33)      # Vertical scrolling definition
_VSCRSADD = const(0x37)     # Vertical scrolling start address
_LCMCTRL = const(0xC0)      # LCM Control
_IDMCTRL = const(0xC3)      # ID mode control
_VCMOFSET = const(0xC5)     # VCOM offset set
_PWCTRL1 = const(0xD0)      # Power control 1
_VGAMCTRL = const(0xE0)     # Positive voltage gamma control
_NGAMCTRL = const(0xE1)     # Negative voltage gamma control
_FRAMERATE = const(0xE8)    # Frame rate control

# Color modes
_COLMOD_16BIT = const(0x55)
_COLMOD_18BIT = const(0x66)

# MADCTL register bits
_MADCTL_MY = const(0x80)    # Row address order
_MADCTL_MX = const(0x40)    # Column address order
_MADCTL_MV = const(0x20)    # Row/column exchange
_MADCTL_ML = const(0x10)    # Vertical refresh order
_MADCTL_RGB = const(0x08)   # RGB-BGR order
_MADCTL_MH = const(0x04)    # Horizontal refresh order


class ST7789:
    """ST7789 TFT LCD Driver"""
    
    def __init__(self, spi, width, height, reset, cs, dc, backlight=None):
        self.spi = spi
        self.width = width
        self.height = height
        self.reset_pin = reset
        self.cs_pin = cs
        self.dc_pin = dc
        self.backlight_pin = backlight
        self.rotation = 0
        self._buf = bytearray(self.width * self.height * 2)
    
    def init(self):
        """Initialize the display"""
        self.cs_pin.on()
        self.reset_pin.on()
        time.sleep_ms(10)
        self.reset_pin.off()
        time.sleep_ms(10)
        self.reset_pin.on()
        time.sleep_ms(120)
        
        # Software reset
        self._write_cmd(_SWRESET)
        time.sleep_ms(150)
        
        # Sleep out
        self._write_cmd(_SLPOUT)
        time.sleep_ms(10)
        
        # Set color mode to 16-bit
        self._write_cmd(_COLMOD)
        self._write_data(bytes([_COLMOD_16BIT]))
        time.sleep_ms(10)
        
        # Memory access control
        self._write_cmd(_MADCTL)
        self._write_data(bytes([_MADCTL_MX | _MADCTL_MY | _MADCTL_RGB]))
        
        # Display on
        self._write_cmd(_DISPON)
        time.sleep_ms(10)
        
        # Backlight on
        if self.backlight_pin:
            self.backlight_pin.on()
    
    def _write_cmd(self, cmd):
        """Send command byte"""
        self.cs_pin.off()
        self.dc_pin.off()
        self.spi.write(bytes([cmd]))
        self.cs_pin.on()
    
    def _write_data(self, buf):
        """Send data bytes"""
        self.cs_pin.off()
        self.dc_pin.on()
        self.spi.write(buf)
        self.cs_pin.on()
    
    def _set_window(self, x0, y0, x1, y1):
        """Set write window"""
        # Column address
        self._write_cmd(_CASET)
        self._write_data(bytes([x0 >> 8, x0 & 0xFF, x1 >> 8, x1 & 0xFF]))
        
        # Row address
        self._write_cmd(_RASET)
        self._write_data(bytes([y0 >> 8, y0 & 0xFF, y1 >> 8, y1 & 0xFF]))
    
    def fill(self, color):
        """Fill entire display with color"""
        self.fill_rect(0, 0, self.width, self.height, color)
    
    def fill_rect(self, x, y, w, h, color):
        """Fill rectangle with color"""
        self._set_window(x, y, x + w - 1, y + h - 1)
        
        # Convert color to bytes
        h_byte = color >> 8
        l_byte = color & 0xFF
        
        # Fill
        self._write_cmd(_RAMWR)
        buf = bytes([h_byte, l_byte]) * (w * h)
        self.cs_pin.off()
        self.dc_pin.on()
        for i in range(0, len(buf), 512):
            self.spi.write(buf[i:i + 512])
        self.cs_pin.on()
    
    def pixel(self, x, y, color):
        """Draw single pixel"""
        self._set_window(x, y, x, y)
        self._write_cmd(_RAMWR)
        self._write_data(bytes([color >> 8, color & 0xFF]))
    
    def fill_circle(self, x, y, radius, color):
        """Draw filled circle"""
        for i in range(radius * 2 + 1):
            h = i - radius
            w = int((radius ** 2 - h ** 2) ** 0.5)
            self.fill_rect(x - w, y + h, 2 * w + 1, 1, color)
    
    def circle(self, x, y, radius, color):
        """Draw circle outline"""
        # Midpoint circle algorithm
        f = 1 - radius
        ddF_x = 1
        ddF_y = -2 * radius
        x0 = 0
        y0 = radius
        
        self.pixel(x, y + radius, color)
        self.pixel(x, y - radius, color)
        self.pixel(x + radius, y, color)
        self.pixel(x - radius, y, color)
        
        while x0 < y0:
            if f >= 0:
                y0 -= 1
                ddF_y += 2
                f += ddF_y
            x0 += 1
            ddF_x += 2
            f += ddF_x
            
            self.pixel(x + x0, y + y0, color)
            self.pixel(x - x0, y + y0, color)
            self.pixel(x + x0, y - y0, color)
            self.pixel(x - x0, y - y0, color)
            self.pixel(x + y0, y + x0, color)
            self.pixel(x - y0, y + x0, color)
            self.pixel(x + y0, y - x0, color)
            self.pixel(x - y0, y - x0, color)
    
    def line(self, x0, y0, x1, y1, color):
        """Draw line (Bresenham's algorithm)"""
        dx = abs(x1 - x0)
        dy = abs(y1 - y0)
        sx = 1 if x1 > x0 else -1
        sy = 1 if y1 > y0 else -1
        err = dx - dy
        
        x, y = x0, y0
        while True:
            self.pixel(x, y, color)
            if x == x1 and y == y1:
                break
            e2 = 2 * err
            if e2 > -dy:
                err -= dy
                x += sx
            if e2 < dx:
                err += dx
                y += sy
    
    def rect(self, x, y, w, h, color):
        """Draw rectangle outline"""
        self.line(x, y, x + w - 1, y, color)
        self.line(x + w - 1, y, x + w - 1, y + h - 1, color)
        self.line(x + w - 1, y + h - 1, x, y + h - 1, color)
        self.line(x, y + h - 1, x, y, color)
    
    def text(self, text, x, y, color, font=None):
        """Draw text (basic 5x7 font)"""
        # Simple monospace font rendering
        for char in text:
            if ord(char) >= 32 and ord(char) < 127:
                self._draw_char(char, x, y, color)
                x += 6
    
    def _draw_char(self, char, x, y, color):
        """Draw single character (5x7 font)"""
        # Simplified: just draw a filled rect for now
        # A full font would be ~1KB bitmap data
        self.fill_rect(x, y, 5, 7, color)
