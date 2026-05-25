"""
app.py — Cyberdeck Aviation Console window manager

Opens each panel defined in layout.json as a positioned PyQt6 window
containing a QWebEngineView. Works on a single screen in windowed mode
for development, or drives multiple displays on the real cyberdeck.

Keyboard shortcuts (global):
  Escape / F1   → toggle the control overlay (screen/panel info)
  F5            → reload all panels
  Ctrl+Q        → quit
  Ctrl+L        → cycle through saved layouts (if multiple defined)

Layout config: cyberdeck/layout.json
Server:        cyberdeck/server.py  (started automatically as a subprocess)

Usage:
  python3 cyberdeck/app.py
  python3 cyberdeck/app.py --layout my-layout.json
  python3 cyberdeck/app.py --no-server   (if server already running)
"""

import argparse
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional

try:
    from PyQt6.QtCore import (
        Qt, QTimer, QUrl, QPoint, QSize, QRect, pyqtSlot
    )
    from PyQt6.QtGui import (
        QColor, QFont, QFontMetrics, QKeySequence, QPainter,
        QPalette, QShortcut, QAction
    )
    from PyQt6.QtWidgets import (
        QApplication, QLabel, QMainWindow, QMenu, QSizePolicy,
        QVBoxLayout, QWidget, QSystemTrayIcon, QFrame, QPushButton,
        QHBoxLayout,
    )
    from PyQt6.QtWebEngineWidgets import QWebEngineView
    from PyQt6.QtWebEngineCore import QWebEngineSettings, QWebEnginePage
except ImportError as e:
    print(f"ERROR: PyQt6 or PyQt6-WebEngine not installed: {e}")
    print()
    print("Install with:")
    print("  pip install PyQt6 PyQt6-WebEngine")
    print("  (or on Raspberry Pi: sudo apt install python3-pyqt6 python3-pyqt6.qtwebengine)")
    sys.exit(1)


# ---------------------------------------------------------------------------
# Paths & defaults
# ---------------------------------------------------------------------------

HERE        = Path(__file__).parent
DEFAULT_LAYOUT = HERE / "layout.json"
WWW_DIR     = HERE.parent / "www"

DARK_BG     = "#0a0e14"
ACCENT      = "#ffa040"
ACCENT_DIM  = "#7a4010"
TEXT_LIGHT  = "#c8d0d8"


# ---------------------------------------------------------------------------
# Panel window
# ---------------------------------------------------------------------------

class PanelWindow(QMainWindow):
    """
    A single cyberdeck panel — a borderless window containing a web view
    that loads one of the dashboard pages.
    """

    def __init__(
        self,
        panel_cfg: dict,
        base_url: str,
        screen_rect: QRect,
        frameless: bool = True,
        parent=None,
    ):
        super().__init__(parent)
        self.panel_id  = panel_cfg.get("id", "panel")
        self.panel_cfg = panel_cfg
        self._base_url = base_url

        # ── Window flags ──────────────────────────────────────────────────
        if frameless:
            self.setWindowFlags(
                Qt.WindowType.FramelessWindowHint |
                Qt.WindowType.Window
            )
        self.setWindowTitle(f"Cyberdeck — {self.panel_id}")

        # ── Position & size ───────────────────────────────────────────────
        x      = screen_rect.x() + panel_cfg.get("x", 0)
        y      = screen_rect.y() + panel_cfg.get("y", 0)
        width  = panel_cfg.get("width",  800)
        height = panel_cfg.get("height", 600)
        self.setGeometry(x, y, width, height)

        # ── Background colour (shown before page loads) ───────────────────
        palette = self.palette()
        palette.setColor(QPalette.ColorRole.Window, QColor(DARK_BG))
        self.setPalette(palette)
        self.setAutoFillBackground(True)

        # ── Web view ──────────────────────────────────────────────────────
        self._web = QWebEngineView(self)
        settings = self._web.settings()
        settings.setAttribute(QWebEngineSettings.WebAttribute.JavascriptEnabled, True)
        settings.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, True)
        settings.setAttribute(QWebEngineSettings.WebAttribute.ScrollAnimatorEnabled, False)

        self.setCentralWidget(self._web)
        self._load_page()

    # ── Page loading ──────────────────────────────────────────────────────

    def _load_page(self):
        page    = self.panel_cfg.get("page", "main.html")
        params  = self.panel_cfg.get("params", "")
        url     = f"{self._base_url}/{page}{params}"
        self._web.load(QUrl(url))

    def reload(self):
        self._web.reload()

    # ── Keyboard passthrough for developer convenience ─────────────────────

    def keyPressEvent(self, event):
        if event.key() == Qt.Key.Key_F5:
            self.reload()
        super().keyPressEvent(event)


