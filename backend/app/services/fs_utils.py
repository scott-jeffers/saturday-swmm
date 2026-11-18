"""Small filesystem helpers shared by services."""

from __future__ import annotations

import os
import tempfile
import time
from pathlib import Path


def atomic_write_text(path: Path, text: str, *, encoding: str = "utf-8") -> None:
    """Write ``text`` to ``path`` so readers never see a half-written file.

    Writes to a temp file in the same folder, flushes it to disk, then swaps it
    into place with ``os.replace``. On Windows the swap can briefly fail while
    another process (an editor, antivirus, the engine) holds the file open, so
    it is retried for about a second before giving up.

    Text is written exactly as given (no newline translation), so callers keep
    the file's existing line endings.
    """
    path = Path(path)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding=encoding, newline="") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        last_exc: OSError | None = None
        for _ in range(20):
            try:
                os.replace(tmp, path)
                return
            except PermissionError as exc:  # pragma: no cover - Windows file locks
                last_exc = exc
                time.sleep(0.05)
        assert last_exc is not None
        raise last_exc
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass
