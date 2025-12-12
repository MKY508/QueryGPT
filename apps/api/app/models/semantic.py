"""语义层相关模型"""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class SemanticTermCreate(BaseModel):
    """创建语义术语"""

    term: str = Field(..., min_length=1, max_length=100, description="术语名称")
    expression: str = Field(..., min_length=1, description="SQL 表达式或映射")
    term_type: Literal["metric", "dimension", "filter", "alias"] = Field(
        default="metric", description="术语类型"
    )
    connection_id: UUID | None = Field(default=None, description="关联的数据库连接")
    description: str | None = Field(default=None, description="术语描述")
    examples: list[str] = Field(default_factory=list, description="使用示例")


class SemanticTermUpdate(BaseModel):
    """更新语义术语"""

    term: str | None = Field(default=None, max_length=100)
    expression: str | None = None
    term_type: Literal["metric", "dimension", "filter", "alias"] | None = None
    connection_id: UUID | None = None
    description: str | None = None
    examples: list[str] | None = None
    is_active: bool | None = None


class SemanticTermResponse(BaseModel):
    """语义术语响应"""

    id: UUID
    term: str
    expression: str
    term_type: str
    connection_id: UUID | None = None
    description: str | None = None
    examples: list[str] = []
    is_active: bool = True
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class SemanticContext(BaseModel):
    """语义上下文 - 用于注入到 AI 提示中"""

    terms: list[SemanticTermResponse] = []

    def to_prompt(self, language: str = "zh") -> str:
        """生成提示文本"""
        if not self.terms:
            return ""

        if language == "zh":
            lines = ["## 业务术语字典", "以下是用户定义的业务术语，请在生成 SQL 时参考：", ""]
        else:
            lines = ["## Business Term Dictionary", "Use these terms when generating SQL:", ""]

        for term in self.terms:
            term_type_label = {
                "metric": "指标" if language == "zh" else "Metric",
                "dimension": "维度" if language == "zh" else "Dimension",
                "filter": "筛选条件" if language == "zh" else "Filter",
                "alias": "别名" if language == "zh" else "Alias",
            }.get(term.term_type, term.term_type)

            lines.append(f"- **{term.term}** [{term_type_label}]: `{term.expression}`")
            if term.description:
                lines.append(f"  {term.description}")
            if term.examples:
                examples_str = ", ".join(f'"{e}"' for e in term.examples[:3])
                lines.append(
                    f"  示例: {examples_str}" if language == "zh" else f"  Examples: {examples_str}"
                )

        return "\n".join(lines)
