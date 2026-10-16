"""Durable checkpoints for resumable autonomous analysis runs.

The checkpoint deliberately persists observable tool state rather than model
reasoning.  A resumed run replays the deterministic tool journal and verifies
its outputs before the model is allowed to continue.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import json
import os
import shutil
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import pyarrow as pa
import pyarrow.parquet as pq

from app.models.analysis_state import AnalysisState
from app.services.checkpoint_contract import (
    CHECKPOINT_VERSION,
    CheckpointDriftError,
    CheckpointError,
    RestoredCheckpoint,
    stable_payload_hash,
)
from app.services.database import create_database_manager


def source_fingerprint_map(sources: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Build the stable source identity recorded by every safe checkpoint."""

    fingerprints: dict[str, dict[str, Any]] = {}
    for source in sources:
        source_id = str(source.get("id") or "")
        if not source_id:
            continue
        profile = source.get("profile") if isinstance(source.get("profile"), dict) else {}
        schema_signature = stable_payload_hash(
            {
                "schema": profile.get("schema"),
                "tables": profile.get("tables"),
            }
        )
        fingerprints[source_id] = {
            "kind": source.get("kind"),
            "format": source.get("format"),
            "fingerprint": source.get("fingerprint"),
            "schema_signature": schema_signature,
            "logical_name": profile.get("logical_name"),
            "version": profile.get("version"),
        }
    return fingerprints


def validate_source_fingerprints(
    expected: dict[str, dict[str, Any]],
    current_sources: list[dict[str, Any]],
) -> None:
    """Fail closed when the project sources no longer match the checkpoint."""

    current = source_fingerprint_map(current_sources)
    if expected != current:
        raise CheckpointDriftError(
            "项目数据在暂停后发生了变化，不能把旧调查状态和新数据混在一起；请按最新数据重跑。"
        )


async def revalidate_database_replay_journal(
    manifest: dict[str, Any],
    connection_configs: dict[str, dict[str, Any]],
) -> None:
    """Re-run persisted database reads before restoring their cached results.

    A database schema fingerprint cannot prove that its rows stayed unchanged
    while the app was stopped.  Every database query in the replay journal is
    therefore executed against the current project connection and must produce
    the exact same deterministic rows and result semantics as the saved
    checkpoint.  Comparing rows alone is insufficient at the materialization
    boundary: 10,000 complete rows and the first 10,000 of 10,001 rows have the
    same row payload but different analytical meaning.
    """

    configs = {str(source_id): config for source_id, config in connection_configs.items()}
    journal = manifest.get("replay_journal") or []
    if not isinstance(journal, list):
        raise CheckpointDriftError("调查检查点的数据库恢复记录无效。")
    result_metadata = manifest.get("result_metadata") or {}
    if not isinstance(result_metadata, dict):
        raise CheckpointDriftError("调查检查点的数据库结果元数据无效。")

    for step in journal:
        if not isinstance(step, dict):
            continue
        operation = step.get("op")
        is_database_read = operation == "query_database" or (
            operation == "query_source_data" and step.get("source_kind") == "connection"
        )
        if not is_database_read:
            continue
        source_id = str(step.get("source_id") or "")
        planned_sql = str(step.get("planned_sql") or "").strip()
        expected_hash = str(step.get("result_hash") or "")
        result_name = str(step.get("result_name") or "")
        expected_metadata_hash = str(step.get("metadata_hash") or "")
        expected_metadata = result_metadata.get(result_name)
        if (
            not source_id
            or not planned_sql
            or not expected_hash
            or not result_name
            or not expected_metadata_hash
            or not isinstance(expected_metadata, dict)
        ):
            raise CheckpointDriftError("数据库恢复记录缺少来源、实际查询、结果指纹或结果元数据。")
        if stable_payload_hash(expected_metadata) != expected_metadata_hash:
            raise CheckpointDriftError("数据库恢复记录的结果元数据与暂停时不一致。")
        expected_truncated = expected_metadata.get("truncated")
        expected_materialized_rows = expected_metadata.get("materialized_rows")
        if type(expected_truncated) is not bool or type(expected_materialized_rows) is not int:
            raise CheckpointDriftError("数据库恢复记录缺少可靠的行数或截断状态。")

        config = configs.get(source_id)
        if not isinstance(config, dict):
            raise CheckpointDriftError(
                f"暂停时使用的数据库来源 {source_id} 已不在当前项目中，请重新调查。"
            )

        if str(config.get("driver") or "").lower() == "sqlite":
            database = str(config.get("database") or config.get("database_name") or "").strip()
            if database == ":memory:" or not database or not Path(database).is_file():
                raise CheckpointDriftError(
                    f"暂停时使用的数据库来源 {source_id} 已无法访问，请重新调查。"
                )

        try:
            manager = create_database_manager(config)
            result = await asyncio.to_thread(manager.execute_query, planned_sql, True)
        except Exception as exc:
            raise CheckpointDriftError(
                f"无法用当前数据库来源 {source_id} 核对暂停前的结果，请重新调查。"
            ) from exc
        if stable_payload_hash(result.data) != expected_hash:
            raise CheckpointDriftError(
                f"数据库来源 {source_id} 在暂停后发生了变化，不能继续使用旧结果；请重新调查。"
            )
        current_truncated = bool(result.truncated)
        if operation == "query_source_data":
            request_limit = expected_metadata.get("request_limit")
            query_plan = expected_metadata.get("query_plan")
            if type(request_limit) is not int or not isinstance(query_plan, dict):
                raise CheckpointDriftError("结构化数据库恢复记录缺少查询边界元数据。")
            dimensions = query_plan.get("dimensions") or []
            metrics = query_plan.get("metrics") or []
            if not isinstance(dimensions, list) or not isinstance(metrics, list):
                raise CheckpointDriftError("结构化数据库恢复记录的查询边界元数据无效。")
            current_truncated = current_truncated or bool(
                len(result.data) >= request_limit and (dimensions or not metrics)
            )
        if (
            len(result.data) != expected_materialized_rows
            or current_truncated != expected_truncated
        ):
            raise CheckpointDriftError(
                f"数据库来源 {source_id} 的结果行数或截断状态在暂停后发生了变化；请重新调查。"
            )


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _json_safe(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False, default=str))


