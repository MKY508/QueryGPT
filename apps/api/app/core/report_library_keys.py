"""Version-one portable report-library keys; also used by the backfill migration."""

import re
import unicodedata


def report_search_text(title: str, description: str | None) -> str:
    return unicodedata.normalize("NFKC", f"{title}\n{description or ''}").lower()


def report_name_key(title: str) -> str:
    """Tokenize text/numbers like natural sorting, then encode a binary-sort key.

    Numeric runs compare by magnitude, not lexical digits. Other characters
    compare by Unicode code point, not a host's locale or database collation.
    Equal normalized titles/numbers are resolved by report ID at query time.
    Keep this v1 format stable: changing it requires another data migration.
    """
    tokens = re.split(r"(\d+)", unicodedata.normalize("NFKC", title).lower())
    result = []
    for token in tokens:
        if token and token.isdecimal():
            digits = str(int(token))
            result.append(f"0{len(digits):06d}{digits}/")
        else:
            result.extend(f"1{ord(char):06x}" for char in token)
    return "".join(result)
