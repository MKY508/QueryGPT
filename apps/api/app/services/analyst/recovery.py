"""Validate a saved investigation before installing isolated state into a fresh session."""

from __future__ import annotations

import copy
from typing import Any, Literal, cast

from pydantic_ai import ModelRetry

from app.services.analyst.confirmation import _restore_safe_knowledge_proposals
from app.services.analyst.python_tools import _build_result_chart_code
from app.services.analyst.relationships import (
    _candidate_relationship_by_key,
    _current_runtime_relationship,
)
from app.services.analyst.result_store import _ensure_result_budget
from app.services.analyst.session import AnalystSession
from app.services.business_decision_slots import canonicalize_decision_key
from app.services.checkpoint_contract import (
    CheckpointDriftError,
    RestoredCheckpoint,
    stable_payload_hash,
)
from app.services.metric_formula import (
    aggregate_decimal_metric,
    apply_metric_formula,
    validate_metric_formula_action,
)
from app.services.result_filters import resolve_confirmed_rule_strategy


def _require_replay_hash(step: dict[str, Any], key: str, value: Any) -> None:
    expected = str(step.get(key) or "")
    actual = stable_payload_hash(value)
    if not expected or expected != actual:
        raise CheckpointDriftError(
            f"恢复步骤 {step.get('op') or 'unknown'} 的结果与暂停时不一致，不能继续混用。"
        )


