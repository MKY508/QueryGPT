"""Semantic Layer API tests"""

import pytest
from httpx import AsyncClient


async def get_auth_token(client: AsyncClient) -> str:
    """Helper to register and get auth token"""
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "semantic_test@example.com",
            "password": "testpassword123",
            "display_name": "Semantic Test User",
        },
    )
    return response.json()["data"]["access_token"]


@pytest.mark.asyncio
async def test_list_terms_empty(client: AsyncClient):
    """Test listing semantic terms when none exist"""
    token = await get_auth_token(client)
    response = await client.get(
        "/api/v1/config/semantic/terms",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert isinstance(data["data"], list)
    assert len(data["data"]) == 0


@pytest.mark.asyncio
async def test_create_term_metric(client: AsyncClient):
    """Test creating a metric type semantic term"""
    token = await get_auth_token(client)
    response = await client.post(
        "/api/v1/config/semantic/terms",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "term": "销售额",
            "expression": "SUM(amount)",
            "term_type": "metric",
            "description": "订单总金额",
            "examples": ["查询本月销售额", "按地区统计销售额"],
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["term"] == "销售额"
    assert data["data"]["term_type"] == "metric"
    assert data["data"]["expression"] == "SUM(amount)"
    assert "id" in data["data"]


@pytest.mark.asyncio
async def test_create_term_dimension(client: AsyncClient):
    """Test creating a dimension type semantic term"""
    token = await get_auth_token(client)
    response = await client.post(
        "/api/v1/config/semantic/terms",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "term": "地区",
            "expression": "region",
            "term_type": "dimension",
            "description": "销售地区",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["term_type"] == "dimension"


@pytest.mark.asyncio
async def test_create_term_filter(client: AsyncClient):
    """Test creating a filter type semantic term"""
    token = await get_auth_token(client)
    response = await client.post(
        "/api/v1/config/semantic/terms",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "term": "活跃用户",
            "expression": "last_active >= DATE_SUB(NOW(), INTERVAL 30 DAY)",
            "term_type": "filter",
            "description": "最近30天有活动的用户",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["term_type"] == "filter"


@pytest.mark.asyncio
async def test_create_term_alias(client: AsyncClient):
    """Test creating an alias type semantic term"""
    token = await get_auth_token(client)
    response = await client.post(
        "/api/v1/config/semantic/terms",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "term": "订单表",
            "expression": "orders",
            "term_type": "alias",
            "description": "订单数据表",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["term_type"] == "alias"


@pytest.mark.asyncio
async def test_get_term(client: AsyncClient):
    """Test getting a single semantic term"""
    token = await get_auth_token(client)

    # Create term first
    create_response = await client.post(
        "/api/v1/config/semantic/terms",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "term": "测试术语",
            "expression": "test_column",
            "term_type": "dimension",
        },
    )
    term_id = create_response.json()["data"]["id"]

    # Get term
    response = await client.get(
        f"/api/v1/config/semantic/terms/{term_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["term"] == "测试术语"


@pytest.mark.asyncio
async def test_update_term(client: AsyncClient):
    """Test updating a semantic term"""
    token = await get_auth_token(client)

    # Create term first
    create_response = await client.post(
        "/api/v1/config/semantic/terms",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "term": "原始术语",
            "expression": "original_expr",
            "term_type": "metric",
        },
    )
    term_id = create_response.json()["data"]["id"]

    # Update term
    response = await client.put(
        f"/api/v1/config/semantic/terms/{term_id}",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "term": "更新后术语",
            "expression": "updated_expr",
            "description": "新增描述",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["term"] == "更新后术语"
    assert data["data"]["expression"] == "updated_expr"
    assert data["data"]["description"] == "新增描述"


@pytest.mark.asyncio
async def test_delete_term(client: AsyncClient):
    """Test deleting a semantic term"""
    token = await get_auth_token(client)

    # Create term first
    create_response = await client.post(
        "/api/v1/config/semantic/terms",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "term": "待删除术语",
            "expression": "to_delete",
            "term_type": "metric",
        },
    )
    term_id = create_response.json()["data"]["id"]

    # Delete term
    response = await client.delete(
        f"/api/v1/config/semantic/terms/{term_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200

    # Verify deletion
    list_response = await client.get(
        "/api/v1/config/semantic/terms",
        headers={"Authorization": f"Bearer {token}"},
    )
    terms = list_response.json()["data"]
    assert not any(t["id"] == term_id for t in terms)


@pytest.mark.asyncio
async def test_duplicate_term_name(client: AsyncClient):
    """Test creating duplicate term name fails"""
    token = await get_auth_token(client)

    # Create first term
    await client.post(
        "/api/v1/config/semantic/terms",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "term": "重复术语",
            "expression": "expr1",
            "term_type": "metric",
        },
    )

    # Try to create duplicate
    response = await client.post(
        "/api/v1/config/semantic/terms",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "term": "重复术语",
            "expression": "expr2",
            "term_type": "dimension",
        },
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_term_not_found(client: AsyncClient):
    """Test accessing non-existent term"""
    token = await get_auth_token(client)

    fake_id = "00000000-0000-0000-0000-000000000000"
    response = await client.get(
        f"/api/v1/config/semantic/terms/{fake_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_term_unauthorized(client: AsyncClient):
    """Test accessing terms without authentication"""
    response = await client.get("/api/v1/config/semantic/terms")
    assert response.status_code == 401
