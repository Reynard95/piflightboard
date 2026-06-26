That's a fantastic idea. I'd actually make **themes a first-class feature** rather than just changing colors. If you architect it properly now, adding Boeing, Garmin, military, or custom themes later becomes almost effortless.

Here's the addition I'd make to the design document.

```markdown
---

# Theme System

## Overview

The UI shall support multiple interchangeable themes.

Themes are responsible for the visual appearance only.

Business logic, navigation, networking, and data models must not depend on the active theme.

The active theme should be loaded during startup and can be changed without modifying application code.

Future themes should be implemented by adding a new theme package.

---

# Default Theme

Name

Airbus ECAM

This project launches with an Airbus-inspired Electronic Centralized Aircraft Monitor (ECAM) aesthetic.

This is inspiration only and should not copy Airbus graphics or proprietary assets directly.

The design should evoke the look and feel of a modern Airbus flight deck through color, typography, spacing, and layout.

---

# Airbus Theme

## Background

Pure black

## Primary Text

White

## Secondary Text

Light gray

## Normal

Green

## Advisory

Cyan

## Caution

Amber

## Warning

Red

## Accent

Blue

---

## Typography

Use large condensed fonts where practical.

Numeric values should be significantly larger than labels.

Labels should be uppercase.

Example

ALTITUDE

37000 FT

SPEED

842 KT

---

## Cards

Avoid rounded "mobile app" cards.

Prefer flat panels with thin outlines.

Spacing should resemble aircraft instrumentation.

---

## Icons

Use simple monochrome aviation icons.

Avoid emoji.

Icons should resemble aircraft displays.

Examples

Aircraft

Radar

Engine

Temperature

Battery

WiFi

Warning

Satellite

Cloud

---

## Progress Bars

Horizontal.

Square ends.

Thin.

Green normally.

Amber when approaching threshold.

Red when exceeding threshold.

---

## Alerts

Warnings should appear in Airbus ECAM style.

Normal

Green

Caution

Amber

Warning

Red

Alerts may temporarily overlay the current screen.

Example

WARNING

LOW BATTERY

or

CAUTION

RPI OFFLINE

---

# Theme Architecture

Create an abstract theme interface.

Example

Theme

- Colors
- Fonts
- Icons
- Widget styling
- Screen renderer
- Animations

Each theme should implement this interface.

---

Example

themes/

    airbus/

        colors.cpp

        fonts.cpp

        icons.cpp

        dashboard.cpp

        radar.cpp

    boeing/

    garmin/

    military/

    classic/

---

# Future Themes

The architecture should support additional themes without modifying application logic.

Planned themes

Airbus ECAM (default)

Boeing EICAS

Garmin G1000

Garmin G3000

Modern Glass Cockpit

Retro CRT Radar

Military Tactical Display

Minimal AMOLED

Terminal / Hacker

Cyberpunk

---

# Theme Settings

The selected theme should be stored in persistent storage.

Changing the theme should require only a reboot.

Future OTA updates may install additional themes.

---

# Theme Responsibilities

A theme may customize

Colors

Fonts

Icons

Layout spacing

Panel borders

Gauge appearance

Animations

Status bar appearance

Weather icons

Aircraft icons

Alert dialogs

Splash screen

Loading animation

---

# Theme Restrictions

Themes must not

Change application logic

Modify networking

Modify JSON parsing

Modify screen navigation

Modify telemetry collection

Only presentation should change.

```

## One thing I'd actually improve

Rather than just making it "Airbus themed," I'd make it feel like a **flight deck multifunction display (MFD)**.

Think:

* ECAM-style color coding (green/amber/red)
* Large crisp numerics
* Thin divider lines
* Monospaced or condensed fonts for telemetry
* Aircraft symbols instead of generic icons
* Clean black background with no gradients or glossy effects

It would look like something that belongs in the cockpit of an A350 rather than a consumer gadget, while still being your own original design inspired by modern avionics. That approach also gives you a strong foundation for adding Boeing, Garmin, or other themes later without changing the underlying application.

