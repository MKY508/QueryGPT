"""Reliable project-local Python dependency installation."""

from __future__ import annotations

import asyncio
import contextlib
import errno
import importlib
import io
import json
import multiprocessing
import os
import re
import shutil
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from importlib.metadata import Distribution, distributions
from pathlib import Path
from typing import Any, BinaryIO
from urllib.parse import unquote, urlsplit
from uuid import uuid4

PACKAGE_PATTERN = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9_.-]*(?:\[[A-Za-z0-9_,.-]+\])?(?:[<>=!~]{1,2}[A-Za-z0-9.*+-]+)?$"
)
PACKAGE_NAME_PATTERN = re.compile(r"^([A-Za-z0-9][A-Za-z0-9_.-]*)")

# These distributions are part of the application runtime. Allowing a project
# package to shadow them can crash the API process or silently change analysis
# results. Long-tail libraries remain installable in the project environment.
CORE_PACKAGE_DENYLIST = frozenset(
    {
        "alembic",
        "asyncpg",
        "cryptography",
        "duckdb",
        "fastapi",
        "httpx",
        "ipython",
        "matplotlib",
        "numpy",
        "openai",
        "openpyxl",
        "pandas",
        "pip",
        "plotly",
        "polars",
        "psycopg2",
        "psycopg2-binary",
        "pyarrow",
        "pydantic",
        "pydantic-ai",
        "pydantic-ai-slim",
        "pydantic-core",
        "pydantic-graph",
        "pymysql",
        "seaborn",
        "setuptools",
        "slowapi",
        "sqlalchemy",
        "starlette",
        "uvicorn",
        "wheel",
        "wren-core-py",
        "xlrd",
    }
)


@dataclass(frozen=True, slots=True)
class _ResolvedDistribution:
    name: str
    version: str
    url: str
    sha256: str | None = None

    @property
    def canonical_name(self) -> str:
        return _canonical_package_name(self.name)

    @property
    def install_argument(self) -> str:
        if not self.sha256 or "#" in self.url:
            return self.url
        return f"{self.url}#sha256={self.sha256}"

    @property
    def is_wheel(self) -> bool:
        return unquote(urlsplit(self.url).path).lower().endswith(".whl")


