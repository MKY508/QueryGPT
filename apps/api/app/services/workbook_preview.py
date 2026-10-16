"""Workbook navigation before preparation, inspired by Power Query's Navigator."""

from contextlib import ExitStack, closing
from datetime import date, datetime
from itertools import islice, zip_longest
from pathlib import Path
from typing import Any

import openpyxl
import xlrd

from app.core.config import settings
from app.services.data_preflight import fingerprint_file
from app.services.file_preview import (
    _READERS,
    PREVIEW_CELL_CHARACTERS,
    PREVIEW_COLUMNS,
    PREVIEW_ROWS,
    _stamp,
)
from app.services.xlsx_preflight import _MAX_SHEETS, _check_archive, _rows, _text


def preview_workbook(
    path: Path, selected_sheet: str | None = None, start_row: int = 1
) -> dict[str, Any]:
    # Aborting a browser read cannot stop its parser thread. Bound actual live
    # readers, not just HTTP requests, and release only when the worker exits.
    if not _READERS.acquire(blocking=False):
        raise ValueError("Workbook preview is busy")
    try:
        if type(start_row) is not int or not 1 <= start_row <= 1_000_000:
            raise ValueError("Unsupported preview row")
        return _preview_workbook(path, selected_sheet, start_row)
    finally:
        _READERS.release()


def _preview_workbook(path: Path, selected_sheet: str | None, start_row: int) -> dict[str, Any]:
    """Return raw top rows, without inferring a table, cleaning or executing formulas."""
    before = _stamp(path)
    if not path.is_file() or before[2] > settings.FILE_UPLOAD_MAX_BYTES:
        raise ValueError("Workbook is unavailable or too large")
    fingerprint = fingerprint_file(path)
    result: dict[str, Any] = {
        "input_fingerprint": fingerprint,
        "sheets": [],
        "selected_sheet": selected_sheet,
        "start_row": start_row,
        "rows": [],
        "nonempty_rows": [],
        "has_more_rows": False,
        "truncated_columns": False,
        "truncated_cells": False,
        "missing_formula_results": 0,
    }

    def append(values: list[str | None]) -> None:
        if any(value is not None for value in values):
            result["nonempty_rows"].append(start_row + len(result["rows"]))
        result["truncated_columns"] |= any(value is not None for value in values[PREVIEW_COLUMNS:])
        row = []
        for value in values[:PREVIEW_COLUMNS]:
            if value is not None and len(value) > PREVIEW_CELL_CHARACTERS:
                result["truncated_cells"] = True
                value = value[:PREVIEW_CELL_CHARACTERS] + "…"
            row.append(value)
        result["rows"].append(row)

    with ExitStack() as stack:
        if path.suffix.casefold() == ".xlsx":
            _check_archive(path)
            book = openpyxl.load_workbook(
                stack.enter_context(path.open("rb")),
                read_only=True,
                data_only=True,
                keep_links=False,
            )
            stack.callback(book.close)
            sheets = book.worksheets
            if (
                not sheets
                or len(sheets) > _MAX_SHEETS
                or any(len(sheet.title) > 128 for sheet in sheets)
            ):
                raise ValueError("Unsupported worksheet count")
            result["sheets"] = [
                {"name": sheet.title, "hidden": sheet.sheet_state != "visible"} for sheet in sheets
            ]
            if selected_sheet is not None:
                if selected_sheet not in {sheet.title for sheet in sheets}:
                    raise ValueError("Worksheet is no longer available")
                formulas = openpyxl.load_workbook(
                    stack.enter_context(path.open("rb")),
                    read_only=True,
                    data_only=False,
                    keep_links=False,
                )
                stack.callback(formulas.close)
                with (
                    closing(_rows(book[selected_sheet])) as cached,
                    closing(_rows(formulas[selected_sheet])) as raw,
                ):
                    for index, (values, expressions) in enumerate(
                        islice(zip_longest(cached, raw), start_row - 1, start_row + PREVIEW_ROWS)
                    ):
                        if index == PREVIEW_ROWS:
                            result["has_more_rows"] = True
                            break
                        if values is None or expressions is None:
                            raise ValueError("Workbook changed while reading")
                        cells = []
                        for cell, expression in zip_longest(values, expressions):
                            value = cell.value if cell else None
                            if expression and expression.data_type == "f" and value is None:
                                result["missing_formula_results"] += 1
                                value = expression.value
                            cells.append(
                                _text(value, True, cell.number_format if cell else "General")
                            )
                        append(cells)
        elif path.suffix.casefold() == ".xls":
            # xlrd defers other sheets but still materializes the chosen legacy
            # sheet. This has a file admission cap, not a streaming/RSS guarantee.
            book = xlrd.open_workbook(str(path), on_demand=True, ragged_rows=True)
            stack.callback(book.release_resources)
            names = book.sheet_names()
            if not names or len(names) > _MAX_SHEETS or any(len(name) > 128 for name in names):
                raise ValueError("Unsupported worksheet count")
            result["sheets"] = [{"name": name, "hidden": None} for name in names]
            if selected_sheet is not None:
                if selected_sheet not in names:
                    raise ValueError("Worksheet is no longer available")
                sheet = book.sheet_by_name(selected_sheet)
                result["sheets"][names.index(selected_sheet)]["hidden"] = bool(sheet.visibility)
                result["has_more_rows"] = sheet.nrows >= start_row + PREVIEW_ROWS
                for row_index in range(
                    start_row - 1, min(start_row - 1 + PREVIEW_ROWS, sheet.nrows)
                ):
                    cells = []
                    for cell in sheet.row(row_index):
                        value = cell.value
                        if cell.ctype == xlrd.XL_CELL_DATE:
                            value = xlrd.xldate_as_datetime(value, book.datemode)
                        elif cell.ctype == xlrd.XL_CELL_BOOLEAN:
                            value = bool(value)
                        elif cell.ctype == xlrd.XL_CELL_ERROR:
                            value = xlrd.error_text_from_code.get(value, "#ERROR!")
                        elif cell.ctype in {xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK}:
                            value = None
                        if isinstance(value, (date, datetime)):
                            value = value.isoformat()
                        cells.append(_text(value, True, "General"))
                    append(cells)
        else:
            raise ValueError("Not an Excel workbook")
    if _stamp(path) != before:
        raise ValueError("Workbook changed while reading")
    return result
