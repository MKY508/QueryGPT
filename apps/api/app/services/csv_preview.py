"""Raw CSV records using exactly the preparation reader's dialect and limits."""

from contextlib import closing
from itertools import islice
from pathlib import Path
from typing import Any

from app.core.config import settings
from app.services.csv_preflight import _encoding, _records
from app.services.data_preflight import fingerprint_file
from app.services.file_preview import (
    _READERS,
    PREVIEW_CELL_CHARACTERS,
    PREVIEW_COLUMNS,
    PREVIEW_ROWS,
    _stamp,
)


def preview_csv(
    path: Path, delimiter: str = ",", encoding: str | None = None, start_row: int = 1
) -> dict[str, Any]:
    if not _READERS.acquire(blocking=False):
        raise ValueError("File preview is busy")
    try:
        before = _stamp(path)
        if (
            path.suffix.casefold() != ".csv"
            or not path.is_file()
            or before[2] > settings.FILE_UPLOAD_MAX_BYTES
        ):
            raise ValueError("CSV is unavailable or too large")
        if type(start_row) is not int or not 1 <= start_row <= 1_000_000:
            raise ValueError("Unsupported preview row")
        fingerprint = fingerprint_file(path)
        actual_encoding = _encoding(path, encoding)
        result = dict(
            input_fingerprint=fingerprint,
            delimiter=delimiter,
            encoding=actual_encoding,
            start_row=start_row,
            rows=[],
            nonempty_rows=[],
            has_more_rows=False,
            truncated_columns=False,
            truncated_cells=False,
        )
        with closing(_records(path, actual_encoding, delimiter)) as records:
            for index, values in enumerate(
                islice(records, start_row - 1, start_row + PREVIEW_ROWS)
            ):
                if index == PREVIEW_ROWS:
                    result["has_more_rows"] = True
                    break
                if any(value != "" for value in values):
                    result["nonempty_rows"].append(start_row + index)
                result["truncated_columns"] |= any(
                    value != "" for value in values[PREVIEW_COLUMNS:]
                )
                row = []
                for value in values[:PREVIEW_COLUMNS]:
                    if len(value) > PREVIEW_CELL_CHARACTERS:
                        result["truncated_cells"] = True
                        value = value[:PREVIEW_CELL_CHARACTERS] + "…"
                    row.append(value if value != "" else None)
                result["rows"].append(row)
        if _stamp(path) != before:
            raise ValueError("CSV changed while reading")
        return result
    finally:
        _READERS.release()