def _canonical_package_name(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def _requirement_name(requirement: str) -> str:
    match = PACKAGE_NAME_PATTERN.match(requirement)
    if match is None:  # install() validates the full requirement first
        return ""
    return _canonical_package_name(match.group(1))


def _embedded_pip_worker(connection: Any, arguments: list[str], extra_paths: list[str]) -> None:
    """Run bundled pip outside the API process so it can be terminated."""

    try:
        from pip._internal.cli.main import main as pip_main

        for path in reversed(extra_paths):
            if path not in sys.path:
                sys.path.insert(0, path)

        output = io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            return_code = int(pip_main(arguments))
        connection.send((return_code, output.getvalue()))
    except BaseException as exc:  # pragma: no cover - frozen process boundary
        connection.send((1, f"{type(exc).__name__}: {exc}"))
    finally:
        connection.close()


def _import_smoke_worker(connection: Any, target: str, modules: list[str]) -> None:
    """Import newly installed modules in an isolated, killable process."""

    try:
        sys.path.insert(0, target)
        for module in modules:
            importlib.import_module(module)
        connection.send((0, ""))
    except BaseException as exc:  # pragma: no cover - child process boundary
        connection.send((1, f"{type(exc).__name__}: {exc}"))
    finally:
        connection.close()


def _try_lock(handle: BinaryIO) -> bool:
    """Acquire an advisory cross-process lock without blocking the event loop."""

    try:
        if os.name == "nt":  # pragma: no cover - exercised by Windows packaging
            import msvcrt

            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError as exc:
        if exc.errno in {errno.EACCES, errno.EAGAIN}:
            return False
        raise
    return True


def _unlock(handle: BinaryIO) -> None:
    if os.name == "nt":  # pragma: no cover - exercised by Windows packaging
        import msvcrt

        handle.seek(0)
        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
    else:
        import fcntl

        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def _remove_path(path: Path) -> None:
    if path.is_symlink() or path.is_file():
        path.unlink(missing_ok=True)
    elif path.exists():
        shutil.rmtree(path)


class ProjectDependencyManager:
    def __init__(self, project_dir: Path):
        self.project_dir = project_dir
        self.target = project_dir / ".python"
        self.manifest_path = project_dir / "python-dependencies.json"
        self.lock_path = project_dir / "python-dependencies.lock"

    @property
    def import_path(self) -> str:
        return str(self.target.resolve())

    @staticmethod
    def _list_installed(target: Path) -> list[dict[str, str]]:
        if not target.exists():
            return []
        installed = {
            str(distribution.metadata.get("Name") or ""): str(distribution.version)
            for distribution in distributions(path=[str(target)])
            if distribution.metadata.get("Name")
        }
        return [
            {"name": name, "version": version}
            for name, version in sorted(installed.items(), key=lambda item: item[0].lower())
        ]

    def list_installed(self) -> list[dict[str, str]]:
        return self._list_installed(self.target)

    def _requested(self) -> list[str]:
        if self.manifest_path.exists():
            try:
                return list(
                    json.loads(self.manifest_path.read_text(encoding="utf-8")).get("requested", [])
                )
            except (OSError, ValueError, TypeError):
                pass
        return []

    def describe(self) -> dict[str, Any]:
        return {"requested": self._requested(), "installed": self.list_installed()}

    def _manifest_payload(
        self, packages: list[str], *, installed_target: Path | None = None
    ) -> dict[str, Any]:
        return {
            "version": 1,
            "updated_at": datetime.now(UTC).isoformat(),
            "requested": sorted(set([*self._requested(), *packages])),
            "installed": self._list_installed(installed_target or self.target),
        }

    def _write_manifest_atomic(self, payload: dict[str, Any]) -> None:
        self.project_dir.mkdir(parents=True, exist_ok=True)
        temporary = self.project_dir / f".{self.manifest_path.name}.{uuid4().hex}.tmp"
        try:
            temporary.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            os.replace(temporary, self.manifest_path)
        finally:
            temporary.unlink(missing_ok=True)

    def _record_install(self, packages: list[str]) -> None:
        """Record an already committed environment (also used by migrations/tests)."""

        self._write_manifest_atomic(self._manifest_payload(packages))

    @asynccontextmanager
    async def _installation_lock(self, timeout: float) -> AsyncIterator[None]:
        self.project_dir.mkdir(parents=True, exist_ok=True)
        handle = self.lock_path.open("a+b")
        locked = False
        try:
            # msvcrt requires at least one byte to exist before locking it.
            handle.seek(0, os.SEEK_END)
            if handle.tell() == 0:
                handle.write(b"\0")
                handle.flush()
            deadline = asyncio.get_running_loop().time() + timeout
            while not (locked := _try_lock(handle)):
                if asyncio.get_running_loop().time() >= deadline:
                    raise RuntimeError("另一个依赖安装仍在进行，请稍后重试")
                await asyncio.sleep(0.05)
            yield
        finally:
            if locked:
                _unlock(handle)
            handle.close()

    @staticmethod
    def _validate_packages(packages: list[str]) -> list[str]:
        normalized = sorted({package.strip() for package in packages if package.strip()})
        if not normalized or any(not PACKAGE_PATTERN.fullmatch(package) for package in normalized):
            raise ValueError("依赖名称无效")
        blocked = sorted(
            requirement
            for requirement in normalized
            if _requirement_name(requirement) in CORE_PACKAGE_DENYLIST
        )
        if blocked:
            raise ValueError(f"内置核心库不可由项目覆盖：{', '.join(blocked)}")
        return normalized

    @staticmethod
    def _assert_no_core_distributions(target: Path) -> None:
        blocked = sorted(
            {
                str(distribution.metadata.get("Name") or "")
                for distribution in distributions(path=[str(target)])
                if _canonical_package_name(str(distribution.metadata.get("Name") or ""))
                in CORE_PACKAGE_DENYLIST
            },
            key=str.lower,
        )
        if blocked:
            raise RuntimeError(f"安装结果试图覆盖内置核心库：{', '.join(blocked)}")

    @staticmethod
    def _read_resolution_report(report_path: Path) -> list[_ResolvedDistribution]:
        try:
            payload = json.loads(report_path.read_text(encoding="utf-8"))
            raw_install = payload["install"]
        except (OSError, KeyError, TypeError, ValueError) as exc:
            raise RuntimeError("pip 未生成有效的依赖解析报告") from exc
        if not isinstance(raw_install, list):
            raise RuntimeError("pip 未生成有效的依赖解析报告")

        resolved: list[_ResolvedDistribution] = []
        seen: set[str] = set()
        for raw_item in raw_install:
            try:
                metadata = raw_item["metadata"]
                download_info = raw_item["download_info"]
                name = str(metadata["name"]).strip()
                version = str(metadata["version"]).strip()
                url = str(download_info["url"]).strip()
                archive_info = download_info.get("archive_info") or {}
                hashes = archive_info.get("hashes") or {}
                sha256 = hashes.get("sha256")
            except (AttributeError, KeyError, TypeError) as exc:
                raise RuntimeError("pip 依赖解析报告缺少制品信息") from exc
            if not name or not version or not url:
                raise RuntimeError("pip 依赖解析报告缺少制品信息")
            canonical_name = _canonical_package_name(name)
            if canonical_name in seen:
                raise RuntimeError(f"pip 依赖解析报告包含重复包：{name}")
            seen.add(canonical_name)
            resolved.append(
                _ResolvedDistribution(
                    name=name,
                    version=version,
                    url=url,
                    sha256=str(sha256) if sha256 else None,
                )
            )
        return sorted(resolved, key=lambda item: item.canonical_name)

    @staticmethod
    def _assert_safe_resolution(
        resolved: list[_ResolvedDistribution], *, require_wheels: bool
    ) -> None:
        blocked = sorted(
            {item.name for item in resolved if item.canonical_name in CORE_PACKAGE_DENYLIST},
            key=str.lower,
        )
        if blocked:
            raise RuntimeError(f"依赖解析试图覆盖内置核心库：{', '.join(blocked)}")
        if require_wheels:
            source_only = sorted(
                {f"{item.name}=={item.version}" for item in resolved if not item.is_wheel},
                key=str.lower,
            )
            if source_only:
                raise RuntimeError(f"桌面版只允许安装预编译 wheel：{', '.join(source_only)}")

    @staticmethod
    def _distribution_import_names(distribution: Distribution) -> list[str]:
        candidates: set[str] = set()
        top_level = distribution.read_text("top_level.txt") or ""
        candidates.update(
            line.strip() for line in top_level.splitlines() if line.strip().isidentifier()
        )
        if not candidates:
            for file in distribution.files or ():
                parts = Path(str(file)).parts
                if not parts or parts[0].endswith((".dist-info", ".data")):
                    continue
                root = parts[0].removesuffix(".py")
                if root.isidentifier():
                    candidates.add(root)
        return sorted(candidates)

    @classmethod
    def _discover_import_names(cls, target: Path, packages: list[str]) -> list[str]:
        requested = {_requirement_name(package) for package in packages}
        found: set[str] = set()
        import_names: set[str] = set()
        project_distributions = list(distributions(path=[str(target)]))
        runtime_distributions = list(distributions())
        for distribution in [*project_distributions, *runtime_distributions]:
            name = _canonical_package_name(str(distribution.metadata.get("Name") or ""))
            if name not in requested or name in found:
                continue
            found.add(name)
            import_names.update(cls._distribution_import_names(distribution))
        missing = sorted(requested - found)
        if missing:
            raise RuntimeError(f"安装完成但未发现包元数据：{', '.join(missing)}")
        if not import_names:
            raise RuntimeError("安装完成但未发现可导入的 Python 模块")
        return sorted(import_names)

    @staticmethod
    async def _run_spawned_worker(
        worker: Any,
        arguments: tuple[Any, ...],
        *,
        timeout: float,
        name: str,
    ) -> tuple[int, str]:
        context = multiprocessing.get_context("spawn")
        parent_connection, child_connection = context.Pipe(duplex=False)
        process = context.Process(
            target=worker,
            args=(child_connection, *arguments),
            name=name,
        )
        process.start()
        child_connection.close()
        deadline = asyncio.get_running_loop().time() + timeout
        try:
            while True:
                if parent_connection.poll():
                    try:
                        return parent_connection.recv()
                    except EOFError as exc:
                        raise RuntimeError("依赖子进程意外退出") from exc
                if not process.is_alive():
                    raise RuntimeError("依赖子进程意外退出")
                if asyncio.get_running_loop().time() >= deadline:
                    raise TimeoutError
                await asyncio.sleep(0.05)
        finally:
            process.join(timeout=0.2)
            if process.is_alive():
                process.terminate()
                process.join(timeout=1)
            if process.is_alive() and hasattr(process, "kill"):
                process.kill()
                process.join(timeout=0.5)
            parent_connection.close()

    @classmethod
    async def _install_with_embedded_pip(
        cls,
        arguments: list[str],
        timeout: float,
        *,
        extra_paths: tuple[str, ...] = (),
    ) -> tuple[int, str]:
        """Run bundled pip in a killable PyInstaller child process."""

        return await cls._run_spawned_worker(
            _embedded_pip_worker,
            (arguments, list(extra_paths)),
            timeout=timeout,
            name="receiptbi-project-pip",
        )

    @staticmethod
    async def _install_with_subprocess(
        arguments: list[str],
        timeout: float,
        *,
        extra_paths: tuple[str, ...] = (),
    ) -> tuple[int, str]:
        environment = os.environ.copy()
        if extra_paths:
            existing_python_path = environment.get("PYTHONPATH")
            environment["PYTHONPATH"] = os.pathsep.join(
                [*extra_paths, *([existing_python_path] if existing_python_path else [])]
            )
        process = await asyncio.create_subprocess_exec(
            sys.executable,
            "-m",
            "pip",
            *arguments,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env=environment,
        )
        communication = asyncio.create_task(process.communicate())
        try:
            output, _ = await asyncio.wait_for(asyncio.shield(communication), timeout=timeout)
        except (TimeoutError, asyncio.CancelledError):
            if process.returncode is None:
                with contextlib.suppress(ProcessLookupError):
                    process.kill()
            with contextlib.suppress(Exception):
                await asyncio.shield(communication)
            raise
        return process.returncode or 0, output.decode("utf-8", errors="replace")

    async def _run_pip(
        self,
        arguments: list[str],
        timeout: float,
        *,
        extra_paths: tuple[str, ...] = (),
    ) -> tuple[int, str]:
        if getattr(sys, "frozen", False):
            return await self._install_with_embedded_pip(
                arguments, timeout, extra_paths=extra_paths
            )
        return await self._install_with_subprocess(arguments, timeout, extra_paths=extra_paths)

    @classmethod
    async def _smoke_test(cls, target: Path, packages: list[str], timeout: float = 30) -> None:
        modules = cls._discover_import_names(target, packages)
        result = await cls._run_spawned_worker(
            _import_smoke_worker,
            (str(target), modules),
            timeout=timeout,
            name="receiptbi-project-import-smoke",
        )
        if result[0] != 0:
            raise RuntimeError(f"依赖导入验收失败：{result[1][-2000:]}")

    @staticmethod
    def _remaining_timeout(deadline: float) -> float:
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            raise TimeoutError
        return remaining

    async def _run_pip_checked(
        self,
        arguments: list[str],
        *,
        deadline: float,
        extra_paths: tuple[str, ...] = (),
    ) -> str:
        result = await self._run_pip(
            arguments,
            self._remaining_timeout(deadline),
            extra_paths=extra_paths,
        )
        if result[0] != 0:
            raise RuntimeError(result[1][-2000:] or "依赖安装失败")
        return result[1]

    async def _resolve_install_plan(
        self,
        staging: Path,
        packages: list[str],
        *,
        deadline: float,
    ) -> list[_ResolvedDistribution]:
        report_path = self.project_dir / f".python-resolution.{uuid4().hex}.json"
        arguments = [
            "install",
            "--disable-pip-version-check",
            "--no-input",
            "--dry-run",
            "--prefer-binary",
            "--report",
            str(report_path),
            "--only-binary=:all:",
            *packages,
        ]
        try:
            await self._run_pip_checked(
                arguments,
                deadline=deadline,
                extra_paths=(str(staging),),
            )
            resolved = self._read_resolution_report(report_path)
            self._assert_safe_resolution(resolved, require_wheels=True)
            return resolved
        finally:
            report_path.unlink(missing_ok=True)

    async def _install_resolved_plan(
        self,
        staging: Path,
        resolved: list[_ResolvedDistribution],
        *,
        deadline: float,
    ) -> None:
        if not resolved:
            return
        arguments = [
            "install",
            "--disable-pip-version-check",
            "--no-input",
            "--upgrade",
            "--prefer-binary",
            "--no-deps",
            "--target",
            str(staging),
            "--only-binary=:all:",
            *(item.install_argument for item in resolved),
        ]
        await self._run_pip_checked(arguments, deadline=deadline)

    def _prepare_staging(self) -> Path:
        staging = self.project_dir / f".python.staging.{uuid4().hex}"
        try:
            if self.target.exists():
                shutil.copytree(self.target, staging, symlinks=True)
            else:
                staging.mkdir(parents=True)
        except BaseException:
            _remove_path(staging)
            raise
        return staging

    def _commit(self, staging: Path, packages: list[str]) -> None:
        backup = self.project_dir / f".python.backup.{uuid4().hex}"
        temporary_manifest = self.project_dir / f".{self.manifest_path.name}.{uuid4().hex}.tmp"
        payload = self._manifest_payload(packages, installed_target=staging)
        had_target = self.target.exists() or self.target.is_symlink()
        committed = False
        try:
            temporary_manifest.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            if had_target:
                os.replace(self.target, backup)
            try:
                os.replace(staging, self.target)
                os.replace(temporary_manifest, self.manifest_path)
                committed = True
            except BaseException:
                _remove_path(self.target)
                if had_target and backup.exists():
                    os.replace(backup, self.target)
                raise
        finally:
            temporary_manifest.unlink(missing_ok=True)
            if committed:
                with contextlib.suppress(OSError):
                    _remove_path(backup)

    async def install(
        self,
        packages: list[str],
        timeout: int = 180,
        *,
        lock_timeout: float = 30,
    ) -> str:
        normalized = self._validate_packages(packages)
        async with self._installation_lock(lock_timeout):
            deadline = asyncio.get_running_loop().time() + timeout
            staging = self._prepare_staging()
            try:
                try:
                    self._assert_no_core_distributions(staging)
                    resolved = await self._resolve_install_plan(
                        staging,
                        normalized,
                        deadline=deadline,
                    )
                    await self._install_resolved_plan(
                        staging,
                        resolved,
                        deadline=deadline,
                    )
                    self._assert_no_core_distributions(staging)
                    await self._smoke_test(
                        staging,
                        normalized,
                        timeout=min(self._remaining_timeout(deadline), 30),
                    )
                except TimeoutError:
                    raise RuntimeError("依赖安装超时") from None
                if resolved:
                    self._commit(staging, normalized)
                else:
                    self._record_install(normalized)
            finally:
                _remove_path(staging)
        return f"已为当前项目安装：{', '.join(normalized)}"
