"""Streaming JSON cells, disk-backed schema discovery, then bounded Arrow batches.

ijson owns JSON syntax and exact number parsing. SQLite aligns sparse/columnar
records without holding a document, column, or complete row directory in Python.
"""

from __future__ import annotations

import sqlite3
from contextlib import closing, suppress
from dataclasses import dataclass, field
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from typing import Any, BinaryIO

import ijson
import pyarrow as pa
import pyarrow.parquet as pq

from app.services.data_preflight import PreflightInputError
from app.services.file_formats import JSON_LINES_FORMATS
from app.services.tabular_preflight import (
    _BATCH_BYTES,
    _BATCH_CELLS,
    _BATCH_ROWS,
    _MAX_COLUMNS,
    StagedTable,
    run_staged_preflight,
)

_READ_BYTES = 64 * 1024
_MAX_TOKEN_BYTES = 4 * 1024 * 1024
_MAX_TEXT_BYTES = 1024 * 1024
_MAX_ROW_BYTES = 4 * 1024 * 1024
_MAX_STAGE_BYTES = 2 * 1024 * 1024 * 1024
_MAX_LINE_BYTES = 8 * 1024 * 1024
_SCALARS = frozenset({"string", "number", "boolean", "null"})


def _structure() -> PreflightInputError:
    return PreflightInputError(
        "请将 JSON 导出为明细记录或按列组织的表格；单元格中不要包含嵌套对象或数组",
        code="json_structure_unsupported",
    )


def _size() -> PreflightInputError:
    return PreflightInputError(
        "这份 JSON 的字段、单条记录或整理数据过大，请拆分后再导入",
        code="json_size_limit",
    )


class _BoundedReader:
    def __init__(self, source: BinaryIO):
        self.source = source
        self.since_event = 0

    def read(self, size: int = -1) -> bytes:
        if size == 0:
            return b""
        data = self.source.read(min(size, _READ_BYTES) if size > 0 else _READ_BYTES)
        self.since_event += len(data)
        # Limits unfinished tokens (and excessive inter-token whitespace) before
        # the parser can accumulate arbitrarily many input chunks.
        if self.since_event > _MAX_TOKEN_BYTES + _READ_BYTES:
            raise _size()
        return data


@dataclass
class _Column:
    kinds: set[str] = field(default_factory=set)
    integer_digits: int = 0
    scale: int = 0
    all_int64: bool = True

    def observe(self, kind: str, value: Any) -> None:
        if kind == "0":
            return
        self.kinds.add(kind)
        if kind == "n":
            number = Decimal(value) if isinstance(value, int) else value
            digits, exponent = number.as_tuple().digits, number.as_tuple().exponent
            self.integer_digits = max(self.integer_digits, len(digits) + exponent, 0)
            self.scale = max(self.scale, -exponent)
            self.all_int64 &= isinstance(value, int) and -(2**63) <= value < 2**63

    def dtype(self) -> pa.DataType:
        if self.kinds == {"b"}:
            return pa.bool_()
        if self.kinds == {"n"}:
            if self.all_int64:
                return pa.int64()
            precision = max(1, self.integer_digits + self.scale)
            if precision <= 38:
                return pa.decimal128(precision, self.scale)
        # Includes all-null, mixed-type and >38-digit numeric columns. The shared
        # plane must not implicitly convert these literal strings back to floats.
        return pa.string()


