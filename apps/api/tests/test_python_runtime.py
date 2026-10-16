"""Security-contract tests for the maintained Python sandbox helpers."""

import pytest

from app.services.python_runtime import PythonSecurityAnalyzer, validate_python_code


@pytest.mark.parametrize(
    "code",
    [
        "import pandas as pd\nframe.head()",
        "import matplotlib.pyplot as plt\nplt.show()",
        "import numpy as np\nnp.array([1, 2, 3]).mean()",
        "print('hello')",
    ],
)
def test_python_security_analyzer_accepts_analysis_code(code: str) -> None:
    assert PythonSecurityAnalyzer.analyze(code) == (True, [])


@pytest.mark.parametrize(
    "code",
    [
        "import os\nos.system('whoami')",
        "from subprocess import run",
        "import importlib\nimportlib.import_module('os')",
        "import pathlib\npathlib.Path('/etc/passwd')",
        "open('report.txt', 'w')",
        "exec('print(1)')",
        "get_ipython()",
        "func.__globals__",
        "().__class__.__mro__",
    ],
)
def test_python_security_analyzer_rejects_host_access(code: str) -> None:
    is_safe, violations = PythonSecurityAnalyzer.analyze(code)
    assert is_safe is False
    assert violations


def test_python_runtime_does_not_leak_os_into_user_namespace() -> None:
    from app.services.python_runtime import PythonExecutionRuntime

    runtime = PythonExecutionRuntime()
    shell = runtime.get_ipython()
    assert "os" not in shell.user_ns
    assert "platform" not in shell.user_ns


def test_sandbox_scrubs_sensitive_environment_variables(monkeypatch: pytest.MonkeyPatch) -> None:
    import os

    from app.services.python_sandbox import _scrub_sandbox_environment

    monkeypatch.setenv("ENCRYPTION_KEY", "secret-key")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-secret")
    monkeypatch.setenv("RECEIPTBI_DESKTOP_CONTROL_TOKEN", "ctrl-token")
    monkeypatch.setenv("DB_PASSWORD", "db-pass")
    monkeypatch.setenv("SAFE_VARIABLE", "keep-me")

    _scrub_sandbox_environment()

    assert "ENCRYPTION_KEY" not in os.environ
    assert "OPENAI_API_KEY" not in os.environ
    assert "RECEIPTBI_DESKTOP_CONTROL_TOKEN" not in os.environ
    assert "DB_PASSWORD" not in os.environ
    assert os.environ.get("SAFE_VARIABLE") == "keep-me"


def test_validate_python_code_reports_syntax_errors_without_executing() -> None:
    is_safe, error = validate_python_code("for item in")
    assert is_safe is False
    assert error and "语法错误" in error
