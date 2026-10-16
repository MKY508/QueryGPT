"""Small filesystem guards; no application services or customer files."""

import hashlib

import pytest

from app.services.report_refresh import (
    RefreshSourceState,
    ReportRefreshSourceError,
    assert_refresh_file_stamps,
    verify_refresh_files,
)


def test_refresh_file_proofs_reject_unavailable_outside_and_modified_files(tmp_path):
    project = tmp_path / "project"
    project.mkdir()
    source = project / "source.csv"
    source.write_bytes(b"value\n123\n")
    fingerprint = hashlib.sha256(source.read_bytes()).hexdigest()
    state = RefreshSourceState({}, "catalog", ((str(source), fingerprint),))
    proof = verify_refresh_files(state, project)
    assert_refresh_file_stamps(proof)
    source.write_bytes(b"value\n999\n")  # same byte count, not just a size check
    with pytest.raises(ReportRefreshSourceError, match="preparation_required"):
        verify_refresh_files(state, project)
    with pytest.raises(ReportRefreshSourceError, match="source_changed"):
        assert_refresh_file_stamps(proof)
    source.unlink()
    with pytest.raises(ReportRefreshSourceError, match="file_unavailable"):
        verify_refresh_files(state, project)
    outside = tmp_path / "outside.csv"
    outside.write_bytes(b"value\n123\n")
    source.symlink_to(outside)
    with pytest.raises(ReportRefreshSourceError, match="file_unavailable"):
        verify_refresh_files(state, project)
    source.unlink()
    source.mkdir()
    with pytest.raises(ReportRefreshSourceError, match="file_unavailable"):
        verify_refresh_files(state, project)