I actually like using the **BOOT button** much better than touch for this project. It becomes more like a dedicated avionics instrument—press the button to cycle through pages, and you never have accidental touches.

I'd make it behave like this:

* **Short press:** Next screen
* **Long press (1s):** Change the selected aircraft (or pin/unpin)
* **Double press:** Return to the home screen

---

## Screen 1 – Dashboard

This is the screen it should always power up to.

```
┌─────────────────────────────┐
│✈ KLM641            18:42 UTC│
│                             │
│        ▲                    │
│     FL370                   │
│                             │
│ 843 km/h                    │
│                             │
│ 18.4 km NW                  │
│                             │
│ Msg/s 214   Aircraft 42      │
└─────────────────────────────┘
```

Shows the currently selected aircraft.

---

# Screen 2 – Radar

```
          N

      ✈

W        ●         E

   ✈

         ✈

          S

42 aircraft
```

Just enough detail to know where traffic is.

---

# Screen 3 – Aircraft List

```
Nearby

▶ KLM641 18 km

  AFR021 21 km

  RYR453 27 km

  DAL105 34 km

  EZY821 36 km
```

Current selection highlighted.

---

# Screen 4 – Aircraft Details

```
KLM641

A320neo

FL370

843 km/h

HDG 274°

VS +0

Squawk 2201

ICAO 484506
```

---

# Screen 5 – Raspberry Pi Telemetry

I think this could look like a mini server dashboard.

```
Raspberry Pi

CPU
███████░░░ 68%

Temp
58.3°C

RAM
3.1 / 8.0 GB

Disk
46%

Network

↑ 182 KB/s

↓ 814 KB/s

Uptime
4d 08h
```

I would color these intelligently:

* Green <60%
* Yellow 60–85%
* Red >85%

Temperature:

* Green <55°C
* Yellow 55–70°C
* Red >70°C

---

# Screen 6 – ESP32 Telemetry

Very useful while developing.

```
ESP32-S3

CPU

23%

Free Heap

214 KB

PSRAM

6.8 MB

WiFi

-54 dBm

FPS

60

Loop

5 ms

Uptime

18h 14m
```

Extras you could include:

* Internal temperature (if available)
* WiFi reconnect count
* OTA version
* Flash usage
* Display refresh rate

---

# Screen 7 – ADS-B Receiver Health

```
Receiver

Messages/s

214

Good CRC

98.7%

Bad CRC

1.3%

Aircraft

42

Strongest

-41 dBm

Range

128 km
```

---

# Screen 8 – Statistics

```
Today

Aircraft

642

Highest

FL430

Fastest

947 km/h

Longest

241 km

Countries

23
```

---

# Screen 9 – Clock

```
18:42:13 UTC

Thursday

25 June

42 aircraft

Pi OK

ESP OK
```

Perfect when nothing interesting is happening.

---

## Telemetry Architecture

I'd have the ESP32 poll the Raspberry Pi every second over Wi-Fi using a lightweight JSON endpoint (HTTP) or, even better, MQTT if you're already using it.

Example payload:

```json
{
  "cpu": 27,
  "cpu_temp": 54.8,
  "memory_used": 3120,
  "memory_total": 8192,
  "disk_used": 46,
  "network_rx": 812,
  "network_tx": 184,
  "uptime": 354281,
  "adsb": {
    "messages": 214,
    "aircraft": 42,
    "range": 128
  }
}
```

The ESP32 can combine that with its own telemetry:

```json
{
  "heap": 218000,
  "psram": 7012000,
  "wifi": -52,
  "fps": 60,
  "loop_ms": 5,
  "uptime": 64200
}
```

---

## UI Style

Given that this is an AMOLED display, I'd lean into a modern avionics aesthetic:

