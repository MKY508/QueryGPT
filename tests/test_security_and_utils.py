from backend.utils import sanitize_sql_query
from backend.sql_executor import SQLSecurityChecker
from backend.query_clarifier import QueryClarifier


def test_sanitize_sql_query_preserves_double_quotes_inside_single_quotes():
    query = "SELECT 'She said \"Hello -- there\"' AS message -- remove me\nFROM dual;"
    cleaned = sanitize_sql_query(query)

    assert '"Hello -- there"' in cleaned
    assert '-- remove me' not in cleaned
    assert cleaned.endswith('FROM dual;')


def test_sql_security_checker_rejects_multiple_statements():
    sql = "SELECT 1; SELECT 2;"
    is_safe, error = SQLSecurityChecker.is_safe(sql)

    assert not is_safe
    assert "多条SQL语句" in error


def test_sql_security_checker_allows_single_statement_with_trailing_semicolon():
    sql = "SELECT 1;"
    is_safe, error = SQLSecurityChecker.is_safe(sql)

    assert is_safe, error


def test_format_clarification_response_handles_missing_status():
    clarifier = QueryClarifier()
    response = clarifier.format_clarification_response({"message": "提示信息"})

    assert "未知" in response