class _Cells:
    def __init__(self, db: sqlite3.Connection, events):
        self.db = db
        self.events = iter(events)
        self.columns: dict[str, _Column] = {}
        self.column_ids: dict[str, int] = {}
        self.record_count = 0
        self.layout = "records"

    def take(self):
        try:
            return next(self.events)
        except StopIteration as exc:
            raise PreflightInputError(
                "JSON 文件不完整，请重新导出后再导入", code="json_unreadable"
            ) from exc

    def column(self, name: str) -> int:
        if "\0" in name or len(name.encode("utf-8")) > 1024:
            raise _size()
        if name not in self.columns:
            if len(self.columns) >= _MAX_COLUMNS:
                raise _size()
            self.column_ids[name] = len(self.columns)
            self.columns[name] = _Column()
        return self.column_ids[name]

    def row(self, key: str) -> int:
        if len(key.encode("utf-8")) > 1024:
            raise _size()
        self.db.execute("INSERT OR IGNORE INTO rows(row_key) VALUES (?)", (key,))
        return self.db.execute("SELECT id FROM rows WHERE row_key = ?", (key,)).fetchone()[0]

    def cell(self, row: int, name: str, token) -> None:
        event, value = token
        if event not in _SCALARS:
            raise _structure()
        column = self.column(name)
        kind = {"string": "s", "number": "n", "boolean": "b", "null": "0"}[event]
        if kind == "n" and isinstance(value, Decimal) and not value.is_finite():
            raise _structure()
        try:
            text = (
                None
                if value is None
                else (("true" if value else "false") if kind == "b" else str(value))
            )
        except ValueError as exc:
            raise _size() from exc
        size = len(text.encode("utf-8")) if text is not None else 0
        if size > _MAX_TEXT_BYTES:
            raise _size()
        row_size = self.db.execute(
            "UPDATE rows SET size = size + ? WHERE id = ? RETURNING size", (size, row)
        ).fetchone()[0]
        if row_size > _MAX_ROW_BYTES:
            raise _size()
        # Reject duplicate JSON member/index keys instead of silently taking last.
        self.db.execute("INSERT INTO cells VALUES (?, ?, ?, ?)", (row, column, text, kind))
        self.columns[name].observe(kind, value)

    def record(self, start: str, first=None) -> None:
        row = self.row(str(self.record_count))
        self.record_count += 1
        event, value = first if first is not None else self.take()
        index = 0
        end = "end_map" if start == "start_map" else "end_array"
        while event != end:
            if start == "start_map":
                if event != "map_key":
                    raise _structure()
                name, token = value, self.take()
            else:
                name, token = f"column_{index + 1}", (event, value)
            self.cell(row, name, token)
            index += 1
            event, value = self.take()

    def columnar(self, name: str, start: str) -> None:
        self.layout = "columns"
        seen = set()
        while True:
            if name in seen:
                raise _structure()
            seen.add(name)
            self.column(name)
            event, value = self.take()
            index = 0
            end = "end_map" if start == "start_map" else "end_array"
            while event != end:
                if start == "start_map":
                    if event != "map_key":
                        raise _structure()
                    key, token = value, self.take()
                else:
                    key, token = str(index), (event, value)
                self.cell(self.row(key), name, token)
                index += 1
                event, value = self.take()
            event, value = self.take()
            if event == "end_map":
                return
            if event != "map_key":
                raise _structure()
            name = value
            event, _ = self.take()
            # Mixing explicit index keys and positional arrays is ambiguous.
            if event != start:
                raise _structure()

    def read(self) -> None:
        event, _ = self.take()
        if event == "start_array":
            event, _ = self.take()
            row_type = event
            while event != "end_array":
                if event not in {"start_map", "start_array"} or event != row_type:
                    raise _structure()
                self.record(event)
                event, _ = self.take()
        elif event == "start_map":
            first = self.take()
            if first[0] == "end_map":
                self.record("start_map", first)
            elif first[0] == "map_key":
                token = self.take()
                if token[0] in {"start_map", "start_array"}:
                    self.columnar(first[1], token[0])
                else:
                    row = self.row("0")
                    self.record_count = 1
                    self.cell(row, first[1], token)
                    event, name = self.take()
                    while event != "end_map":
                        if event != "map_key":
                            raise _structure()
                        self.cell(row, name, self.take())
                        event, name = self.take()
            else:
                raise _structure()
            # A sequence of top-level flat objects also covers newline-delimited
            # exports. Arrays/column-oriented objects cannot be concatenated.
            for event, _ in self.events:
                if event != "start_map" or self.layout == "columns":
                    raise _structure()
                self.layout = "record_sequence"
                self.record(event)
            return
        else:
            raise _structure()
        if next(self.events, None) is not None:
            raise _structure()