def _checkpoint_root(project_dir: Path, run_id: UUID | str) -> Path:
    return project_dir / "runs" / str(run_id) / "checkpoints"


def _reserve_checkpoint_revision(root: Path, revision: int) -> tuple[int, Path]:
    """Claim one revision across concurrent threads or service processes."""

    root.mkdir(parents=True, exist_ok=True)
    while True:
        final_dir = root / f"{revision:06d}"
        reservation = root / f".{revision:06d}.lock"
        try:
            descriptor = os.open(
                reservation,
                os.O_CREAT | os.O_EXCL | os.O_WRONLY,
                0o600,
            )
        except FileExistsError:
            revision += 1
            continue
        os.close(descriptor)
        if final_dir.exists():
            reservation.unlink(missing_ok=True)
            revision += 1
            continue
        return revision, reservation


def _write_checkpoint_sync(
    project_dir: Path,
    run_id: UUID | str,
    revision: int,
    snapshot: dict[str, Any],
) -> dict[str, Any]:
    root = _checkpoint_root(project_dir, run_id)
    revision, reservation = _reserve_checkpoint_revision(root, revision)
    final_dir = root / f"{revision:06d}"
    temp_dir = root / f".{revision:06d}-{uuid4().hex}.tmp"

    resumable = bool(snapshot.get("resumable", True))
    reason = snapshot.get("reason")
    datasets: dict[str, dict[str, Any]] = {}
    python_artifacts: dict[str, list[dict[str, Any]]] = {
        "outputs": [],
        "images": [],
    }
    try:
        temp_dir.mkdir(parents=True)
        for index, (name, rows) in enumerate((snapshot.get("dataframes") or {}).items()):
            safe_name = hashlib.sha256(str(name).encode("utf-8")).hexdigest()[:16]
            descriptor: dict[str, Any] = {
                "name": str(name),
                "rows": len(rows),
                "result_hash": stable_payload_hash(rows),
            }
            if not rows:
                descriptor["storage"] = "empty"
                datasets[str(name)] = descriptor
                continue
            path = temp_dir / f"{index:03d}-{safe_name}.parquet"
            try:
                # A result can legitimately mix safe integers, exact numeric
                # strings and nulls in one column, or contain sparse rows.
                # Persist row JSON in compressed batches instead of inferring a
                # dataframe schema that coerces integers/nulls into floats.
                schema = pa.schema([("row_json", pa.string())])
                with pq.ParquetWriter(path, schema, compression="zstd") as writer:
                    for offset in range(0, len(rows), 2048):
                        payloads = [
                            json.dumps(row, ensure_ascii=False, default=str, allow_nan=False)
                            for row in rows[offset : offset + 2048]
                        ]
                        writer.write_batch(
                            pa.RecordBatch.from_arrays([pa.array(payloads)], schema=schema)
                        )
            except Exception as exc:
                resumable = False
                reason = reason or "checkpoint_dataset_not_serializable"
                descriptor.update(
                    {
                        "storage": "unavailable",
                        "error": f"{type(exc).__name__}: {exc}"[:1000],
                    }
                )
            else:
                descriptor.update(
                    {
                        "storage": "parquet",
                        "encoding": "json_rows_v1",
                        "path": path.name,
                        "sha256": _sha256_file(path),
                    }
                )
            datasets[str(name)] = descriptor

        for index, raw_output in enumerate(snapshot.get("python_output") or []):
            output = str(raw_output)
            path = temp_dir / f"python-output-{index:03d}.txt"
            path.write_text(output, encoding="utf-8")
            python_artifacts["outputs"].append(
                {
                    "storage": "text",
                    "path": path.name,
                    "sha256": _sha256_file(path),
                    "payload_hash": stable_payload_hash(output),
                }
            )

        for index, raw_image in enumerate(snapshot.get("python_images") or []):
            image = str(raw_image)
            descriptor = {
                "payload_hash": stable_payload_hash(image),
            }
            try:
                base64.b64decode(image, validate=True)
            except (binascii.Error, ValueError):
                resumable = False
                reason = reason or "checkpoint_python_artifact_not_serializable"
                descriptor.update({"storage": "unavailable"})
            else:
                path = temp_dir / f"python-image-{index:03d}.b64"
                path.write_text(image, encoding="ascii")
                descriptor.update(
                    {
                        "storage": "base64",
                        "path": path.name,
                        "sha256": _sha256_file(path),
                    }
                )
            python_artifacts["images"].append(descriptor)

        manifest = _json_safe(
            {
                "version": CHECKPOINT_VERSION,
                "revision": revision,
                "safe_boundary": snapshot.get("safe_boundary") or "after_tool",
                "stage": snapshot.get("stage") or "investigating",
                "analysis_state": AnalysisState(
                    snapshot.get("analysis_state") or AnalysisState.INVESTIGATING
                ).value,
                "resumable": resumable,
                "reason": reason,
                "source_fingerprints": snapshot.get("source_fingerprints") or {},
                "datasets": datasets,
                "result_metadata": snapshot.get("result_metadata") or {},
                "tool_history": snapshot.get("tool_history") or [],
                "replay_journal": snapshot.get("replay_journal") or [],
                "validated_results": snapshot.get("validated_results") or [],
                "knowledge_proposals": snapshot.get("knowledge_proposals") or [],
                "python_artifacts": python_artifacts,
            }
        )
        manifest_path = temp_dir / "manifest.json"
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2),
            encoding="utf-8",
        )
        manifest_sha256 = _sha256_file(manifest_path)
        os.replace(temp_dir, final_dir)
    except BaseException:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise
    finally:
        reservation.unlink(missing_ok=True)

    relative_manifest = (final_dir / "manifest.json").relative_to(project_dir)
    return {
        "version": CHECKPOINT_VERSION,
        "revision": revision,
        "manifest_path": str(relative_manifest),
        "manifest_sha256": manifest_sha256,
        "safe_boundary": manifest["safe_boundary"],
        "stage": manifest["stage"],
        "analysis_state": manifest["analysis_state"],
        "resumable": resumable,
        "reason": reason,
        "source_fingerprints": manifest["source_fingerprints"],
        "replay_steps": len(manifest["replay_journal"]),
    }


