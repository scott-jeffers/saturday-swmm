from __future__ import annotations

import platform
import subprocess
import sys
from pathlib import Path
from typing import Optional, Sequence


def pick_folder(
    title: str = "Select project folder",
    *,
    allow_new_folder: bool = True,
) -> Optional[str]:
    """
    Open a native OS folder picker on the local machine.
    Returns an absolute path string, or None if the user cancels / picker unavailable.
    """
    _ = allow_new_folder
    system = platform.system()

    for attempt in (
        _pick_folder_python_process,
        _pick_folder_windows if system == "Windows" else None,
        _pick_folder_macos if system == "Darwin" else None,
        _pick_folder_tk_inline,
    ):
        if attempt is None:
            continue
        try:
            if attempt is _pick_folder_windows:
                result = attempt(title, allow_new_folder=allow_new_folder)  # type: ignore[misc]
            else:
                result = attempt(title)  # type: ignore[misc]
        except Exception as exc:
            print(f"[folder_dialog] {attempt.__name__} error: {exc}", file=sys.stderr)
            continue

        if result is None:
            continue
        return result or None

    return None


def pick_file(
    title: str = "Select file",
    *,
    filetypes: Sequence[str] | None = None,
) -> Optional[str]:
    """
    Open a native OS file picker.
    filetypes: glob patterns like ['*.tif', '*.tiff'] or ['*.zip'].
    Returns absolute path or None if cancelled / unavailable.
    """
    patterns = list(filetypes) if filetypes else ["*.*"]
    system = platform.system()

    attempts = [
        lambda t: _pick_file_python_process(t, patterns),
        (lambda t: _pick_file_windows(t, patterns)) if system == "Windows" else None,
        (lambda t: _pick_file_macos(t, patterns)) if system == "Darwin" else None,
        lambda t: _pick_file_tk_inline(t, patterns),
    ]

    for attempt in attempts:
        if attempt is None:
            continue
        try:
            result = attempt(title)
        except Exception as exc:
            print(f"[folder_dialog] pick_file error: {exc}", file=sys.stderr)
            continue
        if result is None:
            continue
        return result or None
    return None


def _pick_folder_python_process(title: str) -> Optional[str]:
    script = Path(__file__).with_name("pick_folder_app.py")
    if not script.is_file():
        return None

    kwargs: dict = {
        "capture_output": True,
        "text": True,
        "timeout": 600,
        "check": False,
    }
    if platform.system() == "Windows":
        kwargs["creationflags"] = subprocess.CREATE_NEW_CONSOLE  # type: ignore[attr-defined]

    try:
        completed = subprocess.run(
            [sys.executable, str(script), "--title", title],
            **kwargs,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        print(f"[folder_dialog] python picker failed: {exc}", file=sys.stderr)
        return None

    if completed.returncode == 2:
        print(
            f"[folder_dialog] tkinter missing: {(completed.stderr or '').strip()}",
            file=sys.stderr,
        )
        return None

    if completed.returncode != 0:
        print(
            f"[folder_dialog] python picker exit {completed.returncode}: "
            f"{(completed.stderr or '').strip()}",
            file=sys.stderr,
        )
        return (completed.stdout or "").strip()

    return (completed.stdout or "").strip()


def _pick_file_python_process(title: str, patterns: list[str]) -> Optional[str]:
    script = Path(__file__).with_name("pick_file_app.py")
    if not script.is_file():
        return None
    kwargs: dict = {
        "capture_output": True,
        "text": True,
        "timeout": 600,
        "check": False,
    }
    if platform.system() == "Windows":
        kwargs["creationflags"] = subprocess.CREATE_NEW_CONSOLE  # type: ignore[attr-defined]
    cmd = [sys.executable, str(script), "--title", title, "--patterns", *patterns]
    try:
        completed = subprocess.run(cmd, **kwargs)
    except (OSError, subprocess.TimeoutExpired) as exc:
        print(f"[folder_dialog] file picker failed: {exc}", file=sys.stderr)
        return None
    if completed.returncode not in (0, 1):
        return None
    return (completed.stdout or "").strip()


def _pick_folder_windows(title: str, *, allow_new_folder: bool) -> Optional[str]:
    safe_title = title.replace("'", "''")
    show_new = "$true" if allow_new_folder else "$false"
    script = f"""
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '{safe_title}'
$dialog.ShowNewFolderButton = {show_new}
$dialog.SelectedPath = [Environment]::GetFolderPath('MyDocuments')
$form = New-Object System.Windows.Forms.Form
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.Opacity = 0
$form.Show()
$result = $dialog.ShowDialog($form)
$form.Close()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {{
  [Console]::Out.Write($dialog.SelectedPath)
}}
"""
    try:
        completed = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-STA",
                "-Command",
                script,
            ],
            capture_output=True,
            text=True,
            timeout=600,
            check=False,
            creationflags=subprocess.CREATE_NEW_CONSOLE,  # type: ignore[attr-defined]
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        print(f"[folder_dialog] powershell failed: {exc}", file=sys.stderr)
        return None

    if completed.returncode != 0 and not (completed.stdout or "").strip():
        err = (completed.stderr or "").strip()
        if err:
            print(f"[folder_dialog] powershell: {err}", file=sys.stderr)
        return None

    return (completed.stdout or "").strip()


