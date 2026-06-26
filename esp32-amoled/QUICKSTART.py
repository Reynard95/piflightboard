#!/usr/bin/env python3
"""
Quick Start Guide for ESP32-S3 AMOLED Radar
"""

# ============================================================================
# STEP 1: PREPARE YOUR COMPUTER
# ============================================================================
# 
# 1. Install Python 3.8+: https://www.python.org/
# 
# 2. Install esptool (Flash MicroPython):
#    pip install esptool
# 
# 3. Install rshell (Copy files to ESP32):
#    pip install rshell
# 
# 4. Install Thonny IDE (OPTIONAL but recommended):
#    https://thonny.org/
#

# ============================================================================
# STEP 2: IDENTIFY YOUR RASPBERRY PI
# ============================================================================
#
# On your Pi, find the local IP:
#   $ hostname -I
#   
# Example output: 192.168.1.100
# 
# Test that it's reachable:
#   $ curl http://192.168.1.100/data/aircraft.json
#   
# You should see live aircraft data in JSON format.
#

# ============================================================================
# STEP 3: FLASH MICROPYTHON TO ESP32
# ============================================================================
#
# 1. Download ESP32-S3 firmware:
#    Visit: https://micropython.org/download/esp32/
#    Look for "ESP32 SPIRAM" variant (about 1.7 MB file)
#    Example: ESP32_SPIRAM-20240105-v1.22.bin
# 
# 2. Connect ESP32 via USB-C cable
# 
# 3. Put ESP32 into bootloader mode:
#    - Hold BOOT button
#    - Press RESET button  
#    - Release BOOT button
#    - USB device should appear as COM port
# 
# 4. Flash MicroPython (Windows):
#    esptool.py --chip esp32s3 --port COM3 erase_flash
#    esptool.py --chip esp32s3 --port COM3 write_flash -z 0x0 ESP32_SPIRAM-20240105-v1.22.bin
# 
#    On macOS/Linux, replace COM3 with /dev/ttyUSB0 or /dev/ttyACM0
# 

# ============================================================================
# STEP 4: CONFIGURE YOUR RADAR APP
# ============================================================================
#
# Edit config.py:
# 
#   WIFI_SSID = "your_home_network"
#   WIFI_PASSWORD = "your_password"
#   PI_IP = "192.168.1.100"  # Your Pi's IP from Step 2
#   RECEIVER_LAT = 52.0116   # From Pi's config/readsb.conf
#   RECEIVER_LON = 4.7683
#

# ============================================================================
# STEP 5: COPY FILES TO ESP32
# ============================================================================
#
# Option A: Using Thonny (Easiest - GUI)
# ------------------------------------------
#   1. Open Thonny
#   2. Tools → Options → Interpreter → MicroPython (ESP32)
#   3. Select the COM port and click Connect
#   4. Drag these files into the Thonny file browser on the left:
#      - config.py
#      - main.py
#      - boot.py
#      - st7789.py
#   5. ESP32 will reboot and start the radar automatically
# 
# Option B: Using rshell (Terminal)
# ----------------------------------
#   rshell
#   > cp config.py /pyboard/
#   > cp main.py /pyboard/
#   > cp boot.py /pyboard/
#   > cp st7789.py /pyboard/
#   > repl
#   > import sys; sys.exit()
#   > exit
#

# ============================================================================
# STEP 6: TEST THE RADAR
# ============================================================================
#
# 1. Power on ESP32 (USB-C or battery)
# 2. LED should turn on (backlight)
# 3. Wait 5-10 seconds for WiFi to connect
# 4. You should see a radar display with aircraft blips
# 
# If the screen is black:
#   - Check that WiFi is connected (look for messages in console)
#   - Verify Pi's readsb is running: sudo systemctl status readsb
#   - Try accessing http://192.168.1.100/data/aircraft.json in browser
#

# ============================================================================
# STEP 7: DEBUGGING
# ============================================================================
#
# To see debug output (in Thonny or rshell):
#
#   1. In Thonny: Tools → Plotter & Serial monitor
#   2. You'll see print statements from main.py
# 
# Common Issues:
# 
#   Issue: "WiFi Failed"
#   → Check WIFI_SSID and WIFI_PASSWORD in config.py
#   → Move ESP32 closer to router
#   → Check 5GHz networks (ESP32 uses 2.4GHz only)
# 
#   Issue: "No aircraft shown"
#   → Verify Pi is accessible: ping 192.168.1.100
#   → Check readsb running: sudo systemctl status readsb
#   → Test URL: http://192.168.1.100/data/aircraft.json
#   → Set DEBUG_MODE = True in config.py to see fetch times
# 
#   Issue: Display is garbled
#   → Try rotating: DISPLAY_ROTATION = 1, 2, or 3 in config.py
#   → Reinstall st7789.py from Waveshare
#

# ============================================================================
# STEP 8: OPTIMIZE FOR BATTERY (OPTIONAL)
# ============================================================================
#
# To extend battery life:
#
#   1. Reduce backlight: Pin(config.BACKLIGHT_PIN, Pin.OUT).off()
#   2. Increase FETCH_INTERVAL to 5-10 seconds
#   3. Reduce DISPLAY_ROTATION updates
#   4. Disable SHOW_CALLSIGNS and SHOW_GRID_LINES
#

print(__doc__)
