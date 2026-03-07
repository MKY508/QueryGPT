"""Sandboxed Python execution helpers for QueryGPT."""

import ast
import asyncio
import base64
import io
import os
import sys
import traceback
from importlib.util import find_spec
from typing import Any

import structlog

logger = structlog.get_logger()

BLOCKED_MODULES = frozenset(
    {
        "os",
        "sys",
        "subprocess",
        "socket",
        "requests",
        "urllib",
        "http",
        "ftplib",
        "telnetlib",
        "smtplib",
        "poplib",
        "imaplib",
        "nntplib",
        "sqlite3",
        "bdb",
        "pdb",
        "pydoc",
        "webbrowser",
        "idlelib",
        "tkinter",
        "ctypes",
        "multiprocessing",
        "concurrent",
        "threading",
        "_thread",
        "signal",
        "posix",
        "nt",
        "pwd",
        "grp",
        "spwd",
        "crypt",
        "termios",
        "tty",
        "pty",
        "fcntl",
        "mmap",
        "resource",
        "nis",
        "syslog",
        "commands",
    }
)

BLOCKED_BUILTINS = frozenset(
    {
        "__import__",
        "open",
        "exec",
        "eval",
        "compile",
        "globals",
        "locals",
        "vars",
        "dir",
        "getattr",
        "setattr",
        "delattr",
        "hasattr",
        "input",
        "raw_input",
        "reload",
        "breakpoint",
        "exit",
        "quit",
        "copyright",
        "credits",
        "license",
        "help",
    }
)


class PythonSecurityAnalyzer(ast.NodeVisitor):
    """Python 代码安全分析器 - 使用 AST 检测危险操作"""

    def __init__(self):
        self.violations: list[str] = []

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            module_name = alias.name.split(".")[0]
            if module_name in BLOCKED_MODULES:
                self.violations.append(f"禁止导入模块: {alias.name}")
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        if node.module:
            module_name = node.module.split(".")[0]
            if module_name in BLOCKED_MODULES:
                self.violations.append(f"禁止从模块导入: {node.module}")
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        if isinstance(node.func, ast.Name):
            if node.func.id in BLOCKED_BUILTINS:
                self.violations.append(f"禁止使用危险函数: {node.func.id}")
        elif isinstance(node.func, ast.Attribute) and self._is_blocked_attribute_chain(node.func):
            self.violations.append("禁止调用危险方法")
        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute) -> None:
        if node.attr in ("__builtins__", "__globals__", "__locals__", "__code__"):
            self.violations.append(f"禁止访问危险属性: {node.attr}")
        self.generic_visit(node)

    def _is_blocked_attribute_chain(self, node: ast.Attribute) -> bool:
        current = node
        while isinstance(current, ast.Attribute):
            current = current.value
        if isinstance(current, ast.Name):
            root = current.id
            return root in BLOCKED_MODULES or root in {"__builtins__", "__globals__", "__locals__"}
        return False

    @classmethod
    def analyze(cls, code: str) -> tuple[bool, list[str]]:
        try:
            tree = ast.parse(code)
        except SyntaxError as exc:
            return False, [f"语法错误: {exc}"]

        analyzer = cls()
        analyzer.visit(tree)
        return len(analyzer.violations) == 0, analyzer.violations


def validate_python_code(code: str) -> tuple[bool, str | None]:
    is_safe, violations = PythonSecurityAnalyzer.analyze(code)
    if not is_safe:
        return False, f"检测到不安全的操作: {'; '.join(violations)}"
    return True, None


