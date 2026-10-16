from app.models.workspace import PreflightIssue, PreflightReportResponse


def test_preflight_response_retains_localizable_issue_facts():
    issue = {
        "code": "preflight_failed",
        "title": "Parser failure",
        "detail": "Source unchanged",
        "severity": "critical",
        "automatic": False,
        "presentation_code": "json_lines_invalid",
        "presentation_facts": {"line": 2, "sheet": "Orders", "cell": "B21"},
    }
    report = PreflightReportResponse.model_validate(
        {
            "id": "00000000-0000-4000-8000-000000000001",
            "project_id": "00000000-0000-4000-8000-000000000002",
            "data_source_id": "00000000-0000-4000-8000-000000000003",
            "status": "needs_attention",
            "summary": "Review source",
            "issues": [issue],
            "created_at": "2026-09-09T00:00:00Z",
            "updated_at": "2026-09-09T00:00:00Z",
        }
    )
    encoded = report.model_dump(mode="json")["issues"][0]
    assert encoded["presentation_code"] == "json_lines_invalid"
    assert encoded["presentation_facts"] == issue["presentation_facts"]
    assert type(encoded["presentation_facts"]["line"]) is int


def test_ordinary_issue_does_not_emit_empty_presentation_fields():
    issue = PreflightIssue(code="missing_values", title="Missing values", detail="Review blanks")
    encoded = issue.model_dump(mode="json")
    assert "presentation_code" not in encoded
    assert "presentation_facts" not in encoded
