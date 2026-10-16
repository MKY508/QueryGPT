"""Bounded CSV options shared by API contracts and the persisted reader step."""

from typing import Literal, get_args

CsvDelimiter = Literal[",", ";", "\t", "|"]
CsvEncoding = Literal["utf-8-sig", "gb18030"]
CSV_DELIMITERS = get_args(CsvDelimiter)
CSV_ENCODINGS = get_args(CsvEncoding)