class _CheckpointReplay:
    def __init__(self, session: AnalystSession, checkpoint: RestoredCheckpoint):
        self.session = session
        self.manifest = checkpoint.manifest
        self.saved_dataframes = checkpoint.dataframes
        self.saved_python_output = checkpoint.python_output
        self.saved_python_images = checkpoint.python_images
        self.available_results: set[str] = set()
        self.replayed_validations: set[str] = set()
        self.final_hashes: dict[str, str] = {}
        self.next_output_index = 0
        self.next_image_index = 0

    def validate(self) -> set[str]:
        if not isinstance(self.manifest, dict) or self.manifest.get("resumable") is False:
            raise CheckpointDriftError("调查检查点不可恢复")
        journal = self.manifest.get("replay_journal")
        if (
            not isinstance(journal, list)
            or not journal
            or any(not isinstance(step, dict) for step in journal)
        ):
            raise CheckpointDriftError("调查检查点没有可恢复的安全工具步骤")
        if not isinstance(self.saved_dataframes, dict) or any(
            not isinstance(name, str)
            or not isinstance(rows, list)
            or any(not isinstance(row, dict) for row in rows)
            for name, rows in self.saved_dataframes.items()
        ):
            raise CheckpointDriftError("调查检查点的中间结果无效")
        metadata = self.manifest.get("result_metadata") or {}
        history = self.manifest.get("tool_history") or []
        proposals = self.manifest.get("knowledge_proposals") or []
        if (
            not isinstance(metadata, dict)
            or any(not isinstance(value, dict) for value in metadata.values())
            or not isinstance(history, list)
            or any(not isinstance(step, dict) for step in history)
            or not isinstance(proposals, list)
        ):
            raise CheckpointDriftError("调查检查点的会话记录无效")
        if (
            not isinstance(self.saved_python_output, list)
            or not isinstance(self.saved_python_images, list)
            or any(
                not isinstance(value, str)
                for value in [*self.saved_python_output, *self.saved_python_images]
            )
        ):
            raise CheckpointDriftError("调查检查点的图表产物无效")
        if (
            self.saved_python_output
            or self.saved_python_images
            or any(step.get("op") == "render_chart" for step in journal)
        ):
            self.session.policy.require_python("Python 图表恢复")
        try:
            _ensure_result_budget(self.session, self.saved_dataframes)
        except ModelRetry as exc:
            raise CheckpointDriftError("检查点保留的中间结果超过当前运行预算") from exc
        handlers = {
            "query_source_data": self._query,
            "query_database": self._query,
            "query_project_files": self._query,
            "join_results": self._join,
            "aggregate_result": self._aggregate,
            "apply_confirmed_rule": self._rule,
            "validate_result": self._result_validation,
            "validate_relationship": self._relationship_validation,
            "render_chart": self._chart,
        }
        for step in journal:
            operation = str(step.get("op") or "")
            handler = handlers.get(operation)
            if handler is None:
                raise CheckpointDriftError(
                    f"检查点包含不可恢复的工具步骤：{operation or 'unknown'}"
                )
            handler(step)
            result_name = str(step.get("result_name") or "")
            if operation in {
                "query_source_data",
                "query_database",
                "query_project_files",
                "join_results",
                "aggregate_result",
                "apply_confirmed_rule",
            }:
                if not result_name:
                    raise CheckpointDriftError("工具检查点缺少结果名称")
                self.available_results.add(result_name)
                self.final_hashes[result_name] = str(step.get("result_hash") or "")
                self.replayed_validations.discard(result_name)

        if self.available_results != set(self.saved_dataframes):
            raise CheckpointDriftError("检查点清单和中间结果文件不一致")
        for name, expected_hash in self.final_hashes.items():
            if (
                not expected_hash
                or stable_payload_hash(self.saved_dataframes[name]) != expected_hash
            ):
                raise CheckpointDriftError(f"中间结果 {name} 与工具检查点不一致")
        if self.next_output_index != len(self.saved_python_output) or self.next_image_index != len(
            self.saved_python_images
        ):
            raise CheckpointDriftError("检查点包含没有安全工具记录的图表产物")

        return self.replayed_validations

    def _query(self, step: dict[str, Any]) -> None:
        if not step.get("planned_sql") or not step.get("result_hash"):
            raise CheckpointDriftError("查询检查点缺少实际 SQL 或结果指纹")

    def _join(self, step: dict[str, Any]) -> None:
        if not {str(step.get("left_result")), str(step.get("right_result"))}.issubset(
            self.available_results
        ):
            raise CheckpointDriftError("关联检查点缺少上游结果")
        if not step.get("how") or not step.get("normalization"):
            raise CheckpointDriftError("关联检查点参数不完整")
        relationship_key = str(step.get("relationship_key") or "")
        candidate_key = str(step.get("candidate_relationship_key") or "")
        current_relationship = (
            _current_runtime_relationship(self.session.project, relationship_key)
            if relationship_key
            else _candidate_relationship_by_key(self.session.project, candidate_key)
            if candidate_key
            else None
        )
        if (relationship_key or candidate_key) and (
            current_relationship is None
            or str(current_relationship.get("definition_hash") or "")
            != str(step.get("definition_hash") or "")
        ):
            raise CheckpointDriftError("关联检查点对应的当前关系定义已经变化")

    def _aggregate(self, step: dict[str, Any]) -> None:
        source_result = str(step.get("source_result") or "")
        if source_result not in self.available_results:
            raise CheckpointDriftError("汇总检查点缺少上游结果")
        if step.get("required_metric_action_kind") == "metric_formula" and step.get(
            "metric_policy_satisfied"
        ):
            required_column = str(step.get("required_metric_column") or "")
            definition_hash = str(step.get("required_metric_definition_hash") or "")
            metric_input_column = str(step.get("metric_input_column") or "")
            source_metric_metadata = (self.manifest.get("result_metadata") or {}).get(
                source_result, {}
            )
            if (
                not required_column
                or not definition_hash
                or definition_hash
                != str(source_metric_metadata.get("required_metric_definition_hash") or "")
                or not metric_input_column
                or metric_input_column
                != str(
                    source_metric_metadata.get("metric_output_column")
                    or source_metric_metadata.get("required_metric_column")
                    or ""
                )
                or step.get("value_column") != metric_input_column
                or step.get("operation") not in {"sum", "mean", "min", "max"}
                or step.get("numeric_backend") != "decimal"
                or step.get("metric_output_column") != step.get("output_column")
            ):
                raise CheckpointDriftError("指标公式汇总检查点参数不完整")
            try:
                raw_null_policy = str(
                    (step.get("decimal_aggregate_evidence") or {}).get("null_policy") or "propagate"
                )
                if raw_null_policy not in {"propagate", "zero", "error"}:
                    raise ValueError("指标公式汇总空值策略无效")
                replayed_rows, replayed_evidence = aggregate_decimal_metric(
                    self.saved_dataframes.get(source_result) or [],
                    value_column=metric_input_column,
                    operation=step["operation"],
                    group_by=step.get("group_by") or [],
                    output_column=str(step.get("output_column") or ""),
                    limit=int(step.get("limit") or 5000),
                    null_policy=cast(Literal["propagate", "zero", "error"], raw_null_policy),
                )
            except (TypeError, ValueError) as exc:
                raise CheckpointDriftError("指标公式汇总检查点无法用 Decimal 安全重放") from exc
            _require_replay_hash(step, "result_hash", replayed_rows)
            if replayed_rows and not all(
                str(step.get("metric_output_column") or "") in row for row in replayed_rows
            ):
                raise CheckpointDriftError("指标公式汇总结果丢失派生指标列")
            if stable_payload_hash(replayed_evidence) != stable_payload_hash(
                step.get("decimal_aggregate_evidence") or {}
            ):
                raise CheckpointDriftError("指标公式汇总证据与暂停时不一致")

    def _rule(self, step: dict[str, Any]) -> None:
        source_result = str(step.get("source_result") or "")
        if source_result not in self.available_results:
            raise CheckpointDriftError("业务规则检查点缺少上游结果")
        action_kind = str(step.get("action_kind") or "value_filter")
        semantic_entry_id = str(step.get("semantic_entry_id") or "")
        rule_key = str(step.get("rule_key") or "")
        canonical_rule_key = canonicalize_decision_key(rule_key)
        current_entry = next(
            (
                item
                for item in self.session.project.confirmed_knowledge
                if (semantic_entry_id and str(item.get("id") or "") == semantic_entry_id)
                or (
                    not semantic_entry_id
                    and canonicalize_decision_key(str(item.get("key") or "")) == canonical_rule_key
                )
            ),
            None,
        )
        current_definition = current_entry.get("definition") if current_entry is not None else None
        if not isinstance(current_definition, dict) or stable_payload_hash(
            current_definition
        ) != str(step.get("definition_hash") or ""):
            raise CheckpointDriftError("业务规则检查点对应的当前语义定义已经变化，不能继续混用。")
        try:
            current_strategy = resolve_confirmed_rule_strategy(
                current_entry,
                self.saved_dataframes.get(source_result) or [],
                source_refs=(
                    (self.manifest.get("result_metadata") or {})
                    .get(source_result, {})
                    .get("source_refs", [])
                ),
                source_catalog=self.session.project.sources,
            )
        except ValueError as exc:
            raise CheckpointDriftError("业务规则检查点与当前数据源或语义定义不一致。") from exc
        current_action = current_strategy.get("action") or {}
        if str(current_action.get("kind") or "") != action_kind:
            raise CheckpointDriftError("业务规则检查点动作类型已经变化")
        if action_kind == "metric_formula":
            try:
                current_formula = validate_metric_formula_action(current_action)
                journal_formula = validate_metric_formula_action(step.get("action"))
            except ValueError as exc:
                raise CheckpointDriftError("指标公式检查点参数不完整") from exc
            has_valid_action = stable_payload_hash(current_formula) == stable_payload_hash(
                journal_formula
            )
            if has_valid_action:
                try:
                    replayed_rows, replayed_evidence = apply_metric_formula(
                        self.saved_dataframes.get(source_result) or [],
                        rule_key=rule_key,
                        rule_value=str(step.get("rule_value") or ""),
                        action=current_formula,
                    )
                except ValueError as exc:
                    raise CheckpointDriftError("指标公式检查点无法按当前定义安全重放") from exc
                _require_replay_hash(step, "input_hash", self.saved_dataframes[source_result])
                _require_replay_hash(step, "result_hash", replayed_rows)
                if replayed_evidence.get("formula_hash") != step.get("formula_hash"):
                    raise CheckpointDriftError("指标公式检查点定义指纹不一致")
        else:
            has_valid_action = action_kind in {"identity", "metric_column"} or (
                action_kind == "value_filter"
                and step.get("operator") in {"include", "exclude"}
                and bool(step.get("values"))
            )
            has_valid_action = has_valid_action and str(current_action.get("column") or "") == str(
                step.get("column") or ""
            )
        if not step.get("rule_key") or not step.get("column") or not has_valid_action:
            raise CheckpointDriftError("业务规则检查点参数不完整")

    def _result_validation(self, step: dict[str, Any]) -> None:
        validated_name = str(step.get("result_name") or "")
        if validated_name not in self.available_results:
            raise CheckpointDriftError("校验检查点缺少目标结果")
        if str(step.get("result_hash") or "") != self.final_hashes.get(validated_name):
            raise CheckpointDriftError("校验检查点与当时的结果不一致")
        self.replayed_validations.add(validated_name)

    def _relationship_validation(self, step: dict[str, Any]) -> None:
        if not {str(step.get("left_result")), str(step.get("right_result"))}.issubset(
            self.available_results
        ):
            raise CheckpointDriftError("关联校验检查点缺少上游结果")
        relationship_key = str(step.get("relationship_key") or "")
        candidate_key = str(step.get("candidate_relationship_key") or "")
        current_relationship = (
            _current_runtime_relationship(self.session.project, relationship_key)
            if relationship_key
            else _candidate_relationship_by_key(self.session.project, candidate_key)
            if candidate_key
            else None
        )
        if (relationship_key or candidate_key) and (
            current_relationship is None
            or str(current_relationship.get("definition_hash") or "")
            != str(step.get("definition_hash") or "")
        ):
            raise CheckpointDriftError("关联校验对应的当前关系定义已经变化")

    def _chart(self, step: dict[str, Any]) -> None:
        chart_result = str(step.get("result_name") or "")
        if chart_result not in self.available_results or chart_result not in self.saved_dataframes:
            raise CheckpointDriftError("图表检查点缺少上游结果")
        if not step.get("purpose") or not step.get("x") or not step.get("title"):
            raise CheckpointDriftError("图表检查点参数不完整")
        chart_type = str(step.get("chart_type") or "")
        if chart_type not in {
            "heatmap",
            "bar",
            "line",
            "scatter",
            "histogram",
            "box",
        }:
            raise CheckpointDriftError("图表检查点类型无效")
        _require_replay_hash(
            step,
            "input_hash",
            self.saved_dataframes[chart_result],
        )
        try:
            generated_code = _build_result_chart_code(
                self.saved_dataframes[chart_result],
                chart_type=chart_type,
                x=str(step.get("x") or ""),
                y=step.get("y"),
                value=step.get("value"),
                color=step.get("color"),
                title=str(step.get("title") or ""),
            )
        except (KeyError, ValueError) as exc:
            raise CheckpointDriftError("图表检查点与当前数据不一致") from exc
        _require_replay_hash(step, "code_hash", generated_code)

        output_index = step.get("output_index")
        image_start = step.get("image_start")
        image_count = step.get("image_count")
        if (
            type(output_index) is not int
            or type(image_start) is not int
            or type(image_count) is not int
            or image_count <= 0
            or output_index != self.next_output_index
            or image_start != self.next_image_index
        ):
            raise CheckpointDriftError("图表检查点的产物顺序无效")
        if output_index >= len(self.saved_python_output):
            raise CheckpointDriftError("图表检查点缺少输出产物")
        chart_images = self.saved_python_images[image_start : image_start + image_count]
        if len(chart_images) != image_count:
            raise CheckpointDriftError("图表检查点缺少图像产物")
        _require_replay_hash(
            step,
            "output_hash",
            self.saved_python_output[output_index],
        )
        expected_image_hashes = step.get("image_hashes")
        actual_image_hashes = [stable_payload_hash(image) for image in chart_images]
        if expected_image_hashes != actual_image_hashes:
            raise CheckpointDriftError("图表检查点的图像与暂停时不一致")
        self.next_output_index += 1
        self.next_image_index += image_count


