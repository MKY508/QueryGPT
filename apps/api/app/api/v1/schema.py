"""Schema 和表关系 API"""

import re
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import encryptor
from app.db import get_db
from app.db.metadata import LayoutRepository
from app.db.tables import Connection, TableRelationship
from app.models import (
    APIResponse,
    ColumnInfo,
    RelationshipSuggestion,
    SchemaInfo,
    SchemaLayoutCreate,
    SchemaLayoutListItem,
    SchemaLayoutResponse,
    SchemaLayoutUpdate,
    TableInfo,
    TableRelationshipBatchCreate,
    TableRelationshipCreate,
    TableRelationshipResponse,
    TableRelationshipUpdate,
)
from app.services.database import create_database_manager

router = APIRouter(prefix="/schema", tags=["schema"])


async def _get_connection(connection_id: UUID, db: AsyncSession) -> Connection:
    result = await db.execute(select(Connection).where(Connection.id == connection_id))
    connection = result.scalar_one_or_none()
    if not connection:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="数据库连接不存在")
    return connection


def _get_db_config(connection: Connection) -> dict:
    password = None
    if connection.password_encrypted:
        try:
            password = encryptor.decrypt(connection.password_encrypted)
        except Exception:
            password = None
    return {
        "driver": connection.driver,
        "host": connection.host,
        "port": connection.port,
        "user": connection.username,
        "password": password,
        "database": connection.database_name,
    }


def _detect_relationships(tables: list[TableInfo]) -> list[RelationshipSuggestion]:
    suggestions: list[RelationshipSuggestion] = []
    table_names = {table.name.lower(): table.name for table in tables}
    for table in tables:
        for column in table.columns:
            col_lower = column.name.lower()
            if not col_lower.endswith("_id") or col_lower == "id":
                continue
            potential_table = col_lower[:-3]
            matched_table = None
            for variant in (
                potential_table,
                potential_table + "s",
                potential_table + "es",
                potential_table.rstrip("s"),
            ):
                if variant in table_names:
                    matched_table = table_names[variant]
                    break
            if not matched_table or matched_table == table.name:
                continue
            target_table_info = next((item for item in tables if item.name == matched_table), None)
            if target_table_info and any(
                col.name.lower() == "id" for col in target_table_info.columns
            ):
                suggestions.append(
                    RelationshipSuggestion(
                        source_table=table.name,
                        source_column=column.name,
                        target_table=matched_table,
                        target_column="id",
                        confidence=0.9,
                        reason=f"列名 {column.name} 匹配表 {matched_table}",
                    )
                )
    return suggestions


def _parse_schema_info(schema_info: str) -> list[TableInfo]:
    tables: list[TableInfo] = []
    for line in schema_info.strip().split("\n"):
        line = line.strip()
        if not line.startswith("-"):
            continue
        match = re.match(r"-\s*(\w+):\s*(.+)", line)
        if not match:
            continue
        table_name = match.group(1)
        columns: list[ColumnInfo] = []
        for col_match in re.finditer(r"(\w+)\s*\(([^)]+)\)", match.group(2)):
            col_name = col_match.group(1)
            col_type = col_match.group(2)
            columns.append(
                ColumnInfo(
                    name=col_name,
                    data_type=col_type,
                    is_primary_key=col_name.lower() == "id",
                    is_foreign_key=col_name.lower().endswith("_id") and col_name.lower() != "id",
                )
            )
        if columns:
            tables.append(TableInfo(name=table_name, columns=columns))
    return tables


