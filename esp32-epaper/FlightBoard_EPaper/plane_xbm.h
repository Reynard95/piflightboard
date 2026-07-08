// Hand-authored 16x12 airplane silhouette (top-down, nose pointing right) —
// no U8g2 font in this sketch's vendored install contains an airplane glyph
// (checked all fonts in use plus every u8g2_font_open_iconic_* set), so the
// route banner's plane icon is a small bitmap instead, same technique as
// A3_xbm.h. Byte order matches convert_a3.py's output: LSB-first per row.
#pragma once
#include <pgmspace.h>

#define PLANE_XBM_W  16
#define PLANE_XBM_H  12
static const uint8_t PLANE_XBM[] PROGMEM = {
  0x00, 0x00,
  0x00, 0x00,
  0x00, 0x01,
  0x80, 0x03,
  0xCC, 0x07,
  0xFC, 0xFF,
  0xFC, 0x7F,
  0xCC, 0x07,
  0x80, 0x03,
  0x00, 0x01,
  0x00, 0x00,
  0x00, 0x00,
};
