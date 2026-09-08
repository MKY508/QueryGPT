"""File-format admission shared by upload, preparation and source classification."""

JSON_LINES_FORMATS = frozenset({"jsonl", "ndjson"})
JSON_FILE_FORMATS = frozenset({"json", *JSON_LINES_FORMATS})
SUPPORTED_FILE_FORMATS = frozenset({"csv", "xls", "xlsx", "parquet", *JSON_FILE_FORMATS})
