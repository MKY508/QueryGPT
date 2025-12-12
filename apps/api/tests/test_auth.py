"""Authentication API tests"""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_register_user(client: AsyncClient):
    """Test user registration"""
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "test@example.com",
            "password": "testpassword123",
            "display_name": "Test User",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["user"]["email"] == "test@example.com"
    assert "access_token" in data["data"]


@pytest.mark.asyncio
async def test_register_duplicate_email(client: AsyncClient):
    """Test registration with duplicate email fails"""
    # First registration
    await client.post(
        "/api/v1/auth/register",
        json={
            "email": "duplicate@example.com",
            "password": "testpassword123",
        },
    )
    # Second registration with same email
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "duplicate@example.com",
            "password": "testpassword123",
        },
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_login_success(client: AsyncClient):
    """Test successful login"""
    # Register first
    await client.post(
        "/api/v1/auth/register",
        json={
            "email": "login@example.com",
            "password": "testpassword123",
        },
    )
    # Login with JSON body (not form data)
    response = await client.post(
        "/api/v1/auth/login",
        json={
            "email": "login@example.com",
            "password": "testpassword123",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "access_token" in data["data"]


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient):
    """Test login with wrong password fails"""
    # Register first
    await client.post(
        "/api/v1/auth/register",
        json={
            "email": "wrongpw@example.com",
            "password": "correctpassword",
        },
    )
    # Login with wrong password
    response = await client.post(
        "/api/v1/auth/login",
        json={
            "email": "wrongpw@example.com",
            "password": "wrongpassword",
        },
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_get_current_user(client: AsyncClient):
    """Test getting current user info"""
    # Register and login
    reg_response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "me@example.com",
            "password": "testpassword123",
            "display_name": "Me User",
        },
    )
    token = reg_response.json()["data"]["access_token"]

    # Get current user
    response = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["data"]["email"] == "me@example.com"


@pytest.mark.asyncio
async def test_unauthorized_access(client: AsyncClient):
    """Test accessing protected endpoint without token"""
    response = await client.get("/api/v1/auth/me")
    assert response.status_code == 401
