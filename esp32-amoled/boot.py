# boot.py -- run on startup

import machine
import webrepl

# Disable REPL on UART (to avoid conflicts)
# webrepl.start()

# Initialize basic system
print("Boot complete. Running main.py...")
