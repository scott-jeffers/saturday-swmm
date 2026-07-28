from __future__ import annotations

"""
Standalone folder picker process.

Prints the selected absolute path to stdout (empty if cancelled).
Designed to be launched as its own process so the dialog can show
even when the FastAPI worker cannot own a GUI message loop.
"""

import argparse
import sys


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--title", default="Select project folder")
    args = parser.parse_args()

    try:
        import tkinter as tk
        from tkinter import filedialog
    except ImportError:
        print("tkinter is not available", file=sys.stderr)
        return 2

    root = tk.Tk()
    root.withdraw()
    try:
        root.attributes("-topmost", True)
    except tk.TclError:
        pass
    root.update_idletasks()
    root.lift()
    try:
        root.focus_force()
    except tk.TclError:
        pass

    path = filedialog.askdirectory(title=args.title, mustexist=True)
    try:
        root.destroy()
    except tk.TclError:
        pass

    if path:
        sys.stdout.write(path)
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
