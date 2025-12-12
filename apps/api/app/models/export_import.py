"""配置导出/导入相关的 Pydantic 模型"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ExportConnectionInfo(BaseModel):
    """导出的连接信息（不含敏感数据）"""

    name: str
    driver: Literal["mysql", "postgresql", "sqlite"]
    host: str | None = None
    port: int | None = None
    database: str | None = None
    username: str | None = None
    # 注意：不包含 password


class ExportRelationship(BaseModel):
    """导出的表关系"""

    source_table: str
    source_column: str
    target_table: str
    target_column: str
    relationship_type: Literal["1:1", "1:N", "N:1", "N:M"] = "1:N"
    join_type: Literal["LEFT", "INNER", "RIGHT", "FULL"] = "LEFT"
    description: str | None = None


class ExportSemanticTerm(BaseModel):
    """导出的语义术语"""

    term: str
    expression: str
    term_type: Literal["metric", "dimension", "filter", "alias"] = "metric"
    description: str | None = None
    examples: list[str] = []


class ExportLayout(BaseModel):
    """导出的布局配置"""

    name: str
    is_default: bool = False
    layout_data: dict[str, dict] = {}
    visible_tables: list[str] | None = None
    zoom: float = 1.0
    viewport_x: float = 0.0
    viewport_y: float = 0.0


class ConfigExport(BaseModel):
    """完整导出数据"""

    version: str = "1.0"
    exported_at: datetime = Field(default_factory=datetime.utcnow)
    connection: ExportConnectionInfo
    relationships: list[ExportRelationship] = []
    semantic_terms: list[ExportSemanticTerm] = []
    layouts: list[ExportLayout] = []


class ImportRequest(BaseModel):
    """导入请求"""

    config: ConfigExport
    mode: Literal["merge", "replace"] = "merge"
    conflict_resolution: Literal["skip", "rename", "overwrite"] = "skip"


class ImportResultItem(BaseModel):
    """单项导入结果"""

    type: str  # relationship, semantic_term, layout
    name: str
    status: Literal["created", "updated", "skipped", "failed"]
    message: str | None = None


class ImportResult(BaseModel):
    """导入结果汇总"""

    success: bool
    total: int
    created: int
    updated: int
    skipped: int
    failed: int
    details: list[ImportResultItem] = []
