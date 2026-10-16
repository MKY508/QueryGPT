"""Strict CSV parsing and bounded staging for the shared preparation plane."""

from __future__ import annotations

import codecs
import csv
from collections.abc import Iterator
from contextlib import closing
from itertools import islice
from pathlib import Path
from typing import Any, TextIO

import pandas as pd

from app.core.csv_options import CSV_DELIMITERS, CSV_ENCODINGS
from app.services.semantic_field_roles import has_identifier_semantics
from app.services.tabular_preflight import (
    _BATCH_BYTES,
    _BATCH_CELLS,
    _BATCH_ROWS,
    _MAX_COLUMNS,
    _NULL_VALUES,
    _RECORD_CHARACTERS,
    StagedTable,
    StringBatchWriter,
    _issue,
    run_staged_preflight,
)

# The stdlib default rejects fields at 128 Ki characters, before our bounded
# record reader reaches its limit. Configure this process-wide setting once,
# not around individual readers: restoring it could interrupt another import.
# Keep any larger host setting; _BoundedLines still enforces our record cap.
csv.field_size_limit(max(csv.field_size_limit(), _RECORD_CHARACTERS))


def _encoding(path: Path, requested: str | None = None) -> str:
    # Validate the whole byte stream, not only an ASCII prefix. A late decoding
    # error must not change encodings halfway through one prepared table.
    if requested is not None and requested not in CSV_ENCODINGS:
        raise ValueError("不支持的 CSV 编码")
    for encoding in (requested,) if requested is not None else CSV_ENCODINGS:
        decoder = codecs.getincrementaldecoder(encoding)(errors="strict")
        try:
            with path.open("rb") as source:
                while chunk := source.read(1024 * 1024):
                    decoder.decode(chunk)
                decoder.decode(b"", final=True)
            return encoding
        except UnicodeError:
            continue
    raise ValueError("无法识别 CSV 编码，请另存为 UTF-8 或 GB18030")


class _BoundedLines:
    def __init__(self, source: TextIO):
        self.source = source
        self.characters = 0

    def __iter__(self):
        return self

    def __next__(self) -> str:
        line = self.source.readline(_RECORD_CHARACTERS + 1)
        if not line:
            raise StopIteration
        self.characters += len(line)
        if self.characters > _RECORD_CHARACTERS:
            raise ValueError("CSV 中有过长的记录，请缩短单元格内容后重试")
        return line


def _records(path: Path, encoding: str, delimiter: str = ",") -> Iterator[list[str]]:
    if delimiter not in CSV_DELIMITERS:
        raise ValueError("不支持的 CSV 分隔符")
    with path.open("r", encoding=encoding, newline="") as source:
        lines = _BoundedLines(source)
        reader = csv.reader(lines, strict=True, delimiter=delimiter)
        try:
            for record in reader:
                lines.characters = 0
                if not record:  # Match ordinary CSV blank-line handling.
                    continue
                if len(record) > _MAX_COLUMNS:
                    raise ValueError("CSV 列数过多，请拆分文件后再整理")
                yield record
        except csv.Error as exc:
            raise ValueError(
                f"CSV 第 {reader.line_num} 行附近无法读取，请检查引号或单元格长度"
            ) from exc


def _stage(
    path: Path,
    destination: Path,
    encoding: str,
    header: int,
    columns: list[str],
    ordinal: str,
    *,
    literal_strings: bool = False,
    delimiter: str = ",",
) -> int:
    identifiers = [has_identifier_semantics(column) for column in columns]
    with StringBatchWriter(destination, columns, ordinal, max_rows=_BATCH_ROWS) as writer:
        for index, row in enumerate(_records(path, encoding, delimiter)):
            if index <= header:
                continue
            if len(row) != len(columns):
                raise ValueError(f"CSV 第 {index + 1} 条记录的列数与表头不一致，请检查分隔符")
            writer.append(
                [
                    None
                    if value == ""
                    or (not literal_strings and not identifiers[i] and value in _NULL_VALUES)
                    else value
                    for i, value in enumerate(row)
                ]
            )
    return writer.count


def _stage_csv(
    source_path: Path, staged: Path, ordinal: str, steps: list[dict[str, Any]]
) -> StagedTable:
    from app.services import data_preflight as common

    read_step = common._recipe_step(steps, "read_csv")
    encoding = _encoding(source_path, read_step["encoding"] if read_step else None)
    delimiter = read_step["delimiter"] if read_step else ","
    probe = []
    records = _records(source_path, encoding, delimiter)
    try:
        for _ in range(12):
            row = next(records, None)
            if row is None:
                break
            probe.append(row)
    finally:
        records.close()
    if not probe:
        raise ValueError("CSV 中没有可分析的数据")
    raw = pd.DataFrame(probe)
    inferred = max(range(len(probe)), key=lambda index: common._header_score(raw.iloc[index]))
    selected = common._recipe_step(steps, "select_header")
    headerless = common._recipe_step(steps, "use_generated_headers") is not None
    requested = int(selected["row"]) - 1 if selected else None
    drift: list[str] = []
    header = inferred
    header_values = probe[inferred]
    if requested is not None:
        with closing(_records(source_path, encoding, delimiter)) as records:
            chosen = next(islice(records, requested, requested + 1), None)
        if chosen and any(value != "" for value in chosen):
            header, header_values = requested, chosen
        else:
            drift.append(f"原配方指定的第 {requested + 1} 条记录表头已不存在")
    if common._recipe_step(steps, "select_sheet"):
        drift.append("当前文件不是 Excel，无法重放工作表选择")
    if headerless:
        header = -1
    original_columns = [None] * len(probe[0]) if headerless else header_values
    columns = common._dedupe_columns(original_columns)
    issues: list[dict[str, Any]] = []
    operations: list[dict[str, Any]] = []
    expected = {step["operation"] for step in steps}

    def operation(name: str, **facts: Any) -> None:
        operations.append({"operation": name, **facts, "replayed": name in expected})

    if read_step:
        operation("read_csv", delimiter=delimiter, encoding=encoding)
    if headerless:
        operation("use_generated_headers")
    elif header or "select_header" in expected:
        operation("select_header", row=header + 1)
        _issue(
            issues,
            "header_offset",
            f"已找到第 {header + 1} 行的真实表头",
            "表头之前的说明行未进入分析副本。",
            header,
            automatic=True,
        )
    if columns != original_columns or "normalize_column_names" in expected:
        operation("normalize_column_names", columns=columns)

    original_rows = _stage(
        source_path,
        staged,
        encoding,
        header,
        columns,
        ordinal,
        literal_strings=headerless,
        delimiter=delimiter,
    )
    return StagedTable(
        rows=original_rows,
        columns=columns,
        operations=operations,
        issues=issues,
        drift=drift,
        literal_strings=headerless,
        reader={
            "header_row": None if headerless else header + 1,
            "has_header": not headerless,
            "encoding": encoding,
            "delimiter": delimiter,
            "engine": "csv_stream_v1",
            "batch_rows": _BATCH_ROWS,
            "batch_cells": _BATCH_CELLS,
            "batch_bytes": _BATCH_BYTES,
        },
    )


def run_csv_preflight(source_path: Path, output_dir: Path, steps: list[dict[str, Any]]):
    return run_staged_preflight(source_path, output_dir, steps, _stage_csv)
