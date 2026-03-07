"""Integration tests for connection and model health checks."""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.integration


def require_env(*names: str) -> dict[str, str]:
    values: dict[str, str] = {}
    missing: list[str] = []
    for name in names:
        value = os.environ.get(name)
        if value:
            values[name] = value
        else:
            missing.append(name)
    if missing:
        pytest.skip(f"Missing integration env vars: {', '.join(missing)}")
    return values


async def create_connection(client: AsyncClient, payload: dict[str, object]) -> dict[str, object]:
    response = await client.post("/api/v1/config/connections", json=payload)
    assert response.status_code == 200
    return response.json()["data"]


async def create_model(client: AsyncClient, payload: dict[str, object]) -> dict[str, object]:
    response = await client.post("/api/v1/config/models", json=payload)
    assert response.status_code == 200
    return response.json()["data"]


@pytest.mark.asyncio
async def test_sqlite_connection_healthcheck(client: AsyncClient, tmp_path: Path):
    sqlite_path = tmp_path / "healthcheck.sqlite"
    with sqlite3.connect(sqlite_path) as conn:
        conn.execute("CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT NOT NULL)")
        conn.execute("INSERT INTO widgets (name) VALUES ('alpha')")
        conn.commit()

    connection = await create_connection(
        client,
        {
            "name": "Integration SQLite",
            "driver": "sqlite",
            "database": str(sqlite_path),
        },
    )

    response = await client.post(f"/api/v1/config/connections/{connection['id']}/test")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["connected"] is True
    assert data["tables_count"] == 1
    assert "SQLite" in data["version"]


@pytest.mark.asyncio
async def test_postgresql_connection_healthcheck(client: AsyncClient):
    env = require_env(
        "QUERYGPT_TEST_PG_HOST",
        "QUERYGPT_TEST_PG_PORT",
        "QUERYGPT_TEST_PG_USER",
        "QUERYGPT_TEST_PG_PASSWORD",
        "QUERYGPT_TEST_PG_DATABASE",
    )

    import psycopg2

    with psycopg2.connect(
        host=env["QUERYGPT_TEST_PG_HOST"],
        port=int(env["QUERYGPT_TEST_PG_PORT"]),
        user=env["QUERYGPT_TEST_PG_USER"],
        password=env["QUERYGPT_TEST_PG_PASSWORD"],
        dbname=env["QUERYGPT_TEST_PG_DATABASE"],
    ) as conn:
        conn.autocommit = True
        with conn.cursor() as cursor:
            cursor.execute("DROP TABLE IF EXISTS ci_healthcheck_products")
            cursor.execute(
                "CREATE TABLE ci_healthcheck_products (id SERIAL PRIMARY KEY, name TEXT)"
            )

    connection = await create_connection(
        client,
        {
            "name": "Integration PostgreSQL",
            "driver": "postgresql",
            "host": env["QUERYGPT_TEST_PG_HOST"],
            "port": int(env["QUERYGPT_TEST_PG_PORT"]),
            "username": env["QUERYGPT_TEST_PG_USER"],
            "password": env["QUERYGPT_TEST_PG_PASSWORD"],
            "database": env["QUERYGPT_TEST_PG_DATABASE"],
        },
    )

    response = await client.post(f"/api/v1/config/connections/{connection['id']}/test")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["connected"] is True
    assert data["tables_count"] >= 1
    assert "PostgreSQL" in data["version"]


@pytest.mark.asyncio
async def test_mysql_connection_healthcheck(client: AsyncClient):
    env = require_env(
        "QUERYGPT_TEST_MYSQL_HOST",
        "QUERYGPT_TEST_MYSQL_PORT",
        "QUERYGPT_TEST_MYSQL_USER",
        "QUERYGPT_TEST_MYSQL_PASSWORD",
        "QUERYGPT_TEST_MYSQL_DATABASE",
    )

    import pymysql

    conn = pymysql.connect(
        host=env["QUERYGPT_TEST_MYSQL_HOST"],
        port=int(env["QUERYGPT_TEST_MYSQL_PORT"]),
        user=env["QUERYGPT_TEST_MYSQL_USER"],
        password=env["QUERYGPT_TEST_MYSQL_PASSWORD"],
        database=env["QUERYGPT_TEST_MYSQL_DATABASE"],
        autocommit=True,
    )
    try:
        with conn.cursor() as cursor:
            cursor.execute("DROP TABLE IF EXISTS ci_healthcheck_products")
            cursor.execute(
                "CREATE TABLE ci_healthcheck_products (id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(255))"
            )
    finally:
        conn.close()

    connection = await create_connection(
        client,
        {
            "name": "Integration MySQL",
            "driver": "mysql",
            "host": env["QUERYGPT_TEST_MYSQL_HOST"],
            "port": int(env["QUERYGPT_TEST_MYSQL_PORT"]),
            "username": env["QUERYGPT_TEST_MYSQL_USER"],
            "password": env["QUERYGPT_TEST_MYSQL_PASSWORD"],
            "database": env["QUERYGPT_TEST_MYSQL_DATABASE"],
        },
    )

    response = await client.post(f"/api/v1/config/connections/{connection['id']}/test")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["connected"] is True
    assert data["tables_count"] >= 1
    assert "MySQL" in data["version"]


@pytest.mark.asyncio
async def test_model_healthcheck_against_mock_gateway(client: AsyncClient):
    env = require_env("QUERYGPT_TEST_MODEL_BASE_URL")

    model = await create_model(
        client,
        {
            "name": "CI Mock Gateway",
            "provider": "custom",
            "model_id": "querygpt-ci",
            "base_url": env["QUERYGPT_TEST_MODEL_BASE_URL"],
            "api_key": "ci-test-key",
            "extra_options": {
                "api_format": "openai_compatible",
                "healthcheck_mode": "chat_completion",
            },
            "is_default": True,
        },
    )

    response = await client.post(f"/api/v1/config/models/{model['id']}/test")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["success"] is True
    assert data["resolved_provider"] == "openai"
    assert data["resolved_base_url"] == env["QUERYGPT_TEST_MODEL_BASE_URL"]
    assert data["message"] == "连接成功"
