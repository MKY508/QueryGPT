"""Schema 和表关系相关模型"""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

# ===== 表结构信息 =====


class ColumnInfo(BaseModel):
    """列信息"""

    name: str
    data_type: str
    is_nullable: bool = True
    is_primary_key: bool = False
    is_foreign_key: bool = False
    default_value: str | None = None


class TableInfo(BaseModel):
    """表信息"""

    name: str
    columns: list[ColumnInfo]
    row_count: int | None = None


class SchemaInfo(BaseModel):
    """数据库 Schema 信息"""

    tables: list[TableInfo]
    suggestions: list["RelationshipSuggestion"] = []


# ===== 表关系 =====


class TableRelationshipBase(BaseModel):
    """表关系基础模型"""

    source_table: str = Field(..., min_length=1, max_length=100)
    source_column: str = Field(..., min_length=1, max_length=100)
    target_table: str = Field(..., min_length=1, max_length=100)
    target_column: str = Field(..., min_length=1, max_length=100)
    relationship_type: Literal["1:1", "1:N", "N:1", "N:M"] = "1:N"
    join_type: Literal["LEFT", "INNER", "RIGHT", "FULL"] = "LEFT"
    description: str | None = None


class TableRelationshipCreate(TableRelationshipBase):
    """创建表关系"""

    pass


class TableRelationshipUpdate(BaseModel):
    """更新表关系"""

    relationship_type: Literal["1:1", "1:N", "N:1", "N:M"] | None = None
    join_type: Literal["LEFT", "INNER", "RIGHT", "FULL"] | None = None
    description: str | None = None
    is_active: bool | None = None


class TableRelationshipResponse(TableRelationshipBase):
    """表关系响应"""

    id: UUID
    connection_id: UUID
    is_active: bool

    class Config:
        from_attributes = True


class TableRelationshipBatchCreate(BaseModel):
    """批量创建表关系"""

    relationships: list[TableRelationshipCreate]


# ===== 关系建议 =====


class RelationshipSuggestion(BaseModel):
    """自动检测的关系建议"""

    source_table: str
    source_column: str
    target_table: str
    target_column: str
    confidence: float = Field(..., ge=0, le=1)
    reason: str


# ===== AI 上下文 =====


class RelationshipContext(BaseModel):
    """关系上下文 - 用于 AI 提示注入"""

    relationships: list[TableRelationshipResponse]

    def to_prompt(self, language: str = "zh") -> str:
        """转换为 AI 提示文本"""
        if not self.relationships:
            return ""

        if language == "zh":
            lines = ["## 表关系定义", "以下是预定义的表关系，生成多表查询时请使用这些 JOIN 条件：", ""]
        else:
            lines = [
                "## Table Relationships",
                "Use these predefined relationships for multi-table queries:",
                "",
            ]

        for rel in self.relationships:
            join_desc = f"{rel.join_type} JOIN"
            lines.append(
                f"- `{rel.source_table}.{rel.source_column}` --[{rel.relationship_type}]--> "
                f"`{rel.target_table}.{rel.target_column}` ({join_desc})"
            )

        return "\n".join(lines)
