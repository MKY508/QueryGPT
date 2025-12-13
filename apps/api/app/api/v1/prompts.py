"""提示词管理 API"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db import get_db
from app.db.tables import Prompt, User
from app.models import APIResponse
from app.models.prompt import (
    PromptCreate,
    PromptListResponse,
    PromptResponse,
    PromptUpdate,
    PromptVersionResponse,
)

router = APIRouter()


@router.get("", response_model=APIResponse[PromptListResponse])
async def list_prompts(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取提示词列表（只返回激活版本）"""
    result = await db.execute(
        select(Prompt)
        .where(Prompt.user_id == current_user.id, Prompt.is_active.is_(True))
        .order_by(Prompt.is_default.desc(), Prompt.created_at.desc())
    )
    prompts = result.scalars().all()

    return APIResponse.ok(
        data=PromptListResponse(
            items=[PromptResponse.model_validate(p) for p in prompts],
            total=len(prompts),
        )
    )


@router.post("", response_model=APIResponse[PromptResponse])
async def create_prompt(
    data: PromptCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """创建提示词"""
    # 如果设为默认，先取消其他默认
    if data.is_default:
        await _clear_default_prompt(db, current_user.id)

    prompt = Prompt(
        user_id=current_user.id,
        name=data.name,
        content=data.content,
        description=data.description,
        version=1,
        is_active=True,
        is_default=data.is_default,
    )
    db.add(prompt)
    await db.commit()
    await db.refresh(prompt)

    return APIResponse.ok(data=PromptResponse.model_validate(prompt), message="提示词创建成功")


@router.get("/{prompt_id}", response_model=APIResponse[PromptResponse])
async def get_prompt(
    prompt_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取提示词详情"""
    prompt = await _get_prompt_or_404(db, prompt_id, current_user.id)
    return APIResponse.ok(data=PromptResponse.model_validate(prompt))


@router.put("/{prompt_id}", response_model=APIResponse[PromptResponse])
async def update_prompt(
    prompt_id: UUID,
    data: PromptUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """更新提示词（创建新版本）"""
    old_prompt = await _get_prompt_or_404(db, prompt_id, current_user.id)

    # 创建新版本
    new_prompt = Prompt(
        user_id=current_user.id,
        name=data.name or old_prompt.name,
        content=data.content or old_prompt.content,
        description=data.description if data.description is not None else old_prompt.description,
        version=old_prompt.version + 1,
        is_active=True,
        is_default=old_prompt.is_default,
        parent_id=old_prompt.id,
    )

    # 将旧版本设为非激活
    old_prompt.is_active = False
    old_prompt.is_default = False

    db.add(new_prompt)
    await db.commit()
    await db.refresh(new_prompt)

    return APIResponse.ok(data=PromptResponse.model_validate(new_prompt), message="提示词更新成功")


@router.delete("/{prompt_id}", response_model=APIResponse[dict])
async def delete_prompt(
    prompt_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """删除提示词（删除所有版本）"""
    prompt = await _get_prompt_or_404(db, prompt_id, current_user.id)

    # 找到所有相关版本并删除
    # 先找到根版本
    root_id = await _find_root_prompt_id(db, prompt)

    # 删除所有版本
    result = await db.execute(
        select(Prompt).where(
            Prompt.user_id == current_user.id,
            (Prompt.id == root_id) | (Prompt.parent_id == root_id),
        )
    )
    all_versions = result.scalars().all()

    for p in all_versions:
        await db.delete(p)

    # 也删除当前提示词（如果不在上面的查询中）
    await db.delete(prompt)
    await db.commit()

    return APIResponse.ok(data={"deleted": True}, message="提示词删除成功")


@router.post("/{prompt_id}/set-default", response_model=APIResponse[PromptResponse])
async def set_default_prompt(
    prompt_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """设为默认提示词"""
    prompt = await _get_prompt_or_404(db, prompt_id, current_user.id)

    # 取消其他默认
    await _clear_default_prompt(db, current_user.id)

    # 设为默认
    prompt.is_default = True
    await db.commit()
    await db.refresh(prompt)

    return APIResponse.ok(data=PromptResponse.model_validate(prompt), message="已设为默认提示词")


@router.get("/{prompt_id}/versions", response_model=APIResponse[list[PromptVersionResponse]])
async def get_prompt_versions(
    prompt_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取提示词版本历史"""
    prompt = await _get_prompt_or_404(db, prompt_id, current_user.id)

    # 找到根版本
    root_id = await _find_root_prompt_id(db, prompt)

    # 获取所有版本
    result = await db.execute(
        select(Prompt)
        .where(
            Prompt.user_id == current_user.id,
            (Prompt.id == root_id) | (Prompt.parent_id == root_id),
        )
        .order_by(Prompt.version.desc())
    )
    versions = result.scalars().all()

    # 如果当前提示词不在结果中，添加它
    version_ids = {v.id for v in versions}
    if prompt.id not in version_ids:
        versions = [prompt, *versions]

    return APIResponse.ok(data=[PromptVersionResponse.model_validate(v) for v in versions])


@router.post("/{prompt_id}/rollback/{version}", response_model=APIResponse[PromptResponse])
async def rollback_prompt(
    prompt_id: UUID,
    version: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """回滚到指定版本"""
    current_prompt = await _get_prompt_or_404(db, prompt_id, current_user.id)

    # 找到目标版本
    root_id = await _find_root_prompt_id(db, current_prompt)

    result = await db.execute(
        select(Prompt).where(
            Prompt.user_id == current_user.id,
            (Prompt.id == root_id) | (Prompt.parent_id == root_id),
            Prompt.version == version,
        )
    )
    target_prompt = result.scalar_one_or_none()

    if not target_prompt:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"版本 {version} 不存在",
        )

    # 创建新版本（复制目标版本内容）
    new_prompt = Prompt(
        user_id=current_user.id,
        name=target_prompt.name,
        content=target_prompt.content,
        description=target_prompt.description,
        version=current_prompt.version + 1,
        is_active=True,
        is_default=current_prompt.is_default,
        parent_id=current_prompt.id,
    )

    # 将当前版本设为非激活
    current_prompt.is_active = False
    current_prompt.is_default = False

    db.add(new_prompt)
    await db.commit()
    await db.refresh(new_prompt)

    return APIResponse.ok(
        data=PromptResponse.model_validate(new_prompt),
        message=f"已回滚到版本 {version}",
    )


async def _get_prompt_or_404(db: AsyncSession, prompt_id: UUID, user_id: UUID) -> Prompt:
    """获取提示词或返回 404"""
    result = await db.execute(
        select(Prompt).where(Prompt.id == prompt_id, Prompt.user_id == user_id)
    )
    prompt = result.scalar_one_or_none()

    if not prompt:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="提示词不存在",
        )

    return prompt


async def _clear_default_prompt(db: AsyncSession, user_id: UUID) -> None:
    """清除用户的默认提示词"""
    result = await db.execute(
        select(Prompt).where(Prompt.user_id == user_id, Prompt.is_default.is_(True))
    )
    prompts = result.scalars().all()

    for p in prompts:
        p.is_default = False


async def _find_root_prompt_id(db: AsyncSession, prompt: Prompt) -> UUID:
    """找到提示词的根版本 ID"""
    current = prompt
    while current.parent_id:
        result = await db.execute(select(Prompt).where(Prompt.id == current.parent_id))
        parent = result.scalar_one_or_none()
        if not parent:
            break
        current = parent
    return current.id
