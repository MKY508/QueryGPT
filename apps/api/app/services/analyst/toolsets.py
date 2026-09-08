"""PydanticAI toolset composition for ReceiptBI analysis."""

from __future__ import annotations

from pydantic_ai.toolsets import FunctionToolset

from app.services.analyst.knowledge_tools import (
    apply_confirmed_rule,
    propose_project_knowledge,
)
from app.services.analyst.python_tools import (
    analyze_with_python,
    install_python_packages,
    render_chart,
)
from app.services.analyst.query_tools import (
    query_database,
    query_project_files,
    query_source_data,
)
from app.services.analyst.relationship_tools import (
    join_results,
    validate_relationship,
)
from app.services.analyst.result_tools import (
    aggregate_result,
    validate_result,
)
from app.services.analyst.semantics import (
    inspect_project_data,
    inspect_source_semantics,
    inspect_table_semantics,
)
from app.services.analyst.session import (
    AnalystSession,
)
from app.services.execution_policy import ExecutionPolicy


def build_toolsets(policy: ExecutionPolicy) -> list[FunctionToolset[AnalystSession]]:
    """Compose independent tool families for one immutable run policy."""
    toolsets = [
        FunctionToolset[AnalystSession](
            tools=[inspect_project_data, inspect_source_semantics, inspect_table_semantics],
            id="project",
            sequential=True,
            timeout=90,
        ),
        FunctionToolset[AnalystSession](
            tools=[query_source_data, query_database, query_project_files],
            id="sources",
            sequential=True,
            timeout=90,
        ),
        FunctionToolset[AnalystSession](
            tools=[validate_result, aggregate_result],
            id="results",
            sequential=True,
            timeout=90,
        ),
        FunctionToolset[AnalystSession](
            tools=[join_results, validate_relationship],
            id="relationships",
            sequential=True,
            timeout=90,
        ),
        FunctionToolset[AnalystSession](
            tools=[apply_confirmed_rule, propose_project_knowledge],
            id="knowledge",
            sequential=True,
            timeout=90,
        ),
    ]
    if policy.python_enabled:
        python = FunctionToolset[AnalystSession](
            tools=[render_chart], id="python", sequential=True, timeout=90
        )
        python.add_function(analyze_with_python, timeout=300)
        if policy.auto_repair_enabled:
            python.add_function(install_python_packages, timeout=240)
        toolsets.append(python)
    return toolsets
