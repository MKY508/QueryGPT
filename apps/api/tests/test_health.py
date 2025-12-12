"""Health check endpoint tests"""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_health_check(client: AsyncClient):
    """Test health check endpoint returns OK"""
    response = await client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"


@pytest.mark.asyncio
async def test_root_redirect(client: AsyncClient):
    """Test root redirects to docs"""
    response = await client.get("/", follow_redirects=False)
    assert response.status_code in [200, 307, 302]