def _events(source, *, accept_bom: bool = True, multiple_values: bool = True):
    # BOM is common in Windows exports; all remaining bytes must be valid UTF-8.
    if source.read(3) == b"\xef\xbb\xbf":
        if not accept_bom:
            raise PreflightInputError(
                "逐行 JSON 文件不能包含 BOM，请重新导出为 UTF-8", code="json_lines_invalid"
            )
    else:
        source.seek(0)
    reader = _BoundedReader(source)
    pending = ijson.sendable_list()
    parser = ijson.basic_parse_coro(
        pending, use_float=False, multiple_values=multiple_values, allow_comments=False
    )
    closed = False
    try:
        while chunk := reader.read(_READ_BYTES):
            # The C pull iterator can return queued events with an outstanding
            # Python numeric-conversion error. Validate the entire push boundary
            # before any event is handed to SQLite or another consumer.
            parser.send(chunk)
            if pending:
                reader.since_event = 0
                yield from pending
                pending.clear()
        closed = True
        parser.close()  # EOF validation must succeed before the last events escape.
        yield from pending
    except PreflightInputError:
        raise
    except (ValueError, ArithmeticError, SystemError) as exc:
        # Backend/Python limits on enormous numeric literals are input failures,
        # not a reason to disable interpreter limits or accept rounded floats.
        raise PreflightInputError(
            "无法完整读取这份 JSON，请检查格式和数值后重新导入", code="json_unreadable"
        ) from exc
    finally:
        if not closed:
            # On an existing parse/consumer failure, incomplete EOF cleanup must
            # not hide that failure. Normal EOF errors are not suppressed above.
            with suppress(Exception):
                parser.close()
        pending.clear()


def _read_json_lines(source: BinaryIO, cells: _Cells) -> None:
    """One bounded physical line is one flat record; never skip invalid lines."""
    cells.layout = "json_lines"
    line_number = 0
    row_type = None
    while raw := source.readline(_MAX_LINE_BYTES + 1):
        line_number += 1
        try:
            if len(raw) > _MAX_LINE_BYTES:
                raise _size()
            # Both LF and CRLF are delimiters. A bare CR is not a record boundary.
            content = raw[:-1] if raw.endswith(b"\n") else raw
            if raw.endswith(b"\r\n"):
                content = content[:-1]
            if not content.strip(b" \t") or b"\r" in content:
                raise PreflightInputError(
                    "请确保逐行 JSON 的每一行都是一条完整记录，不要包含空行",
                    code="json_lines_invalid",
                )
            with closing(
                _events(BytesIO(content), accept_bom=False, multiple_values=False)
            ) as events:
                cells.events = iter(events)
                event, _ = cells.take()
                if event not in {"start_map", "start_array"} or (row_type and event != row_type):
                    raise _structure()
                row_type = event
                cells.record(event)
                if next(events, None) is not None:
                    raise _structure()
        except PreflightInputError as exc:
            exc.presentation_facts["line"] = line_number
            raise
        except sqlite3.IntegrityError as exc:
            raise PreflightInputError(
                "这一行包含重复字段，请检查后重新导入",
                code="json_structure_unsupported",
                line=line_number,
            ) from exc
        except (ijson.JSONError, UnicodeError) as exc:
            raise PreflightInputError(
                "这一行不是一条完整记录，请检查后重新导入",
                code="json_lines_invalid",
                line=line_number,
            ) from exc


