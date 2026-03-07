"""Semantic layer API tests"""

from uuid import uuid4

import pytest
from httpx import AsyncClient


async def create_term(client: AsyncClient, term: str = "销售额") -> dict:
    response = await client.post(
        "/api/v1/config/semantic/terms",
        json={
            "term": term,
            "expression": "SUM(amount)",
            "term_type": "metric",
            "description": "订单总金额",
            "examples": ["查询本月销售额"],
        },
    )
    assert response.status_code == 200
    return response.json()["data"]


@pytest.mark.asyncio
async def test_list_terms_empty(client: AsyncClient):
    response = await client.get("/api/v1/config/semantic/terms")
    assert response.status_code == 200
    assert response.json()["data"] == []


@pytest.mark.asyncio
async def test_create_and_get_term(client: AsyncClient):
    created = await create_term(client)
    assert created["term"] == "销售额"
    assert created["term_type"] == "metric"

    response = await client.get(f"/api/v1/config/semantic/terms/{created['id']}")
    assert response.status_code == 200
    assert response.json()["data"]["term"] == "销售额"


@pytest.mark.asyncio
async def test_update_term(client: AsyncClient):
    created = await create_term(client, "原始术语")
    response = await client.put(
        f"/api/v1/config/semantic/terms/{created['id']}",
        json={
            "term": "更新后术语",
            "expression": "updated_expr",
            "description": "新增描述",
        },
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["term"] == "更新后术语"
    assert data["expression"] == "updated_expr"


@pytest.mark.asyncio
async def test_delete_term(client: AsyncClient):
    created = await create_term(client, "待删除术语")
    response = await client.delete(f"/api/v1/config/semantic/terms/{created['id']}")
    assert response.status_code == 200

    terms = (await client.get("/api/v1/config/semantic/terms")).json()["data"]
    assert not any(term["id"] == created["id"] for term in terms)


@pytest.mark.asyncio
async def test_duplicate_term_name_fails(client: AsyncClient):
    await create_term(client, "重复术语")
    response = await client.post(
        "/api/v1/config/semantic/terms",
        json={
            "term": "重复术语",
            "expression": "expr2",
            "term_type": "dimension",
        },
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_term_not_found(client: AsyncClient):
    response = await client.get(f"/api/v1/config/semantic/terms/{uuid4()}")
    assert response.status_code == 404
