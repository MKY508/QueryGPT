"""语义层管理 API"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.db.tables import SemanticTerm
from app.models import APIResponse, SemanticTermCreate, SemanticTermResponse, SemanticTermUpdate

router = APIRouter(prefix="/semantic/terms", tags=["semantic"])


async def _get_term_or_404(db: AsyncSession, term_id: UUID) -> SemanticTerm:
    result = await db.execute(select(SemanticTerm).where(SemanticTerm.id == term_id))
    term = result.scalar_one_or_none()
    if not term:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="术语不存在")
    return term


@router.get("", response_model=APIResponse[list[SemanticTermResponse]])
async def list_terms(
    connection_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
):
    """获取语义术语列表"""
    query = select(SemanticTerm).where(SemanticTerm.is_active.is_(True))
    if connection_id:
        query = query.where(SemanticTerm.connection_id == connection_id)
    query = query.order_by(SemanticTerm.term)
    result = await db.execute(query)
    terms = result.scalars().all()
    return APIResponse.ok(data=[SemanticTermResponse.model_validate(t) for t in terms])


@router.post("", response_model=APIResponse[SemanticTermResponse])
async def create_term(
    term_in: SemanticTermCreate,
    db: AsyncSession = Depends(get_db),
):
    """创建语义术语"""
    existing = await db.execute(
        select(SemanticTerm).where(
            SemanticTerm.term == term_in.term,
            SemanticTerm.connection_id == term_in.connection_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"术语 '{term_in.term}' 已存在",
        )

    term = SemanticTerm(
        term=term_in.term,
        expression=term_in.expression,
        term_type=term_in.term_type,
        connection_id=term_in.connection_id,
        description=term_in.description,
        examples=term_in.examples,
    )
    db.add(term)
    await db.commit()
    await db.refresh(term)
    return APIResponse.ok(data=SemanticTermResponse.model_validate(term), message="术语已创建")


@router.get("/{term_id}", response_model=APIResponse[SemanticTermResponse])
async def get_term(
    term_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """获取单个语义术语"""
    term = await _get_term_or_404(db, term_id)
    return APIResponse.ok(data=SemanticTermResponse.model_validate(term))


@router.put("/{term_id}", response_model=APIResponse[SemanticTermResponse])
async def update_term(
    term_id: UUID,
    term_in: SemanticTermUpdate,
    db: AsyncSession = Depends(get_db),
):
    """更新语义术语"""
    term = await _get_term_or_404(db, term_id)
    update_data = term_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(term, field, value)
    await db.commit()
    await db.refresh(term)
    return APIResponse.ok(data=SemanticTermResponse.model_validate(term), message="术语已更新")


@router.delete("/{term_id}", response_model=APIResponse[dict])
async def delete_term(
    term_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """删除语义术语"""
    term = await _get_term_or_404(db, term_id)
    await db.delete(term)
    await db.commit()
    return APIResponse.ok(message="术语已删除")