def _write_batches(db, staged, columns, types, ordinal, identity):
    schema = pa.schema(
        [
            *[pa.field(name, dtype) for name, dtype in zip(columns, types, strict=True)],
            pa.field(ordinal, pa.int64()),
            pa.field(identity, pa.string()),
        ]
    )
    row_limit = max(1, min(_BATCH_ROWS, _BATCH_CELLS // len(columns)))
    values = [[] for _ in schema]
    batch_bytes = 0
    count = 0

    def flush(writer):
        writer.write_batch(
            pa.RecordBatch.from_arrays(
                [
                    pa.array(items, type=dtype)
                    for items, dtype in zip(values, schema.types, strict=True)
                ],
                schema=schema,
            )
        )
        for items in values:
            items.clear()

    with pq.ParquetWriter(staged, schema, compression="zstd") as writer:
        cursor = db.execute(
            "SELECT rows.id, cells.c, cells.v, cells.kind, rows.size FROM rows "
            "LEFT JOIN cells ON rows.id = cells.r ORDER BY rows.id, cells.c"
        )
        current = next(cursor, None)
        while current is not None:
            row_id, _, _, _, row_bytes = current
            if values[-1] and (
                len(values[-1]) >= row_limit or batch_bytes + row_bytes > _BATCH_BYTES
            ):
                flush(writer)
                batch_bytes = 0
            row = [None] * len(columns)
            kinds = ["0"] * len(columns)
            while current is not None and current[0] == row_id:
                _, column, text, kind, _ = current
                if column is not None:
                    dtype = types[column]
                    row[column] = (
                        None
                        if text is None
                        else (
                            int(text)
                            if pa.types.is_integer(dtype)
                            else Decimal(text)
                            if pa.types.is_decimal(dtype)
                            else text == "true"
                            if pa.types.is_boolean(dtype)
                            else text
                        )
                    )
                    kinds[column] = kind
                current = next(cursor, None)
            for items, value in zip(values, [*row, count, "".join(kinds)], strict=True):
                items.append(value)
            count += 1
            batch_bytes += row_bytes
        if values[-1]:
            flush(writer)
    return count, row_limit


def _stage_json(source_path: Path, staged: Path, ordinal: str, steps) -> StagedTable:
    from app.services import data_preflight as common

    with closing(sqlite3.connect(staged.with_suffix(".sqlite"))) as db:
        db.executescript(
            "PRAGMA page_size=4096; PRAGMA cache_size=-8192; PRAGMA temp_store=FILE; "
            "PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; "
            f"PRAGMA max_page_count={max(1, _MAX_STAGE_BYTES // 4096)}; "
            "CREATE TABLE rows(id INTEGER PRIMARY KEY, row_key TEXT UNIQUE, size INTEGER DEFAULT 0); "
            "CREATE TABLE cells(r INTEGER, c INTEGER, v TEXT, kind TEXT, PRIMARY KEY(r,c)) WITHOUT ROWID;"
        )
        with source_path.open("rb") as source:
            if source_path.suffix.casefold().lstrip(".") in JSON_LINES_FORMATS:
                cells = _Cells(db, ())
                _read_json_lines(source, cells)
            else:
                with closing(_events(source)) as events:
                    cells = _Cells(db, events)
                    cells.read()
        original = list(cells.columns)
        if not original:
            raise _structure()
        columns = common._dedupe_columns(original)
        types = [column.dtype() for column in cells.columns.values()]
        identity = ordinal + "_types"
        count, row_limit = _write_batches(db, staged, columns, types, ordinal, identity)

    drift = (
        ["JSON 文件不支持重放工作表或表头选择"]
        if any(
            step["operation"] in {"select_header", "select_sheet", "use_generated_headers"}
            for step in steps
        )
        else []
    )
    operations = []
    if original != columns or any(step["operation"] == "normalize_column_names" for step in steps):
        operations.append(
            {
                "operation": "normalize_column_names",
                "columns": columns,
                "replayed": any(step["operation"] == "normalize_column_names" for step in steps),
            }
        )
    issues = []
    for name, column, dtype in zip(columns, cells.columns.values(), types, strict=True):
        if pa.types.is_string(dtype) and (len(column.kinds) > 1 or column.kinds == {"n"}):
            issues.append(
                {
                    "code": "json_values_preserved",
                    "title": f"{name} 已按文本保留",
                    "detail": "该列包含不同类型或较长数值，未自动转换。",
                    "severity": "warning",
                    "automatic": False,
                    "count": 1,
                }
            )
    return StagedTable(
        rows=count,
        columns=columns,
        operations=operations,
        issues=issues,
        drift=drift,
        native_types={
            name: dtype
            for name, dtype in zip(columns, types, strict=True)
            if not pa.types.is_string(dtype)
        },
        preserve_string_types=True,
        literal_strings=True,
        identity_column=identity,
        reader={
            "engine": "json_stream_v1",
            "layout": cells.layout,
            "batch_rows": row_limit,
            "encoding": "utf-8",
            "schema_scope": "full_file",
            "stage_limit_bytes": _MAX_STAGE_BYTES,
        },
    )


def run_json_preflight(source_path: Path, output_dir: Path, steps: list[dict[str, Any]]):
    try:
        return run_staged_preflight(source_path, output_dir, steps, _stage_json)
    except PreflightInputError:
        raise
    except sqlite3.IntegrityError as exc:
        raise PreflightInputError(
            "JSON 中有重复的字段名或行索引，请重新导出后再导入", code="json_structure_unsupported"
        ) from exc
    except sqlite3.OperationalError as exc:
        if getattr(exc, "sqlite_errorcode", None) == sqlite3.SQLITE_FULL:
            raise _size() from exc
        raise
    except (ijson.JSONError, UnicodeError, pa.ArrowException, OverflowError) as exc:
        raise PreflightInputError(
            "无法完整读取这份 JSON，请检查格式和编码后重新导入", code="json_unreadable"
        ) from exc