# ---------------------------------------------------------------------------
# Control overlay
# ---------------------------------------------------------------------------

class ControlOverlay(QMainWindow):
    """
    Floating HUD showing connected screens and panel status.
    Toggle with Escape/F1. Stays on top of all panels.
    """

    def __init__(self, screens: list, panels: list[PanelWindow], port: int):
        super().__init__()
        self.setWindowTitle("Cyberdeck Control")
        self.setWindowFlags(
            Qt.WindowType.WindowStaysOnTopHint |
            Qt.WindowType.Tool
        )
        self.setFixedSize(420, 320)

        # Dark theme
        pal = self.palette()
        pal.setColor(QPalette.ColorRole.Window,     QColor(DARK_BG))
        pal.setColor(QPalette.ColorRole.WindowText, QColor(TEXT_LIGHT))
        self.setPalette(pal)
        self.setAutoFillBackground(True)

        root = QWidget()
        self.setCentralWidget(root)
        layout = QVBoxLayout(root)
        layout.setContentsMargins(16, 12, 16, 12)
        layout.setSpacing(6)

        # Title
        title = QLabel("✈  CYBERDECK AVIATION CONSOLE")
        title.setStyleSheet(f"color:{ACCENT}; font-size:13px; font-weight:bold; letter-spacing:2px;")
        layout.addWidget(title)

        sep = QFrame()
        sep.setFrameShape(QFrame.Shape.HLine)
        sep.setStyleSheet(f"color:{ACCENT_DIM};")
        layout.addWidget(sep)

        # Screens info
        layout.addWidget(self._label(f"Displays detected: {len(screens)}"))
        for i, s in enumerate(screens):
            g = s.geometry()
            layout.addWidget(self._label(
                f"  [{i}] {s.name() or 'Screen '+str(i)}  {g.width()}×{g.height()}  @ ({g.x()},{g.y()})",
                small=True
            ))

        layout.addSpacing(6)

        # Panels info
        layout.addWidget(self._label(f"Panels loaded: {len(panels)}"))
        for p in panels:
            cfg = p.panel_cfg
            layout.addWidget(self._label(
                f"  [{cfg.get('screen',0)}] {p.panel_id}  →  {cfg.get('page','')}",
                small=True
            ))

        layout.addSpacing(6)

        # URL
        layout.addWidget(self._label(f"Server:  http://localhost:{port}"))

        layout.addStretch()

        # Buttons
        btn_row = QHBoxLayout()
        for label, slot in [("Reload All", None), ("Quit  Ctrl+Q", None)]:
            btn = QPushButton(label)
            btn.setStyleSheet(
                f"QPushButton {{ background:{ACCENT_DIM}; color:{ACCENT}; "
                f"border:1px solid {ACCENT}; padding:4px 10px; font-size:11px; }}"
                f"QPushButton:hover {{ background:{ACCENT}; color:#000; }}"
            )
            btn_row.addWidget(btn)
        layout.addLayout(btn_row)

        # Wire reload / quit buttons after creation
        btns = root.findChildren(QPushButton)
        if len(btns) >= 2:
            btns[0].clicked.connect(lambda: [p.reload() for p in panels])
            btns[1].clicked.connect(QApplication.instance().quit)

        # Shortcuts reminder
        hint = QLabel("Esc / F1 — toggle this overlay    F5 — reload panel    Ctrl+Q — quit")
        hint.setStyleSheet(f"color:{ACCENT_DIM}; font-size:9px;")
        hint.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(hint)

        # Centre on primary screen
        if screens:
            sg = screens[0].geometry()
            self.move(
                sg.x() + (sg.width()  - self.width())  // 2,
                sg.y() + (sg.height() - self.height()) // 2,
            )

    def _label(self, text: str, small: bool = False) -> QLabel:
        lbl = QLabel(text)
        size = "10px" if small else "11px"
        color = TEXT_LIGHT if not small else "#8090a0"
        lbl.setStyleSheet(f"color:{color}; font-size:{size}; font-family:monospace;")
        return lbl


