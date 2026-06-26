# Flash MicroPython to ESP32-S3
# This script will erase the ESP32 and install MicroPython

# Find the COM port
Write-Host "Detecting USB-attached ESP32..." -ForegroundColor Cyan
$ports = Get-WmiObject Win32_SerialPort | Where-Object { $_.Name -like "*Serial*" }

if ($ports.Count -eq 0) {
    Write-Host "ERROR: No COM ports found!" -ForegroundColor Red
    Write-Host "Troubleshooting:" -ForegroundColor Yellow
    Write-Host "1. Connect ESP32-S3 via USB-C cable"
    Write-Host "2. Wait 2 seconds for Windows to detect it"
    Write-Host "3. Check Device Manager (devmgmt.msc) for COM port"
    Write-Host "4. If not detected, install USB drivers from Waveshare"
    exit 1
}

Write-Host "Found COM port(s):" -ForegroundColor Green
foreach ($port in $ports) {
    Write-Host "  $($port.Name) - $($port.Description)"
}

$comPort = Read-Host "Enter COM port (e.g., COM3)"

Write-Host ""
Write-Host "=== IMPORTANT ===" -ForegroundColor Yellow
Write-Host "Put ESP32-S3 into bootloader mode:"
Write-Host "  1. Hold BOOT button"
Write-Host "  2. Press RESET button"
Write-Host "  3. Release BOOT button (still hold RESET)"
Write-Host "  4. Release RESET button"
Write-Host "  5. LED on ESP32 should turn on"
Write-Host ""
Read-Host "Press ENTER when ESP32 is in bootloader mode"

Write-Host "Downloading MicroPython firmware..." -ForegroundColor Cyan
$fw_url = "https://micropython.org/resources/firmware/esp32spiram-20240105-v1.22.2.bin"
$fw_file = "$PSScriptRoot\ESP32_SPIRAM-20240105-v1.22.2.bin"

if (Test-Path $fw_file) {
    Write-Host "Firmware already downloaded: $fw_file" -ForegroundColor Green
} else {
    Invoke-WebRequest -Uri $fw_url -OutFile $fw_file -UseBasicParsing
    Write-Host "Downloaded: $fw_file" -ForegroundColor Green
}

Write-Host ""
Write-Host "Erasing ESP32 flash..." -ForegroundColor Cyan
python -m esptool --chip esp32s3 --port $comPort erase_flash
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Erase failed!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Writing MicroPython firmware..." -ForegroundColor Cyan
python -m esptool --chip esp32s3 --port $comPort write_flash -z 0x0 $fw_file
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Flash failed!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== SUCCESS ===" -ForegroundColor Green
Write-Host "MicroPython installed! ESP32-S3 will now restart."
Write-Host "Next step: Copy config.py, main.py, boot.py, st7789.py to the ESP32"
Write-Host ""