def restore_session_checkpoint(session: AnalystSession, checkpoint: RestoredCheckpoint) -> None:
    """Install only a fully validated snapshot, without mutating or sharing its containers."""
    if any(
        (
            session.dataframes,
            session.result_metadata,
            session.tool_history,
            session.replay_journal,
            session.python_output,
            session.python_images,
            session.knowledge_proposals,
            session.validated_results,
            session.protected_results,
            session.semantic_scope_receipts,
        )
    ):
        raise CheckpointDriftError("调查已经产生新状态，不能再装入旧检查点")
    validated = _CheckpointReplay(session, checkpoint).validate()
    # Build everything before the first assignment. Failed validation or copying
    # leaves both the saved checkpoint and the destination session untouched.
    restored = copy.deepcopy(
        {
            "dataframes": checkpoint.dataframes,
            "result_metadata": checkpoint.manifest.get("result_metadata") or {},
            "tool_history": checkpoint.manifest.get("tool_history") or [],
            "replay_journal": checkpoint.manifest["replay_journal"],
            "knowledge_proposals": _restore_safe_knowledge_proposals(
                checkpoint.manifest.get("knowledge_proposals") or []
            ),
            "python_output": checkpoint.python_output,
            "python_images": checkpoint.python_images,
        }
    )
    session.dataframes = restored["dataframes"]
    session.result_metadata = restored["result_metadata"]
    session.tool_history = restored["tool_history"]
    session.replay_journal = restored["replay_journal"]
    session.knowledge_proposals = restored["knowledge_proposals"]
    session.python_output = restored["python_output"]
    session.python_images = restored["python_images"]
    session.validated_results = validated