def _pick_file_windows(title: str, patterns: list[str]) -> Optional[str]:
    safe_title = title.replace("'", "''")
    joined = ";".join(patterns)
    filter_str = f"Selected files|{joined}|All files|*.*".replace("'", "''")
    script = f"""
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = '{safe_title}'
$dialog.Filter = '{filter_str}'
$dialog.Multiselect = $false
$form = New-Object System.Windows.Forms.Form
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.Opacity = 0
$form.Show()
$result = $dialog.ShowDialog($form)
$form.Close()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {{
  [Console]::Out.Write($dialog.FileName)
}}
"""
    try:
        completed = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-STA",
                "-Command",
                script,
            ],
            capture_output=True,
            text=True,
            timeout=600,
            check=False,
            creationflags=subprocess.CREATE_NEW_CONSOLE,  # type: ignore[attr-defined]
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        print(f"[folder_dialog] file powershell failed: {exc}", file=sys.stderr)
        return None
    if completed.returncode != 0 and not (completed.stdout or "").strip():
        return None
    return (completed.stdout or "").strip()


def _pick_folder_macos(title: str) -> Optional[str]:
    safe_title = title.replace("\\", "\\\\").replace('"', '\\"')
    script = f'POSIX path of (choose folder with prompt "{safe_title}")'
    try:
        completed = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
            timeout=600,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if completed.returncode != 0:
        return ""
    return (completed.stdout or "").strip()


def _pick_file_macos(title: str, patterns: list[str]) -> Optional[str]:
    safe_title = title.replace("\\", "\\\\").replace('"', '\\"')
    exts = [p[2:] for p in patterns if p.startswith("*.") and p != "*.*"]
    if exts:
        of_type = ", ".join(f'"{e}"' for e in exts)
        type_clause = f" of type {{{of_type}}}"
    else:
        type_clause = ""
    script = f'POSIX path of (choose file with prompt "{safe_title}"{type_clause})'
    try:
        completed = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
            timeout=600,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if completed.returncode != 0:
        return ""
    return (completed.stdout or "").strip()


def _pick_folder_tk_inline(title: str) -> Optional[str]:
    try:
        import tkinter as tk
        from tkinter import filedialog
    except ImportError:
        return None

    root = tk.Tk()
    root.withdraw()
    try:
        root.attributes("-topmost", True)
    except tk.TclError:
        pass
    try:
        path = filedialog.askdirectory(title=title, mustexist=True)
    finally:
        try:
            root.destroy()
        except tk.TclError:
            pass
    return path or ""


def _pick_file_tk_inline(title: str, patterns: list[str]) -> Optional[str]:
    try:
        import tkinter as tk
        from tkinter import filedialog
    except ImportError:
        return None

    root = tk.Tk()
    root.withdraw()
    try:
        root.attributes("-topmost", True)
    except tk.TclError:
        pass
    filetypes = [("Selected", " ".join(patterns)), ("All files", "*.*")]
    try:
        path = filedialog.askopenfilename(title=title, filetypes=filetypes)
    finally:
        try:
            root.destroy()
        except tk.TclError:
            pass
    return path or ""