# ---------------------------------------------------------------------------
# Main application
# ---------------------------------------------------------------------------

class CyberdeckApp:

    def __init__(self, layout_path: Path, no_server: bool = False, port: int = 5000):
        self.layout_path = layout_path
        self.no_server   = no_server
        self.port        = port
        self._server_proc: Optional[subprocess.Popen] = None
        self._panels: list[PanelWindow] = []
        self._overlay: Optional[ControlOverlay] = None
        self._overlay_visible = False

        # Load layout
        self._layout = self._load_layout()
        self.port = self._layout.get("server_port", port)

    # ── Layout loading ────────────────────────────────────────────────────

    def _load_layout(self) -> dict:
        if not self.layout_path.exists():
            print(f"Warning: {self.layout_path} not found — using built-in defaults")
            return self._default_layout()
        try:
            with open(self.layout_path) as fh:
                return json.load(fh)
        except Exception as e:
            print(f"Warning: could not parse layout.json — {e}")
            return self._default_layout()

    @staticmethod
    def _default_layout() -> dict:
        """Single-screen dev layout — four panels tiled 2×2."""
        return {
            "server_port": 5000,
            "frameless":   False,
            "location":    {"lat": 51.477, "lon": -0.461},
            "panels": [
                {"id": "radar",    "page": "radar.html",    "params": "?range=250", "screen": 0, "x": 0,   "y": 0,   "width": 800, "height": 600},
                {"id": "flight",   "page": "main.html",     "params": "",           "screen": 0, "x": 800, "y": 0,   "width": 600, "height": 600},
                {"id": "vitals",   "page": "vitals.html",   "params": "",           "screen": 0, "x": 0,   "y": 600, "width": 700, "height": 400},
                {"id": "weather",  "page": "weather.html",  "params": "",           "screen": 0, "x": 700, "y": 600, "width": 700, "height": 400},
            ],
        }

    # ── Server lifecycle ──────────────────────────────────────────────────

    def _start_server(self):
        if self.no_server:
            print("  --no-server: skipping server start")
            return

        server_py = HERE / "server.py"
        loc = self._layout.get("location", {})
        lat = loc.get("lat", 51.477)
        lon = loc.get("lon", -0.461)

        cmd = [
            sys.executable, str(server_py),
            "--port",  str(self.port),
            "--lat",   str(lat),
            "--lon",   str(lon),
        ]
        print(f"  Starting server: {' '.join(cmd)}")
        self._server_proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )

        # Give the server a moment to bind
        time.sleep(1.5)
        print(f"  Server PID: {self._server_proc.pid}")

    def _stop_server(self):
        if self._server_proc:
            print("  Stopping server...")
            self._server_proc.terminate()
            try:
                self._server_proc.wait(timeout=4)
            except subprocess.TimeoutExpired:
                self._server_proc.kill()

    # ── Panel creation ────────────────────────────────────────────────────

    def _build_panels(self, qt_screens) -> list[PanelWindow]:
        base_url    = f"http://localhost:{self.port}"
        frameless   = self._layout.get("frameless", False)
        panel_cfgs  = self._layout.get("panels", [])
        panels      = []

        for cfg in panel_cfgs:
            screen_idx = cfg.get("screen", 0)
            if screen_idx < len(qt_screens):
                screen_rect = qt_screens[screen_idx].geometry()
            else:
                screen_rect = qt_screens[0].geometry()

            # Per-panel frameless override
            pf = cfg.get("frameless", frameless)

            pw = PanelWindow(
                panel_cfg=cfg,
                base_url=base_url,
                screen_rect=screen_rect,
                frameless=pf,
            )
            panels.append(pw)

        return panels

    # ── Global shortcuts ──────────────────────────────────────────────────

    def _setup_shortcuts(self, app: QApplication, screens):
        # Quit
        quit_sc = QShortcut(QKeySequence("Ctrl+Q"), self._panels[0] if self._panels else None)
        quit_sc.activated.connect(app.quit)

        # Toggle overlay (Escape)
        esc_sc = QShortcut(QKeySequence("Escape"), self._panels[0] if self._panels else None)
        esc_sc.activated.connect(self._toggle_overlay)

        # Toggle overlay (F1)
        f1_sc = QShortcut(QKeySequence("F1"), self._panels[0] if self._panels else None)
        f1_sc.activated.connect(self._toggle_overlay)

        # Reload all panels (F5 on first panel)
        f5_sc = QShortcut(QKeySequence("F5"), self._panels[0] if self._panels else None)
        f5_sc.activated.connect(lambda: [p.reload() for p in self._panels])

    # ── Overlay ───────────────────────────────────────────────────────────

    def _toggle_overlay(self):
        if not self._overlay:
            return
        self._overlay_visible = not self._overlay_visible
        if self._overlay_visible:
            self._overlay.show()
            self._overlay.raise_()
        else:
            self._overlay.hide()

    # ── Main run loop ─────────────────────────────────────────────────────

    def run(self):
        app = QApplication(sys.argv)
        app.setApplicationName("Cyberdeck Aviation Console")
        app.setQuitOnLastWindowClosed(True)

        # Dark application palette
        pal = app.palette()
        pal.setColor(QPalette.ColorRole.Window,     QColor(DARK_BG))
        pal.setColor(QPalette.ColorRole.WindowText, QColor(TEXT_LIGHT))
        pal.setColor(QPalette.ColorRole.Base,       QColor("#060a0f"))
        pal.setColor(QPalette.ColorRole.Text,       QColor(TEXT_LIGHT))
        app.setPalette(pal)

        screens = app.screens()
        print(f"\n  Displays detected: {len(screens)}")
        for i, s in enumerate(screens):
            g = s.geometry()
            print(f"    [{i}] {s.name() or 'Screen '+str(i)}  {g.width()}×{g.height()}")
        print()

        # Start backend server
        self._start_server()

        # Build panels
        self._panels = self._build_panels(screens)
        for panel in self._panels:
            panel.show()

        # Build control overlay
        self._overlay = ControlOverlay(screens, self._panels, self.port)
        self._overlay.hide()

        # Shortcuts
        if self._panels:
            self._setup_shortcuts(app, screens)

        # Clean shutdown on Ctrl+C in terminal
        signal.signal(signal.SIGINT, lambda *_: app.quit())
        app.aboutToQuit.connect(self._stop_server)

        print("  Cyberdeck running.  Press Esc or F1 for the control overlay.")
        print("  Press Ctrl+Q or close all windows to quit.\n")

        sys.exit(app.exec())


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Cyberdeck Aviation Console")
    parser.add_argument("--layout",    default=str(DEFAULT_LAYOUT), help="Path to layout.json")
    parser.add_argument("--no-server", action="store_true",          help="Don't start server.py (assume it's already running)")
    parser.add_argument("--port",      type=int, default=5000,       help="Override server port")
    args = parser.parse_args()

    print()
    print("=" * 55)
    print("  ✈  CYBERDECK AVIATION CONSOLE")
    print("=" * 55)

    cyberdeck = CyberdeckApp(
        layout_path=Path(args.layout),
        no_server=args.no_server,
        port=args.port,
    )
    cyberdeck.run()


if __name__ == "__main__":
    main()
