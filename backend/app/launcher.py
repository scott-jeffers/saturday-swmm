"""Start Saturday-SWMM and open it in the browser.

Used by the portable release (``Saturday-SWMM.cmd``) and available from a
source checkout with ``python -m app.launcher`` (after ``npm run build``).

* Serves the API and the web UI on one local port (default 8765).
* If Saturday-SWMM is already running, just opens the browser to it.
* Listens on 127.0.0.1 only; nothing is reachable from other machines.
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path
from typing import Optional

DEFAULT_PORT = 8765
_server = None  # uvicorn.Server, set in main()


def request_shutdown() -> bool:
    """Ask the running server to exit (used by the UI's Quit button)."""
    if _server is None:
        return False
    _server.should_exit = True
    return True


def _probe(port: int) -> Optional[dict]:
    """Return /api/app info if a Saturday-SWMM server answers on ``port``."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/app", timeout=1.5) as r:
            data = json.loads(r.read().decode("utf-8"))
        return data if data.get("name") == "Saturday-SWMM" else None
    except Exception:
        return None


def _port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def _pick_port(preferred: int) -> int:
    for p in [preferred, *range(preferred + 1, preferred + 20)]:
        if _port_free(p):
            return p
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def open_browser(url: str) -> bool:
    """Open ``url`` in the default browser, with OS fallbacks.

    ``webbrowser`` can return False without opening anything (no registered
    browser in a minimal Python, odd PATH); Windows' shell open is the most
    reliable route there.
    """
    try:
        if webbrowser.open(url, new=2):
            return True
    except Exception:
        pass
    try:
        if sys.platform.startswith("win"):
            os.startfile(url)  # type: ignore[attr-defined]
            return True
        import subprocess

        opener = "open" if sys.platform == "darwin" else "xdg-open"
        subprocess.Popen([opener, url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except Exception:
        return False


def _open_when_ready(url: str, port: int, timeout: float = 90.0) -> None:
    t0 = time.time()
    while time.time() - t0 < timeout:
        if _probe(port):
            if open_browser(url):
                print(f"Opened {url} in your browser.", flush=True)
            else:
                print(f"Couldn't open a browser automatically. Open {url} yourself.", flush=True)
            return
        time.sleep(0.25)
    print(f"Saturday-SWMM did not start within {timeout:.0f}s; check the messages above.", flush=True)


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="saturday-swmm", description=__doc__.splitlines()[0])
    ap.add_argument("--port", type=int, default=int(os.environ.get("SATURDAY_SWMM_PORT", DEFAULT_PORT)))
    ap.add_argument("--no-browser", action="store_true", help="don't open a browser window")
    ap.add_argument("--wait-for-port", action="store_true", help=argparse.SUPPRESS)  # used by in-app restart
    args = ap.parse_args(argv)

    if args.wait_for_port:
        # Restarting from the app: the old server is shutting down on this port.
        for _ in range(120):
            if _port_free(args.port):
                break
            time.sleep(0.25)

    existing = None if args.wait_for_port else _probe(args.port)
    if existing:
        url = f"http://127.0.0.1:{args.port}/"
        print(f"Saturday-SWMM {existing.get('version')} is already running at {url}")
        if not args.no_browser:
            open_browser(url)
        return 0

    port = _pick_port(args.port)
    url = f"http://127.0.0.1:{port}/"

    # Make `import app` work when started from the portable folder.
    root = Path(__file__).resolve().parents[1]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))

    import uvicorn

    from app.ui_static import find_ui_dir
    from app.version import APP_VERSION

    if find_ui_dir() is None:
        print(
            "Web UI not found. In a source checkout run `npm run build` in frontend/ first,\n"
            "or use start-dev.ps1 for the Vite dev server."
        )

    print("=" * 64)
    print(f"  Saturday-SWMM {APP_VERSION}")
    print(f"  Open {url} in your browser")
    print("  Keep this window open while you work. Close it (or use Quit")
    print("  in the app) to stop Saturday-SWMM.")
    print("=" * 64, flush=True)

    if not args.no_browser:
        threading.Thread(target=_open_when_ready, args=(url, port), daemon=True).start()

    global _server
    config = uvicorn.Config(
        "app.main:app",
        host="127.0.0.1",
        port=port,
        log_level="warning",
        access_log=False,
    )
    _server = uvicorn.Server(config)
    # Under `python -m app.launcher` this module is __main__; the API imports
    # it as app.launcher, so register the server there too for Quit.
    import app.launcher as registered

    registered._server = _server
    _server.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
