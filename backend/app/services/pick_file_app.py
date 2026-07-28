"""Standalone file picker process (mirrors pick_folder_app.py)."""
from __future__ import annotations

import argparse
import sys


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--title", default="Select file")
    parser.add_argument("--patterns", nargs="*", default=["*.*"])
    args = parser.parse_args()
    try:
        import tkinter as tk
        from tkinter import filedialog
    except ImportError:
        print("tkinter not available", file=sys.stderr)
        return 2

    root = tk.Tk()
    root.withdraw()
    try:
        root.attributes("-topmost", True)
    except tk.TclError:
        pass
    patterns = args.patterns or ["*.*"]
    filetypes = [("Selected", " ".join(patterns)), ("All files", "*.*")]
    try:
        path = filedialog.askopenfilename(title=args.title, filetypes=filetypes)
    finally:
        try:
            root.destroy()
        except tk.TclError:
            pass
    if path:
        sys.stdout.write(path)
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