async def save_runtime_checkpoint(
    project_dir: Path,
    run_id: UUID | str,
    revision: int,
    snapshot: dict[str, Any],
) -> dict[str, Any]:
    """Atomically save intermediate tables and their replay manifest."""

    return await asyncio.to_thread(
        _write_checkpoint_sync,
        project_dir,
        run_id,
        revision,
        snapshot,
    )


def _resolve_manifest_path(project_dir: Path, checkpoint: dict[str, Any]) -> Path:
    relative = str(checkpoint.get("manifest_path") or "")
    if not relative:
        raise CheckpointError("调查检查点没有可读取的清单")
    root = project_dir.resolve()
    path = (root / relative).resolve()
    if not path.is_relative_to(root):
        raise CheckpointError("调查检查点路径无效")
    return path


def _load_checkpoint_sync(
    project_dir: Path,
    checkpoint: dict[str, Any],
) -> RestoredCheckpoint:
    if checkpoint.get("version") != CHECKPOINT_VERSION:
        raise CheckpointError("调查检查点版本不受支持")
    if not checkpoint.get("resumable"):
        raise CheckpointError("这次调查没有可安全恢复的工具检查点，请重新调查")
    manifest_path = _resolve_manifest_path(project_dir, checkpoint)
    if not manifest_path.is_file():
        raise CheckpointError("调查检查点文件已丢失，请重新调查")
    expected_manifest_hash = str(checkpoint.get("manifest_sha256") or "")
    if not expected_manifest_hash or _sha256_file(manifest_path) != expected_manifest_hash:
        raise CheckpointError("调查检查点校验失败，请重新调查")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("version") != CHECKPOINT_VERSION or not manifest.get("resumable"):
        raise CheckpointError("调查检查点不可恢复")

    dataframes: dict[str, list[dict[str, Any]]] = {}
    for name, descriptor in (manifest.get("datasets") or {}).items():
        storage = descriptor.get("storage")
        if storage == "empty":
            dataframes[str(name)] = []
            continue
        if storage != "parquet":
            raise CheckpointError(f"中间结果 {name} 没有可恢复的数据文件")
        data_path = (manifest_path.parent / str(descriptor.get("path") or "")).resolve()
        if not data_path.is_relative_to(manifest_path.parent.resolve()) or not data_path.is_file():
            raise CheckpointError(f"中间结果 {name} 文件已丢失")
        if _sha256_file(data_path) != descriptor.get("sha256"):
            raise CheckpointError(f"中间结果 {name} 校验失败")
        try:
            if descriptor.get("encoding") == "json_rows_v1":
                rows = []
                with pq.ParquetFile(data_path) as stored:
                    for batch in stored.iter_batches(batch_size=2048, columns=["row_json"]):
                        rows.extend(json.loads(value) for value in batch.column(0).to_pylist())
                if any(not isinstance(row, dict) for row in rows):
                    raise ValueError("Invalid result row")
            elif descriptor.get("encoding") is None:
                # Existing v1 checkpoints retain their hashes and native schema.
                rows = pq.read_table(data_path).to_pylist()
            else:
                raise ValueError("Unsupported result encoding")
        except (pa.ArrowException, ValueError, TypeError, IndexError) as exc:
            raise CheckpointError(f"中间结果 {name} 无法读取") from exc
        if len(rows) != descriptor.get("rows"):
            raise CheckpointError(f"中间结果 {name} 行数发生了变化")
        if stable_payload_hash(rows) != descriptor.get("result_hash"):
            raise CheckpointError(f"中间结果 {name} 内容发生了变化")
        dataframes[str(name)] = rows

    artifact_manifest = manifest.get("python_artifacts") or {}
    output_descriptors = artifact_manifest.get("outputs") or []
    image_descriptors = artifact_manifest.get("images") or []
    if not isinstance(output_descriptors, list) or not isinstance(image_descriptors, list):
        raise CheckpointError("图表检查点清单无效")

    checkpoint_dir = manifest_path.parent.resolve()

    def read_artifact(descriptor: Any, *, label: str, storage: str) -> str:
        if not isinstance(descriptor, dict) or descriptor.get("storage") != storage:
            raise CheckpointError(f"{label} 没有可恢复的文件")
        artifact_path = (checkpoint_dir / str(descriptor.get("path") or "")).resolve()
        if not artifact_path.is_relative_to(checkpoint_dir) or not artifact_path.is_file():
            raise CheckpointError(f"{label} 文件已丢失")
        if _sha256_file(artifact_path) != descriptor.get("sha256"):
            raise CheckpointError(f"{label} 校验失败")
        try:
            content = artifact_path.read_text(encoding="ascii" if storage == "base64" else "utf-8")
        except UnicodeError as exc:
            raise CheckpointError(f"{label} 内容无效") from exc
        if stable_payload_hash(content) != descriptor.get("payload_hash"):
            raise CheckpointError(f"{label} 内容发生了变化")
        return content

    python_output = [
        read_artifact(descriptor, label=f"Python 输出 {index + 1}", storage="text")
        for index, descriptor in enumerate(output_descriptors)
    ]
    python_images = [
        read_artifact(descriptor, label=f"图表 {index + 1}", storage="base64")
        for index, descriptor in enumerate(image_descriptors)
    ]
    for index, image in enumerate(python_images):
        try:
            base64.b64decode(image, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise CheckpointError(f"图表 {index + 1} 内容无效") from exc

    return RestoredCheckpoint(
        manifest=manifest,
        dataframes=dataframes,
        python_output=python_output,
        python_images=python_images,
    )


async def load_runtime_checkpoint(
    project_dir: Path,
    checkpoint: dict[str, Any],
) -> RestoredCheckpoint:
    """Load and integrity-check a checkpoint without trusting database JSON alone."""

    return await asyncio.to_thread(_load_checkpoint_sync, project_dir, checkpoint)


def checkpoint_manifest_is_readable(project_dir: Path, checkpoint: dict[str, Any]) -> bool:
    try:
        _load_checkpoint_sync(project_dir, checkpoint)
        return True
    except Exception:
        # Recovery discovery is a fail-closed status check. Corrupt parquet or
        # Python artifacts must never be advertised to an ordinary user as resumable.
        return False
