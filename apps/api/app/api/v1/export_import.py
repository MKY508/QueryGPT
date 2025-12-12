"""配置导出/导入 API"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.api.deps import get_current_user
from app.api.v1.schema import _get_connection
from app.db import get_db
from app.db.metadata import LayoutRepository
from app.db.tables import SemanticTerm, TableRelationship, User
from app.models import APIResponse
from app.models.export_import import (
    ConfigExport,
    ExportConnectionInfo,
    ExportLayout,
    ExportRelationship,
    ExportSemanticTerm,
    ImportRequest,
    ImportResult,
    ImportResultItem,
)

router = APIRouter(prefix="/connections", tags=["export-import"])


@router.get("/{connection_id}/export", response_model=APIResponse[ConfigExport])
async def export_config(
    connection_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """导出指定连接的所有配置"""
    connection = await _get_connection(connection_id, current_user, db)

    # 2. 获取表关系
    rel_result = await db.execute(
        select(TableRelationship).where(
            TableRelationship.connection_id == connection_id,
            TableRelationship.user_id == current_user.id,
            TableRelationship.is_active.is_(True),
        )
    )
    relationships = rel_result.scalars().all()

    # 3. 获取语义术语
    term_result = await db.execute(
        select(SemanticTerm).where(
            SemanticTerm.connection_id == connection_id,
            SemanticTerm.user_id == current_user.id,
            SemanticTerm.is_active.is_(True),
        )
    )
    terms = term_result.scalars().all()

    # 4. 获取布局（从 SQLite 元数据库）
    layouts = LayoutRepository.list_layouts_full(current_user.id, connection_id)

    # 5. 构建导出数据
    export_data = ConfigExport(
        connection=ExportConnectionInfo(
            name=connection.name,
            driver=connection.driver,
            host=connection.host,
            port=connection.port,
            database=connection.database_name,
            username=connection.username,
        ),
        relationships=[
            ExportRelationship(
                source_table=r.source_table,
                source_column=r.source_column,
                target_table=r.target_table,
                target_column=r.target_column,
                relationship_type=r.relationship_type,
                join_type=r.join_type,
                description=r.description,
            )
            for r in relationships
        ],
        semantic_terms=[
            ExportSemanticTerm(
                term=t.term,
                expression=t.expression,
                term_type=t.term_type,
                description=t.description,
                examples=t.examples or [],
            )
            for t in terms
        ],
        layouts=[
            ExportLayout(
                name=layout["name"],
                is_default=layout["is_default"],
                layout_data=layout["layout_data"],
                visible_tables=layout["visible_tables"],
                zoom=layout.get("zoom", 1.0),
                viewport_x=layout.get("viewport_x", 0.0),
                viewport_y=layout.get("viewport_y", 0.0),
            )
            for layout in layouts
        ],
    )

    return APIResponse.ok(data=export_data)


@router.get("/{connection_id}/export/download")
async def download_config(
    connection_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """下载配置文件"""
    # 复用 export_config 逻辑
    response = await export_config(connection_id, current_user, db)
    export_data = response.data

    # 返回可下载的 JSON 文件
    filename = f"querygpt-config-{export_data.connection.name}-{export_data.exported_at.strftime('%Y%m%d')}.json"

    return JSONResponse(
        content=export_data.model_dump(mode="json"),
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Type": "application/json",
        },
    )


@router.post("/{connection_id}/import/preview", response_model=APIResponse[ImportResult])
async def preview_import(
    connection_id: UUID,
    request: ImportRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """预览导入结果（不实际执行）"""
    return await _process_import(connection_id, request, current_user, db, dry_run=True)


@router.post("/{connection_id}/import", response_model=APIResponse[ImportResult])
async def import_config(
    connection_id: UUID,
    request: ImportRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """导入配置"""
    return await _process_import(connection_id, request, current_user, db, dry_run=False)


async def _process_import(
    connection_id: UUID,
    request: ImportRequest,
    current_user: User,
    db: AsyncSession,
    dry_run: bool = False,
) -> APIResponse[ImportResult]:
    """处理导入逻辑"""
    # 1. 验证连接存在
    await _get_connection(connection_id, current_user, db)

    # 2. 验证版本兼容性
    if request.config.version not in ["1.0"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"不支持的配置版本: {request.config.version}",
        )

    details: list[ImportResultItem] = []
    created, updated, skipped, failed = 0, 0, 0, 0

    # 3. 处理 replace 模式 - 先删除现有数据
    if request.mode == "replace" and not dry_run:
        # 删除现有关系
        await db.execute(
            delete(TableRelationship).where(
                TableRelationship.connection_id == connection_id,
                TableRelationship.user_id == current_user.id,
            )
        )
        # 删除现有语义术语
        await db.execute(
            delete(SemanticTerm).where(
                SemanticTerm.connection_id == connection_id,
                SemanticTerm.user_id == current_user.id,
            )
        )
        # 删除现有布局
        LayoutRepository.delete_all_layouts(current_user.id, connection_id)

    # 4. 导入表关系
    for rel in request.config.relationships:
        try:
            status_result = await _import_relationship(
                db,
                current_user.id,
                connection_id,
                rel,
                request.mode,
                request.conflict_resolution,
                dry_run,
            )
            details.append(
                ImportResultItem(
                    type="relationship",
                    name=f"{rel.source_table}.{rel.source_column} → {rel.target_table}.{rel.target_column}",
                    status=status_result,
                )
            )
            if status_result == "created":
                created += 1
            elif status_result == "updated":
                updated += 1
            elif status_result == "skipped":
                skipped += 1
        except Exception as e:
            failed += 1
            details.append(
                ImportResultItem(
                    type="relationship",
                    name=f"{rel.source_table} → {rel.target_table}",
                    status="failed",
                    message=str(e),
                )
            )

    # 5. 导入语义术语
    for term in request.config.semantic_terms:
        try:
            status_result = await _import_semantic_term(
                db,
                current_user.id,
                connection_id,
                term,
                request.mode,
                request.conflict_resolution,
                dry_run,
            )
            details.append(
                ImportResultItem(
                    type="semantic_term",
                    name=term.term,
                    status=status_result,
                )
            )
            if status_result == "created":
                created += 1
            elif status_result == "updated":
                updated += 1
            elif status_result == "skipped":
                skipped += 1
        except Exception as e:
            failed += 1
            details.append(
                ImportResultItem(
                    type="semantic_term",
                    name=term.term,
                    status="failed",
                    message=str(e),
                )
            )

    # 6. 导入布局
    for layout in request.config.layouts:
        try:
            status_result = _import_layout(
                current_user.id,
                connection_id,
                layout,
                request.mode,
                request.conflict_resolution,
                dry_run,
            )
            details.append(
                ImportResultItem(
                    type="layout",
                    name=layout.name,
                    status=status_result,
                )
            )
            if status_result == "created":
                created += 1
            elif status_result == "updated":
                updated += 1
            elif status_result == "skipped":
                skipped += 1
        except Exception as e:
            failed += 1
            details.append(
                ImportResultItem(
                    type="layout",
                    name=layout.name,
                    status="failed",
                    message=str(e),
                )
            )

    if not dry_run:
        await db.commit()

    return APIResponse.ok(
        data=ImportResult(
            success=failed == 0,
            total=len(details),
            created=created,
            updated=updated,
            skipped=skipped,
            failed=failed,
            details=details,
        ),
        message="预览完成" if dry_run else "导入完成",
    )


async def _import_relationship(
    db: AsyncSession,
    user_id: UUID,
    connection_id: UUID,
    rel: ExportRelationship,
    mode: str,
    conflict_resolution: str,
    dry_run: bool,
) -> str:
    """导入单个表关系"""
    # 检查是否已存在
    existing = await db.execute(
        select(TableRelationship).where(
            TableRelationship.user_id == user_id,
            TableRelationship.connection_id == connection_id,
            TableRelationship.source_table == rel.source_table,
            TableRelationship.source_column == rel.source_column,
            TableRelationship.target_table == rel.target_table,
            TableRelationship.target_column == rel.target_column,
        )
    )
    existing_rel = existing.scalar_one_or_none()

    if existing_rel:
        if conflict_resolution == "skip":
            return "skipped"
        elif conflict_resolution == "overwrite" and not dry_run:
            existing_rel.relationship_type = rel.relationship_type
            existing_rel.join_type = rel.join_type
            existing_rel.description = rel.description
            existing_rel.is_active = True
            return "updated"
        return "skipped"
    else:
        if not dry_run:
            new_rel = TableRelationship(
                user_id=user_id,
                connection_id=connection_id,
                source_table=rel.source_table,
                source_column=rel.source_column,
                target_table=rel.target_table,
                target_column=rel.target_column,
                relationship_type=rel.relationship_type,
                join_type=rel.join_type,
                description=rel.description,
            )
            db.add(new_rel)
        return "created"


async def _import_semantic_term(
    db: AsyncSession,
    user_id: UUID,
    connection_id: UUID,
    term: ExportSemanticTerm,
    mode: str,
    conflict_resolution: str,
    dry_run: bool,
) -> str:
    """导入单个语义术语"""
    existing = await db.execute(
        select(SemanticTerm).where(
            SemanticTerm.user_id == user_id,
            SemanticTerm.connection_id == connection_id,
            SemanticTerm.term == term.term,
        )
    )
    existing_term = existing.scalar_one_or_none()

    if existing_term:
        if conflict_resolution == "skip":
            return "skipped"
        elif conflict_resolution == "overwrite" and not dry_run:
            existing_term.expression = term.expression
            existing_term.term_type = term.term_type
            existing_term.description = term.description
            existing_term.examples = term.examples
            existing_term.is_active = True
            return "updated"
        return "skipped"
    else:
        if not dry_run:
            new_term = SemanticTerm(
                user_id=user_id,
                connection_id=connection_id,
                term=term.term,
                expression=term.expression,
                term_type=term.term_type,
                description=term.description,
                examples=term.examples,
            )
            db.add(new_term)
        return "created"


def _import_layout(
    user_id: UUID,
    connection_id: UUID,
    layout: ExportLayout,
    mode: str,
    conflict_resolution: str,
    dry_run: bool,
) -> str:
    """导入单个布局"""
    # 检查名称是否存在
    name_exists = LayoutRepository.layout_name_exists(user_id, connection_id, layout.name)

    if name_exists:
        if conflict_resolution == "skip":
            return "skipped"
        elif conflict_resolution == "rename":
            # 生成新名称
            new_name = _generate_unique_layout_name(user_id, connection_id, layout.name)
            if not dry_run:
                LayoutRepository.create_layout(
                    user_id=user_id,
                    connection_id=connection_id,
                    name=new_name,
                    is_default=False,  # 重命名的不设为默认
                    layout_data=layout.layout_data,
                    visible_tables=layout.visible_tables,
                )
            return "created"
        elif conflict_resolution == "overwrite":
            if not dry_run:
                # 找到现有布局并更新
                existing = LayoutRepository.get_layout_by_name(user_id, connection_id, layout.name)
                if existing:
                    LayoutRepository.update_layout(
                        layout_id=UUID(existing["id"]),
                        user_id=user_id,
                        connection_id=connection_id,
                        layout_data=layout.layout_data,
                        visible_tables=layout.visible_tables,
                        zoom=layout.zoom,
                        viewport_x=layout.viewport_x,
                        viewport_y=layout.viewport_y,
                    )
            return "updated"
        return "skipped"
    else:
        if not dry_run:
            LayoutRepository.create_layout(
                user_id=user_id,
                connection_id=connection_id,
                name=layout.name,
                is_default=layout.is_default,
                layout_data=layout.layout_data,
                visible_tables=layout.visible_tables,
            )
        return "created"


def _generate_unique_layout_name(user_id: UUID, connection_id: UUID, base_name: str) -> str:
    """生成唯一的布局名称"""
    counter = 1
    new_name = f"{base_name} (导入)"
    while LayoutRepository.layout_name_exists(user_id, connection_id, new_name):
        counter += 1
        new_name = f"{base_name} (导入 {counter})"
    return new_name