@router.get("/{connection_id}", response_model=APIResponse[SchemaInfo])
async def get_schema(
    connection_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """获取数据库 Schema 信息和关系建议"""
    connection = await _get_connection(connection_id, db)
    db_manager = create_database_manager(_get_db_config(connection))
    schema_info = db_manager.get_schema_info()
    tables = _parse_schema_info(schema_info)
    suggestions = _detect_relationships(tables)
    return APIResponse.ok(data=SchemaInfo(tables=tables, suggestions=suggestions))


@router.get(
    "/{connection_id}/relationships", response_model=APIResponse[list[TableRelationshipResponse]]
)
async def get_relationships(
    connection_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """获取已保存的表关系"""
    await _get_connection(connection_id, db)
    result = await db.execute(
        select(TableRelationship).where(
            TableRelationship.connection_id == connection_id,
            TableRelationship.is_active.is_(True),
        )
    )
    return APIResponse.ok(
        data=[TableRelationshipResponse.model_validate(r) for r in result.scalars().all()]
    )


@router.post(
    "/{connection_id}/relationships", response_model=APIResponse[TableRelationshipResponse]
)
async def create_relationship(
    connection_id: UUID,
    data: TableRelationshipCreate,
    db: AsyncSession = Depends(get_db),
):
    """创建表关系"""
    await _get_connection(connection_id, db)
    relationship = TableRelationship(connection_id=connection_id, **data.model_dump())
    db.add(relationship)
    await db.commit()
    await db.refresh(relationship)
    return APIResponse.ok(
        data=TableRelationshipResponse.model_validate(relationship),
        message="关系创建成功",
    )


@router.post(
    "/{connection_id}/relationships/batch",
    response_model=APIResponse[list[TableRelationshipResponse]],
)
async def create_relationships_batch(
    connection_id: UUID,
    data: TableRelationshipBatchCreate,
    db: AsyncSession = Depends(get_db),
):
    """批量创建表关系"""
    await _get_connection(connection_id, db)
    relationships = [
        TableRelationship(connection_id=connection_id, **item.model_dump())
        for item in data.relationships
    ]
    db.add_all(relationships)
    await db.commit()
    for relationship in relationships:
        await db.refresh(relationship)
    return APIResponse.ok(
        data=[TableRelationshipResponse.model_validate(r) for r in relationships],
        message=f"成功创建 {len(relationships)} 个关系",
    )


@router.put(
    "/relationships/{relationship_id}", response_model=APIResponse[TableRelationshipResponse]
)
async def update_relationship(
    relationship_id: UUID,
    data: TableRelationshipUpdate,
    db: AsyncSession = Depends(get_db),
):
    """更新表关系"""
    result = await db.execute(
        select(TableRelationship).where(TableRelationship.id == relationship_id)
    )
    relationship = result.scalar_one_or_none()
    if not relationship:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="关系不存在")
    for key, value in data.model_dump(exclude_none=True).items():
        setattr(relationship, key, value)
    await db.commit()
    await db.refresh(relationship)
    return APIResponse.ok(
        data=TableRelationshipResponse.model_validate(relationship),
        message="关系更新成功",
    )


@router.delete("/relationships/{relationship_id}", response_model=APIResponse)
async def delete_relationship(
    relationship_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """删除表关系"""
    result = await db.execute(
        delete(TableRelationship).where(TableRelationship.id == relationship_id)
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="关系不存在")
    await db.commit()
    return APIResponse.ok(message="关系删除成功")


@router.get("/{connection_id}/layouts", response_model=APIResponse[list[SchemaLayoutListItem]])
async def get_layouts(
    connection_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """获取所有布局列表"""
    await _get_connection(connection_id, db)
    layouts = LayoutRepository.list_layouts(connection_id)
    return APIResponse.ok(data=[SchemaLayoutListItem(**layout) for layout in layouts])


@router.post("/{connection_id}/layouts", response_model=APIResponse[SchemaLayoutResponse])
async def create_layout(
    connection_id: UUID,
    data: SchemaLayoutCreate,
    db: AsyncSession = Depends(get_db),
):
    """创建新布局"""
    await _get_connection(connection_id, db)
    if LayoutRepository.layout_name_exists(connection_id, data.name):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=f"布局名称 '{data.name}' 已存在"
        )
    layout = LayoutRepository.create_layout(
        connection_id=connection_id,
        name=data.name,
        is_default=data.is_default,
        layout_data=data.layout_data,
        visible_tables=data.visible_tables,
    )
    return APIResponse.ok(data=SchemaLayoutResponse(**layout), message="布局创建成功")


@router.get(
    "/{connection_id}/layouts/{layout_id}", response_model=APIResponse[SchemaLayoutResponse]
)
async def get_layout(
    connection_id: UUID,
    layout_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """获取单个布局"""
    await _get_connection(connection_id, db)
    layout = LayoutRepository.get_layout(layout_id)
    if not layout or layout["connection_id"] != str(connection_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="布局不存在")
    return APIResponse.ok(data=SchemaLayoutResponse(**layout))


@router.put(
    "/{connection_id}/layouts/{layout_id}", response_model=APIResponse[SchemaLayoutResponse]
)
async def update_layout(
    connection_id: UUID,
    layout_id: UUID,
    data: SchemaLayoutUpdate,
    db: AsyncSession = Depends(get_db),
):
    """更新布局"""
    await _get_connection(connection_id, db)
    existing = LayoutRepository.get_layout(layout_id)
    if not existing or existing["connection_id"] != str(connection_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="布局不存在")
    if (
        data.name
        and data.name != existing["name"]
        and LayoutRepository.layout_name_exists(connection_id, data.name, layout_id)
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=f"布局名称 '{data.name}' 已存在"
        )
    layout = LayoutRepository.update_layout(
        layout_id=layout_id,
        connection_id=connection_id,
        **data.model_dump(exclude_none=True),
    )
    return APIResponse.ok(data=SchemaLayoutResponse(**layout), message="布局更新成功")


@router.delete("/{connection_id}/layouts/{layout_id}", response_model=APIResponse)
async def delete_layout(
    connection_id: UUID,
    layout_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """删除布局"""
    await _get_connection(connection_id, db)
    existing = LayoutRepository.get_layout(layout_id)
    if not existing or existing["connection_id"] != str(connection_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="布局不存在")
    LayoutRepository.delete_layout(layout_id)
    return APIResponse.ok(message="布局删除成功")


@router.post(
    "/{connection_id}/layouts/{layout_id}/duplicate",
    response_model=APIResponse[SchemaLayoutResponse],
)
async def duplicate_layout(
    connection_id: UUID,
    layout_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """复制布局"""
    await _get_connection(connection_id, db)
    existing = LayoutRepository.get_layout(layout_id)
    if not existing or existing["connection_id"] != str(connection_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="布局不存在")
    new_layout = LayoutRepository.duplicate_layout(layout_id)
    if not new_layout:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="布局不存在")
    return APIResponse.ok(data=SchemaLayoutResponse(**new_layout), message="布局复制成功")