class PythonExecutionRuntime:
    def __init__(
        self,
        *,
        available_python_libraries: list[str] | None = None,
        analytics_installed: bool = False,
        font_path: str,
    ):
        self.available_python_libraries = available_python_libraries or [
            "pandas",
            "numpy",
            "matplotlib",
        ]
        self.analytics_installed = analytics_installed
        self.font_path = font_path
        self._ipython = None
        self._sql_data: dict[str, Any] = {}

    @property
    def ipython(self):
        return self._ipython

    @property
    def sql_data(self) -> dict[str, Any]:
        return self._sql_data

    def get_ipython(self):
        if self._ipython is None:
            from IPython.core.interactiveshell import InteractiveShell

            self._ipython = InteractiveShell()
            font_loaded = os.path.exists(self.font_path)
            if font_loaded:
                logger.info("Loading bundled font", path=self.font_path)
            else:
                logger.warning(
                    "Bundled font not found, falling back to system fonts", path=self.font_path
                )

            self._ipython.run_cell(
                f"""
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm
import os

font_path = r'{self.font_path}'
if os.path.exists(font_path):
    fm.fontManager.addfont(font_path)
    plt.rcParams['font.family'] = 'Noto Sans SC'
else:
    import platform
    system = platform.system()
    if system == 'Darwin':
        plt.rcParams['font.sans-serif'] = ['Arial Unicode MS', 'PingFang SC', 'Heiti SC']
    elif system == 'Windows':
        plt.rcParams['font.sans-serif'] = ['Microsoft YaHei', 'SimHei']
    else:
        plt.rcParams['font.sans-serif'] = ['WenQuanYi Micro Hei', 'Noto Sans CJK SC', 'DejaVu Sans']

plt.rcParams['axes.unicode_minus'] = False
plt.rcParams['font.size'] = 12
""",
                silent=True,
            )
        return self._ipython

    def inject_sql_data(self, name: str, data: list[dict[str, Any]]) -> None:
        import pandas as pd

        df = pd.DataFrame(data)
        self.get_ipython().push({name: df})
        self._sql_data[name] = df
        logger.info("Injected SQL data into Python runtime", name=name, rows=len(data))

    def validate_dependencies(self, code: str) -> tuple[bool, str | None]:
        try:
            tree = ast.parse(code)
        except SyntaxError as exc:
            return False, f"语法错误: {exc}"

        missing: list[str] = []

        def check_module(module_name: str) -> None:
            root = module_name.split(".")[0]
            if root in BLOCKED_MODULES:
                return
            if find_spec(root) is None:
                missing.append(root)

        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    check_module(alias.name)
            elif isinstance(node, ast.ImportFrom) and node.module:
                check_module(node.module)

        if not missing:
            return True, None

        package_names = ", ".join(sorted(set(missing)))
        return False, f"未安装所需 Python 库: {package_names}"

    async def execute(self, code: str, timeout: int = 30) -> tuple[str | None, list[str]]:
        is_valid, error = validate_python_code(code)
        if not is_valid:
            raise ValueError(error)

        deps_ok, deps_error = self.validate_dependencies(code)
        if not deps_ok:
            raise RuntimeError(deps_error)

        return await asyncio.wait_for(
            asyncio.to_thread(self.execute_sync, code),
            timeout=timeout,
        )

    def execute_sync(self, code: str) -> tuple[str | None, list[str]]:
        import matplotlib.pyplot as plt

        ipython = self.get_ipython()
        stdout_capture = io.StringIO()
        stderr_capture = io.StringIO()
        old_stdout = sys.stdout
        old_stderr = sys.stderr
        sys.stdout = stdout_capture
        sys.stderr = stderr_capture

        images: list[str] = []

        try:
            result = ipython.run_cell(code, silent=False, store_history=False)
            stdout_output = stdout_capture.getvalue()
            stderr_output = stderr_capture.getvalue()

            output = stdout_output
            if stderr_output:
                output += f"\n[stderr]: {stderr_output}"

            if plt.get_fignums():
                for fig_num in plt.get_fignums():
                    fig = plt.figure(fig_num)
                    buf = io.BytesIO()
                    fig.savefig(buf, format="png", dpi=150, bbox_inches="tight")
                    buf.seek(0)
                    images.append(base64.b64encode(buf.read()).decode("utf-8"))
                plt.close("all")

            if result.error_in_exec:
                error_msg = "".join(
                    traceback.format_exception(
                        type(result.error_in_exec),
                        result.error_in_exec,
                        result.error_in_exec.__traceback__,
                    )
                )
                combined_output = output.strip()
                if combined_output:
                    error_msg = f"{combined_output}\n\n执行错误:\n{error_msg}"
                raise RuntimeError(error_msg)
            if result.error_before_exec:
                combined_output = output.strip()
                syntax_error = f"语法错误: {result.error_before_exec}"
                if combined_output:
                    syntax_error = f"{combined_output}\n\n{syntax_error}"
                raise SyntaxError(syntax_error)

            return output if output else None, images
        finally:
            plt.close("all")
            sys.stdout = old_stdout
            sys.stderr = old_stderr
