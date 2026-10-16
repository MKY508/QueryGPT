"""Admission shared by CSV and workbook preview workers in this process."""

from pathlib import Path
from threading import BoundedSemaphore

PREVIEW_ROWS = 12
PREVIEW_COLUMNS = 40
PREVIEW_CELL_CHARACTERS = 250
_READERS = BoundedSemaphore(2)


def _stamp(path: Path) -> tuple[int, int, int, int]:
    stat = path.stat()
    return stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns
