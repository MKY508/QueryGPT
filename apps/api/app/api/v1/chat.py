"""聊天 API."""

import asyncio
import json
import shutil
from collections.abc import AsyncGenerator
from contextlib import aclosing
from datetime import UTC, datetime
from typing import Any, cast
from uuid import UUID, uuid4

from anyio import CancelScope
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import desc, func, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.analysis_stream import AnalysisStreamResponse
from app.db import get_db
from app.db.tables import AnalysisRun, Conversation, Message, ProjectDataSource, SemanticEntry
from app.i18n import get_progress_message, t
from app.models import (
    APIResponse,
    BusinessConfirmationCommand,
    BusinessConfirmationResponse,
    ChatStopRequest,
    ChatStreamRequest,
    MessagePaginatedResponse,
    MessageResponse,
    SSEEvent,
)
from app.models.chat import SemanticValidationSelectionItem
from app.services.analysis_checkpoint import ensure_recovery_message, stable_payload_hash
from app.services.app_settings import get_or_create_app_settings, settings_to_dict
from app.services.business_decision_slots import canonicalize_decision_key
from app.services.chat_runtime import (
    ActiveQueryRegistry,
    ChatEventAccumulator,
    ModelSelectionConflictError,
    apply_runtime_snapshot,
    create_user_message,
    get_or_create_conversation,
    mark_conversation_completed,
    mark_conversation_error,
    mark_conversation_exception,
    resolve_chat_request,
)
from app.services.execution import (
    DecisionSlotConflictError,
    ExecutionService,
    _select_decision_slot_entry,
)
from app.services.model_runtime import (
    ModelCredentialError,
    ModelRuntimeConfigurationError,
    categorize_model_exception,
)
from app.services.project_context import resolve_confirmed_ambiguity
from app.services.result_filters import validate_business_rule_strategy_definition
from app.services.semantic_revisions import append_semantic_revision

router = APIRouter()
active_query_registry = ActiveQueryRegistry()


async def _selected_preflight_strategy(
    db: AsyncSession,
    *,
    project_id: UUID,
    key: str,
    selected_option: str,
) -> dict[str, Any] | None:
    """Read an internal strategy from active source profiles, failing on drift."""

    canonical_key = canonicalize_decision_key(key)

    result = await db.execute(
        select(ProjectDataSource)
        .where(
            ProjectDataSource.project_id == project_id,
            ProjectDataSource.status != "superseded",
        )
        .order_by(ProjectDataSource.updated_at.desc())
    )
    matches: list[dict[str, Any]] = []
    for source in result.scalars():
        profile = source.profile_data or {}
        if profile.get("is_current") is False:
            continue
        for ambiguity in profile.get("ambiguities") or []:
            ambiguity_options = [str(option) for option in ambiguity.get("options") or []]
            ambiguity_key = canonicalize_decision_key(
                str(ambiguity.get("key") or ""),
                question=str(ambiguity.get("question") or ""),
                reason=str(ambiguity.get("reason") or ""),
                options=ambiguity_options,
            )
            if ambiguity_key != canonical_key:
                continue
            strategies = ambiguity.get("option_strategies") or {}
            strategy = strategies.get(selected_option) if isinstance(strategies, dict) else None
            if strategy is None:
                continue
            try:
                if isinstance(strategy, dict):
                    strategy = {
                        **strategy,
                        "rule_key": canonicalize_decision_key(str(strategy.get("rule_key") or "")),
                    }
                matches.append(
                    validate_business_rule_strategy_definition(
                        strategy,
                        expected_key=canonical_key,
                        expected_value=selected_option,
                    )
                )
            except ValueError as exc:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="数据中的业务口径策略已变化，请重新预检后再确认",
                ) from exc
    if not matches:
        return None
    canonical = {
        json.dumps(item, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        for item in matches
    }
    if len(canonical) != 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="多个当前数据源给出了不同的业务口径策略，请先核对数据范围",
        )
    return matches[0]


async def _chat_stream_response(
    query: str | None = Query(default=None, min_length=1, max_length=10000, description="查询内容"),
    model: str | None = Query(default=None, description="模型 ID"),
    conversation_id: UUID | None = Query(default=None, description="对话 ID"),
    connection_id: UUID | None = Query(default=None, description="数据库连接 ID"),
    project_id: UUID | None = Query(default=None, description="项目 ID"),
    resume_run_id: UUID | None = Query(default=None, description="恢复的调查 ID"),
    correction_id: UUID | None = Query(default=None, description="本次重查必须使用的报告修正"),
    client_stream_id: str | None = Query(
        default=None,
        min_length=1,
        max_length=200,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
        description="本次流 ID",
    ),
    language: str = Query(default="zh", description="语言"),
    context_rounds: int | None = Query(default=None, ge=1, le=20, description="上下文轮数"),
    db: AsyncSession = Depends(get_db),
    semantic_validation_selection: list[SemanticValidationSelectionItem] | None = None,
) -> Response:
    """SSE 流式聊天 - 单工作区模式."""
    current_conversation_id: UUID | None = conversation_id

    async def event_generator() -> AsyncGenerator[dict[str, str], None]:
        nonlocal current_conversation_id

        settings_record = await get_or_create_app_settings(db)
        settings_data = settings_to_dict(settings_record)
        effective_query = query or ""
        effective_project_id = project_id
        if resume_run_id is not None:
            resume_run = await db.get(AnalysisRun, resume_run_id)
            if resume_run is None:
                yield SSEEvent.error("RESUME_NOT_FOUND", "要恢复的调查不存在").to_sse()
                return
            if conversation_id is not None and resume_run.conversation_id != conversation_id:
                yield SSEEvent.error("RESUME_MISMATCH", "调查不属于当前对话").to_sse()
                return
            if project_id is not None and resume_run.project_id != project_id:
                yield SSEEvent.error("RESUME_MISMATCH", "调查不属于当前项目").to_sse()
                return
            if resume_run.conversation_id is None:
                yield SSEEvent.error("RESUME_MISMATCH", "调查没有可恢复的对话").to_sse()
                return
            current_conversation_id = resume_run.conversation_id
            effective_project_id = resume_run.project_id
            effective_query = resume_run.query
        elif not effective_query:
            yield SSEEvent.error("INVALID_QUERY", "请输入要调查的问题").to_sse()
            return

        conversation = await get_or_create_conversation(
            db,
            conversation_id=current_conversation_id,
            query=effective_query,
            connection_id=connection_id,
        )
        if not conversation:
            yield SSEEvent.error("NOT_FOUND", t("error.not_found", language)).to_sse()
            return

        current_conversation_id = UUID(str(conversation.id))
        user_message = None
        if resume_run_id is None:
            user_message = await create_user_message(
                db,
                conversation_id=current_conversation_id,
                query=effective_query,
            )
        elif active_query_registry.is_active(current_conversation_id):
            yield SSEEvent.error(
                "ANALYSIS_ALREADY_RUNNING",
                "这次调查已经在继续，无需重复启动",
                conversation_id=str(current_conversation_id),
                analysis_run_id=str(resume_run_id),
                project_id=str(effective_project_id) if effective_project_id else None,
            ).to_sse()
            return
        query_key = active_query_registry.start(
            current_conversation_id,
            client_stream_id=client_stream_id,
        )
        stream_attempt_id = uuid4().hex
        accumulator: ChatEventAccumulator | None = None
        assistant_message_persisted = False

        try:
            yield SSEEvent.progress(
                "start",
                get_progress_message("start", language),
                conversation_id=str(current_conversation_id),
            ).to_sse()

            request_config = resolve_chat_request(
                requested_model=model,
                requested_connection_id=connection_id,
                requested_project_id=effective_project_id,
                requested_context_rounds=context_rounds,
                conversation=conversation,
                settings_data=settings_data,
            )
            execution_service = ExecutionService(
                db=db,
                model_name=request_config.model_name,
                connection_id=request_config.connection_id,
                language=language,
                context_rounds=request_config.context_rounds,
                settings_data=settings_data,
                project_id=request_config.project_id,
                semantic_validation_selection=[
                    item.model_dump(mode="json") for item in (semantic_validation_selection or [])
                ],
            )

            runtime_snapshot = await execution_service.get_runtime_snapshot()
            yield SSEEvent.progress(
                "context_ready",
                get_progress_message("context_ready", language),
                conversation_id=str(current_conversation_id),
                execution_context=runtime_snapshot,
            ).to_sse()

            apply_runtime_snapshot(conversation, runtime_snapshot)
            await db.commit()

            accumulator = ChatEventAccumulator(
                original_query=effective_query,
                runtime_snapshot=runtime_snapshot,
            )
            accumulator.metadata["stream_attempt_id"] = stream_attempt_id
            terminal_events: list[SSEEvent] = []
            async with aclosing(
                execution_service.execute_stream(
                    query=effective_query,
                    conversation_id=current_conversation_id,
                    exclude_message_id=UUID(str(user_message.id)) if user_message else None,
                    stop_checker=active_query_registry.stop_checker(query_key),
                    finalization_guard=active_query_registry.finalization_guard(query_key),
                    resume_run_id=resume_run_id,
                    correction_id=correction_id,
                )
            ) as events:
                async for event in events:
                    accumulator.consume(event)
                    if accumulator.has_error:
                        terminal_events = [event]
                        break
                    elif (
                        terminal_events
                        or accumulator.has_result
                        or event.data.get("stage") in {
                            "completed",
                            "waiting_confirmation",
                            "needs_attention",
                        }
                    ):
                        terminal_events.append(event)
                    else:
                        yield event.to_sse()

            if not accumulator.has_result and not accumulator.has_error:
                incomplete_event = SSEEvent.error(
                    "ANALYSIS_INCOMPLETE",
                    "这次调查没有形成可用结论，可以继续或重新调查。",
                    error_category="execution",
                    failed_stage="finalization",
                    conversation_id=str(current_conversation_id),
                    analysis_run_id=accumulator.metadata.get("analysis_run_id"),
                    project_id=accumulator.metadata.get("project_id"),
                    analysis_state="needs_attention",
                    resumable=bool(accumulator.metadata.get("resumable")),
                    execution_context=accumulator.metadata.get("execution_context"),
                    diagnostics=accumulator.metadata.get("diagnostics"),
                )
                accumulator.consume(incomplete_event)
                terminal_events = [incomplete_event]

            if (
                accumulator.has_result
                and not accumulator.has_error
                and not active_query_registry.begin_finalization(query_key)
            ):
                cancelled_event = SSEEvent.error(
                    "CANCELLED",
                    t("error.cancelled", language),
                    error_category="cancelled",
                    failed_stage="finalization",
                    conversation_id=str(current_conversation_id),
                    analysis_run_id=accumulator.metadata.get("analysis_run_id"),
                    project_id=accumulator.metadata.get("project_id"),
                    analysis_state="needs_attention",
                    resumable=bool(accumulator.metadata.get("resumable")),
                )
                accumulator.consume(cancelled_event)
                terminal_events = [cancelled_event]

            metadata = accumulator.build_metadata()
            assistant_message = Message(
                conversation_id=current_conversation_id,
                role="assistant",
                content=accumulator.build_assistant_content(),
                extra_data=metadata,
            )
            db.add(assistant_message)

            if accumulator.has_error:
                mark_conversation_error(
                    conversation,
                    runtime_snapshot=runtime_snapshot,
                    query=effective_query,
                    error_payload=accumulator.error_payload,
                )
            else:
                mark_conversation_completed(
                    conversation,
                    runtime_snapshot=runtime_snapshot,
                    query=effective_query,
                    metadata=metadata,
                )
            # The result and its full message history become durable before
            # publishing terminal events. A disconnect cannot split this commit.
            with CancelScope(shield=True):
                await db.commit()
                assistant_message_persisted = True
                await db.refresh(assistant_message)

            for event in terminal_events:
                yield event.to_sse()
            if not accumulator.has_error:
                yield SSEEvent.done(str(current_conversation_id), str(assistant_message.id)).to_sse()
        except (asyncio.CancelledError, GeneratorExit):
            if assistant_message_persisted:
                raise
            with CancelScope(shield=True):
                mark_conversation_exception(conversation, t("error.cancelled", language))
                run_result = await db.execute(
                    select(AnalysisRun)
                    .where(
                        AnalysisRun.conversation_id == current_conversation_id,
                        AnalysisRun.state == "needs_attention",
                    )
                    .order_by(AnalysisRun.updated_at.desc())
                )
                interrupted_run = run_result.scalars().first()
                if interrupted_run is not None:
                    await ensure_recovery_message(
                        db,
                        interrupted_run,
                        reason="client_disconnected",
                    )
                await db.commit()
            raise
        except ModelSelectionConflictError as exc:
            # The user's question was committed before request resolution. Keep
            # it visible, keep the existing investigation/model binding intact,
            # and explain that switching services starts a new investigation.
            conflict_event = SSEEvent.error(
                "MODEL_SELECTION_CONFLICT",
                str(exc),
                error_category="model_selection_conflict",
                failed_stage="model_selection",
                conversation_id=str(current_conversation_id),
            )
            db.add(
                Message(
                    conversation_id=current_conversation_id,
                    role="assistant",
                    content=str(exc),
                    extra_data={
                        "error": str(exc),
                        "error_code": "MODEL_SELECTION_CONFLICT",
                        "error_category": "model_selection_conflict",
                        "failed_stage": "model_selection",
                        "original_query": effective_query,
                        "stream_attempt_id": stream_attempt_id,
                    },
                )
            )
            await db.commit()
            yield conflict_event.to_sse()
        except (ModelCredentialError, ModelRuntimeConfigurationError) as exc:
            category = categorize_model_exception(exc)
            public_errors = {
                "auth": (
                    "MODEL_AUTH_ERROR",
                    "分析服务需要重新连接，请更新 API Key。",
                ),
                "model_not_found": (
                    "MODEL_NOT_FOUND",
                    "所选分析服务不存在或已停用，请更换服务。",
                ),
                "model_endpoint": (
                    "MODEL_ENDPOINT_ERROR",
                    "分析服务配置不可用，请修复服务设置。",
                ),
            }
            code, message = public_errors.get(
                category,
                ("MODEL_CONFIGURATION_ERROR", "分析服务当前不可用，请更换或修复服务。"),
            )
            failure_event = SSEEvent.error(
                code,
                message,
                error_category=category,
                failed_stage="model_selection",
                conversation_id=str(current_conversation_id),
            )
            db.add(
                Message(
                    conversation_id=current_conversation_id,
                    role="assistant",
                    content=message,
                    extra_data={
                        "error": message,
                        "error_code": code,
                        "error_category": category,
                        "failed_stage": "model_selection",
                        "original_query": effective_query,
                        "stream_attempt_id": stream_attempt_id,
                    },
                )
            )
            conversation.status = "error"
            await db.commit()
            yield failure_event.to_sse()
        except Exception:
            public_message = (
                "The investigation encountered an unexpected problem and did not finish. "
                "Please continue or run it again."
                if language == "en"
                else "调查遇到意外问题，这次没有完成。请继续或重新调查。"
            )
            failure_event = SSEEvent.error(
                "EXECUTION_ERROR",
                public_message,
                error_category="execution",
                failed_stage="stream",
                conversation_id=str(current_conversation_id) if current_conversation_id else None,
                analysis_run_id=(
                    accumulator.metadata.get("analysis_run_id") if accumulator else None
                ),
                project_id=(accumulator.metadata.get("project_id") if accumulator else None),
                analysis_state="needs_attention",
                resumable=bool(accumulator and accumulator.metadata.get("resumable")),
            )
            if accumulator is None:
                accumulator = ChatEventAccumulator(
                    original_query=effective_query,
                    runtime_snapshot={},
                )
                accumulator.metadata["stream_attempt_id"] = stream_attempt_id
            if not accumulator.has_error:
                accumulator.consume(failure_event)

            if not assistant_message_persisted:
                try:
                    await db.rollback()
                    conversation = await db.get(Conversation, current_conversation_id)
                    existing_result = await db.execute(
                        select(Message)
                        .where(
                            Message.conversation_id == current_conversation_id,
                            Message.role == "assistant",
                        )
                        .order_by(Message.created_at.desc())
                        .limit(10)
                    )
                    existing_message = next(
                        (
                            message
                            for message in existing_result.scalars()
                            if (message.extra_data or {}).get("stream_attempt_id")
                            == stream_attempt_id
                        ),
                        None,
                    )
                    failure_metadata = accumulator.build_metadata()
                    if existing_message is None:
                        db.add(
                            Message(
                                conversation_id=current_conversation_id,
                                role="assistant",
                                content=accumulator.build_assistant_content(),
                                extra_data=failure_metadata,
                            )
                        )
                    else:
                        existing_message.content = accumulator.build_assistant_content()
                        existing_message.extra_data = failure_metadata
                    if conversation is not None:
                        mark_conversation_error(
                            conversation,
                            runtime_snapshot=accumulator.runtime_snapshot,
                            query=effective_query,
                            error_payload=accumulator.error_payload,
                        )
                    await db.commit()
                except Exception:
                    await db.rollback()

            if accumulator.error_payload is None or accumulator.error_payload == failure_event.data:
                yield failure_event.to_sse()
        finally:
            active_query_registry.release(query_key)

    return AnalysisStreamResponse(event_generator())


@router.get("/stream")
async def chat_stream(
    query: str | None = Query(default=None, min_length=1, max_length=10000, description="查询内容"),
    model: str | None = Query(default=None, description="模型 ID"),
    conversation_id: UUID | None = Query(default=None, description="对话 ID"),
    connection_id: UUID | None = Query(default=None, description="数据库连接 ID"),
    project_id: UUID | None = Query(default=None, description="项目 ID"),
    resume_run_id: UUID | None = Query(default=None, description="恢复的调查 ID"),
    correction_id: UUID | None = Query(default=None, description="本次重查必须使用的报告修正"),
    client_stream_id: str | None = Query(
        default=None,
        min_length=1,
        max_length=200,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
        description="本次流 ID",
    ),
    language: str = Query(default="zh", description="语言"),
    context_rounds: int | None = Query(default=None, ge=1, le=20, description="上下文轮数"),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Backward-compatible query-string stream without semantic batch identity."""

    return await _chat_stream_response(
        query=query,
        model=model,
        conversation_id=conversation_id,
        connection_id=connection_id,
        project_id=project_id,
        resume_run_id=resume_run_id,
        correction_id=correction_id,
        client_stream_id=client_stream_id,
        language=language,
        context_rounds=context_rounds,
        db=db,
    )


@router.post("/stream")
async def chat_stream_post(
    request: ChatStreamRequest,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Stream a private analysis request from a JSON body."""

    return await _chat_stream_response(
        query=request.query,
        model=request.model,
        conversation_id=request.conversation_id,
        connection_id=request.connection_id,
        project_id=request.project_id,
        resume_run_id=request.resume_run_id,
        correction_id=request.correction_id,
        client_stream_id=request.client_stream_id,
        language=request.language,
        context_rounds=request.context_rounds,
        db=db,
        semantic_validation_selection=request.semantic_validation_selection,
    )


@router.post("/stop", response_model=APIResponse[dict[str, Any]])
async def stop_chat(request: ChatStopRequest) -> APIResponse[dict[str, Any]]:
    """停止正在执行的查询."""
    if active_query_registry.stop(
        request.conversation_id,
        client_stream_id=request.client_stream_id,
    ):
        return APIResponse.ok(
            data={"stopped": True},
            message=t("stop.sent", "zh"),
        )

    return APIResponse.ok(
        data={"stopped": False},
        message=t("stop.not_found", "zh"),
    )


@router.post("/confirm", response_model=APIResponse[BusinessConfirmationResponse])
async def confirm_business_definition(
    request: BusinessConfirmationCommand,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[BusinessConfirmationResponse]:
    """Persist a typed business answer and prepare the same run for continuation."""

    run_result = await db.execute(
        select(AnalysisRun).where(AnalysisRun.id == request.analysis_run_id).with_for_update()
    )
    run = run_result.scalar_one_or_none()
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="调查记录不存在")
    run_id = UUID(str(run.id))
    if run.conversation_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="这次调查没有可继续的对话",
        )
    if run.state != "waiting_confirmation":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="这次调查当前不在等待业务确认",
        )

    confirmation = (run.report or {}).get("confirmation")
    if not isinstance(confirmation, dict):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="这次调查没有有效的业务确认问题",
        )
    report_key = str(confirmation.get("key") or "").strip()
    options = [str(option) for option in confirmation.get("options") or []]
    expected_key = canonicalize_decision_key(
        report_key,
        question=str(confirmation.get("question") or ""),
        reason=str(confirmation.get("reason") or ""),
        options=options,
    )
    request_key = str(request.key or "").strip()
    request_matches_report = request_key == report_key or (
        canonicalize_decision_key(request_key) == expected_key
    )
    if not report_key or not request_key or not request_matches_report:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="确认问题已变更，请刷新后重新选择",
        )
    if request.selected_option not in options:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="选中的答案不属于当前可用选项",
        )

    checkpoint = dict(run.checkpoint or {})
    existing_receipt = checkpoint.get("confirmation_receipt")
    if run.stage == "confirmation_received" and isinstance(existing_receipt, dict):
        receipt_key = str(existing_receipt.get("key") or "").strip()
        if (
            (receipt_key == report_key or canonicalize_decision_key(receipt_key) == expected_key)
            and existing_receipt.get("selected_value") == request.selected_option
            and checkpoint.get("confirmation_receipt_status") == "pending"
        ):
            return APIResponse.ok(
                data=BusinessConfirmationResponse(
                    analysis_run_id=run_id,
                    resume_run_id=run_id,
                    project_id=run.project_id,
                    conversation_id=run.conversation_id,
                    key=expected_key,
                    selected_option=request.selected_option,
                ),
                message="口径已记录，可继续调查",
            )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="这次调查已收到另一个确认结果",
        )

    semantic_result = await db.execute(
        select(SemanticEntry).where(SemanticEntry.project_id == run.project_id).with_for_update()
    )
    semantic_entries = list(semantic_result.scalars())
    try:
        entry, durable_entries = _select_decision_slot_entry(
            semantic_entries,
            expected_key,
            allow_reactivation=True,
        )
    except DecisionSlotConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc
    entry_is_current_lock = bool(
        entry is not None
        and entry.state == "locked"
        and entry.is_active
        and entry.validity != "stale"
    )
    if entry_is_current_lock and entry is not None and entry.value != request.selected_option:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="该业务定义已锁定，本次选择与锁定值冲突",
        )

    from app.api.v1.projects import (
        apply_excel_sheet_selection_decision,
        parse_excel_sheet_selection_key,
    )

    sheet_source_id = parse_excel_sheet_selection_key(expected_key)
    if expected_key.startswith("excel_sheet_selection") and sheet_source_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="工作表确认缺少数据源范围，请重新预检后再选择",
        )

    claim_failed = False
    try:
        claim = cast(
            CursorResult[Any],
            await db.execute(
                update(AnalysisRun)
                .where(
                    AnalysisRun.id == run.id,
                    AnalysisRun.state == "waiting_confirmation",
                    AnalysisRun.stage == "waiting_confirmation",
                )
                .values(
                    stage="confirmation_processing",
                    checkpoint={
                        **checkpoint,
                        "confirmation_claim": {
                            "id": uuid4().hex,
                            "key": expected_key,
                            "selected_value": request.selected_option,
                            "claimed_at": datetime.now(UTC).isoformat(),
                        },
                    },
                )
                .execution_options(synchronize_session=False)
            ),
        )
        claim_failed = claim.rowcount != 1
    except OperationalError:
        claim_failed = True
    if claim_failed:
        await db.rollback()
        refreshed_result = await db.execute(
            select(AnalysisRun).where(AnalysisRun.id == request.analysis_run_id)
        )
        refreshed = refreshed_result.scalar_one_or_none()
        refreshed_checkpoint = dict(refreshed.checkpoint or {}) if refreshed is not None else {}
        refreshed_receipt = refreshed_checkpoint.get("confirmation_receipt")
        refreshed_conversation_id = refreshed.conversation_id if refreshed is not None else None
        if (
            refreshed is not None
            and refreshed_conversation_id is not None
            and refreshed.state == "waiting_confirmation"
            and refreshed.stage == "confirmation_received"
            and isinstance(refreshed_receipt, dict)
            and canonicalize_decision_key(str(refreshed_receipt.get("key") or "")) == expected_key
            and refreshed_receipt.get("selected_value") == request.selected_option
            and refreshed_checkpoint.get("confirmation_receipt_status") == "pending"
        ):
            refreshed_run_id = UUID(str(refreshed.id))
            return APIResponse.ok(
                data=BusinessConfirmationResponse(
                    analysis_run_id=refreshed_run_id,
                    resume_run_id=refreshed_run_id,
                    project_id=refreshed.project_id,
                    conversation_id=refreshed_conversation_id,
                    key=expected_key,
                    selected_option=request.selected_option,
                ),
                message="口径已记录，可继续调查",
            )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="这次调查正在处理另一个确认结果，请刷新后重试",
        )
    await db.refresh(run)

    decision_receipt: dict[str, Any] | None = None
    cleanup_dir: str | None = None
    try:
        if sheet_source_id is not None:
            decision_receipt = await apply_excel_sheet_selection_decision(
                db,
                project_id=run.project_id,
                source_id=sheet_source_id,
                confirmation_key=expected_key,
                selected_sheet=request.selected_option,
            )
            cleanup_dir = str(decision_receipt["cleanup_dir"])
            selected_strategy = None
            entry_type = "cleaning_rule"
        else:
            selected_strategy = await _selected_preflight_strategy(
                db,
                project_id=run.project_id,
                key=expected_key,
                selected_option=request.selected_option,
            )
            entry_type = "business_rule"

        if len(durable_entries) > 1 and any(
            item.value != request.selected_option or item.definition != selected_strategy
            for item in durable_entries
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="同一业务问题存在多条历史定义，不能只改写其中一条",
            )

        recorded_at = datetime.now(UTC).isoformat()
        evidence = {
            "kind": "explicit_confirmation",
            "question": str(confirmation.get("question") or ""),
            "answer": request.selected_option,
            "analysis_run_id": str(run.id),
            "recorded_at": recorded_at,
        }
        if decision_receipt is not None:
            evidence.update(
                {
                    "decision_kind": "excel_sheet_selection",
                    "source_id": decision_receipt["source_id"],
                    "recipe_id": decision_receipt["recipe_id"],
                }
            )
        execution_state = (
            "verified"
            if decision_receipt is not None
            else "needs_validation"
            if selected_strategy is not None
            else "definition_only"
        )
        execution_details = {
            "version": 1,
            "status": execution_state,
            "summary": (
                "这项数据选择已经应用。"
                if execution_state == "verified"
                else "执行方式已绑定，等待本次调查验证。"
                if execution_state == "needs_validation"
                else "已记住业务定义；当前没有可安全自动执行的方式。"
            ),
        }
        if entry is None:
            entry = SemanticEntry(
                project_id=run.project_id,
                key=expected_key,
                value=request.selected_option,
                entry_type=entry_type,
                state="confirmed",
                confidence=1,
                definition=selected_strategy,
                validity="active" if selected_strategy or decision_receipt else "unverified",
                execution_state=execution_state,
                execution_details=execution_details,
                evidence=[evidence],
                source="user",
            )
            db.add(entry)
            await db.flush()
            await append_semantic_revision(
                db,
                entry,
                mutation_kind="explicit_confirmation",
                actor_source="user",
                reason="用户确认影响结论的业务口径",
            )
        elif not entry_is_current_lock:
            previous_revision_id = entry.active_revision_id
            if entry.key != expected_key and not any(
                item.id != entry.id and item.key == expected_key for item in semantic_entries
            ):
                entry.key = expected_key
            entry.value = request.selected_option
            entry.entry_type = entry_type
            entry.state = "confirmed"
            entry.confidence = 1
            entry.definition = selected_strategy
            entry.validity = "active" if selected_strategy or decision_receipt else "unverified"
            entry.execution_state = execution_state
            entry.execution_details = execution_details
            entry.evidence = [*(entry.evidence or []), evidence]
            entry.source = "user"
            entry.is_active = True
            await append_semantic_revision(
                db,
                entry,
                mutation_kind="explicit_confirmation",
                actor_source="user",
                reason="用户确认影响结论的业务口径",
                expected_active_revision_id=previous_revision_id,
            )

        receipt = {
            "key": expected_key,
            "value": request.selected_option,
            "selected_value": request.selected_option,
            "semantic_entry_id": str(entry.id),
            "active_revision_id": (
                str(entry.active_revision_id) if entry.active_revision_id else None
            ),
            "definition_hash": stable_payload_hash(entry.definition),
            "value_hash": stable_payload_hash(entry.value),
            "applied": True,
            "conflict": False,
            "task_query": run.query,
            "recorded_at": recorded_at,
            **(
                {
                    "decision_kind": "excel_sheet_selection",
                    "source_id": decision_receipt["source_id"],
                    "recipe_id": decision_receipt["recipe_id"],
                }
                if decision_receipt is not None
                else {}
            ),
        }
        db.add(
            Message(
                conversation_id=run.conversation_id,
                role="user",
                content=request.selected_option,
                extra_data={
                    "kind": "business_confirmation",
                    "analysis_run_id": str(run.id),
                    "project_id": str(run.project_id),
                    "confirmation_key": expected_key,
                    "selected_option": request.selected_option,
                },
            )
        )
        await resolve_confirmed_ambiguity(db, run.project_id, expected_key)
        run.stage = "confirmation_received"
        run.checkpoint = {
            **checkpoint,
            "confirmation_receipt": receipt,
            "confirmation_receipt_status": "pending",
            "resumable": True,
            "reason": "confirmation_received",
        }
        run.error = None
        await db.commit()
    except BaseException:
        try:
            await db.rollback()
        finally:
            if cleanup_dir is not None:
                shutil.rmtree(cleanup_dir, ignore_errors=True)
        raise
    await db.refresh(run)
    return APIResponse.ok(
        data=BusinessConfirmationResponse(
            analysis_run_id=run_id,
            resume_run_id=run_id,
            project_id=run.project_id,
            conversation_id=run.conversation_id,
            key=expected_key,
            selected_option=request.selected_option,
        ),
        message="口径已记录，可继续调查",
    )


@router.get("/{conversation_id}/messages", response_model=APIResponse[MessagePaginatedResponse])
async def list_messages(
    conversation_id: str,
    cursor: str | None = Query(None, description="游标（ISO datetime），获取此之前的消息"),
    limit: int = Query(50, ge=1, le=100, description="返回数量"),
    db: AsyncSession = Depends(get_db),
) -> APIResponse[MessagePaginatedResponse] | APIResponse[None]:
    """
    分页获取对话消息。

    Args:
        conversation_id: 对话 UUID
        cursor: ISO datetime 格式的游标，用于获取更早的消息。为 null 时获取最新消息。
        limit: 返回消息数量（1-100，默认 50）

    Returns:
        消息分页响应，包含 items、total 和 next_cursor
    """
    try:
        conv_id = UUID(conversation_id)
    except ValueError:
        return APIResponse.fail(
            code="INVALID_UUID",
            message="无效的对话 ID 格式",
        )

    # 验证对话存在
    conv_query = select(Conversation).where(Conversation.id == conv_id)
    result = await db.execute(conv_query)
    conversation = result.scalar_one_or_none()
    if not conversation:
        return APIResponse.fail(
            code="NOT_FOUND",
            message="对话不存在",
        )

    # 统计总消息数
    count_query = select(func.count(Message.id)).where(Message.conversation_id == conv_id)
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # 构建消息查询
    messages_query = select(Message).where(Message.conversation_id == conv_id)

    # 应用游标过滤（获取此时间之前的消息，用于向后翻页）
    if cursor:
        try:
            cursor_dt = datetime.fromisoformat(cursor.replace("Z", "+00:00"))
            messages_query = messages_query.where(Message.created_at < cursor_dt)
        except ValueError:
            return APIResponse.fail(
                code="INVALID_CURSOR",
                message="无效的游标格式，应为 ISO datetime",
            )

    # 按创建时间降序排列（最新的在前），再加载 limit+1 个来判断是否有下一页
    messages_query = messages_query.order_by(desc(Message.created_at)).limit(limit + 1)

    result = await db.execute(messages_query)
    messages = list(result.scalars())

    # 判断是否有更多消息
    next_cursor = None
    if len(messages) > limit:
        # 有更多消息，截取到 limit 个，设置 next_cursor 为最后一条消息的时间
        messages = messages[:limit]
        next_cursor = messages[-1].created_at.isoformat()

    # 将 Message 对象转换为 MessageResponse（from_attributes + model_validator 处理字段映射）
    message_responses = [MessageResponse.model_validate(msg) for msg in messages]

    return APIResponse.ok(
        data=MessagePaginatedResponse(
            items=message_responses,
            total=total,
            next_cursor=next_cursor,
        )
    )
