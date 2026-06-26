from machine import Pin
import time

candidates = [2, 3, 14, 15, 16, 17, 18, 19, 20, 21, 22, 26, 27, 28]
pins = {i: Pin(i, Pin.IN, Pin.PULL_UP) for i in candidates}
last = {i: pins[i].value() for i in pins}

print("Press each button (Ctrl+C to stop)...")
while True:
    for i, p in pins.items():
        v = p.value()
        if v != last[i]:
            print("GP" + str(i) + ": " + ("PRESSED" if not v else "released"))
            last[i] = v
    time.sleep_ms(10)