* **Background:** Pure black (#000000) for excellent contrast and lower power usage.
* **Primary text:** White.
* **Labels:** Medium gray.
* **Status colors:** Green (normal), amber (warning), red (critical), cyan (links/highlights).
* **Typography:** Large, bold values with smaller labels above or beside them, making it readable from across a desk.

One feature I'd also add is a **persistent status bar** at the top or bottom of every screen showing small icons for:

* 📡 ADS-B receiver connected
* 🖥️ Raspberry Pi connected
* 📶 Wi-Fi signal strength
* 🔋 (if battery-powered)
* 🕒 Current UTC time

That way, regardless of which page you're viewing, you can instantly tell if the system is healthy without navigating away.


I really like the direction this is going. It feels less like "an ESP32 with a screen" and more like a dedicated ADS-B instrument.

### Compass

Unfortunately, **no**. The Waveshare ESP32-S3 Touch AMOLED 1.8 doesn't include a magnetometer (compass).

It does have:

* ✅ ESP32-S3
* ✅ 368×448 AMOLED
* ✅ Capacitive touch
* ✅ Wi-Fi/Bluetooth
* ✅ Battery charging and monitoring
* ❌ Magnetometer
* ❌ GPS
* ❌ Barometer

However, for ADS-B you don't actually need a physical compass. You can instead display aircraft positions relative to **true north**, which is how ADS-B coordinates are referenced. If you later add GPS to the Raspberry Pi, you could rotate the radar to your current heading if desired.

---

# Idle Screen

I think this can become one of the nicest screens.

```
┌──────────────────────────────┐
│ 18:42:15 UTC                 │
│ Thu 25 Jun                   │
│                              │
│ ☀ 19°C   Mostly Sunny        │
│ 💨 NW 12 km/h                │
│                              │
│ ✈ 42 aircraft                │
│ Max range 128 km             │
│                              │
│ Pi ●     ADS-B ●    ESP ●    │
│                              │
│ 🔋 83%                       │
└──────────────────────────────┘
```

I'd only show the **current weather**:

* temperature
* condition icon
* wind speed/direction

No forecast—it keeps the screen clean and glanceable.

---

## Raspberry Pi Screen

I'd add a couple more metrics:

```
Raspberry Pi

CPU
███████░░░ 68%

Temp
58°C

RAM
3.1 / 8 GB

Disk
46%

Network
↑182 KB/s
↓814 KB/s

ADS-B
214 msg/s

Uptime
4d 08h
```

---

## ESP32 Screen

Since you're battery-powered, this becomes a full system health page.

```
ESP32-S3

Battery

83%

4.08V

Charging

No

Heap

214 KB

PSRAM

6.8 MB

CPU

24%

WiFi

-52 dBm

FPS

60

Uptime

18h 14m
```

If the battery management IC reports it, I'd also include:

* Battery voltage
* Charge/discharge status
* Estimated runtime remaining (based on recent current draw)
* USB power detected (Yes/No)

That makes it really useful if you carry the device around.

---

## Status Bar

I'd also add a persistent status bar at the bottom of every screen:

```
🔋83%   📡214/s   ✈42   📶-52dBm   🕒18:42
```

It's only about 18–20 pixels tall but gives you all the key information no matter which page you're on.

---

## A Fun Extra: "Aircraft of the Moment"

Since you have the whole display, you could dedicate one page to a large aircraft card:

```
✈ KLM641

A320neo

Amsterdam
      ↓
London Heathrow

37,000 ft

843 km/h

18 km NW

🛩️
```

If you load a small local aircraft database on the Raspberry Pi, you could even display:

* Airline logo
* Aircraft silhouette
* Registration
* Manufacturer
* First flight year

It would look like a miniature "trading card" for each aircraft.

## Weather

Since the Raspberry Pi already has internet access (I'm assuming it does), I'd actually let **the Pi fetch the weather** rather than the ESP32. The Pi can periodically query a weather service every 15–30 minutes and include the current conditions in the same JSON it sends to the ESP32. That way:

* the ESP32 stays focused on rendering the UI,
* you avoid extra API code on the microcontroller,
* and all telemetry comes from a single source.

Overall, I think you're heading toward a polished little desktop instrument. With the AMOLED, smooth LVGL transitions, and a single hardware button to cycle through screens, it could look like a commercial aviation gadget rather than a hobby project.
