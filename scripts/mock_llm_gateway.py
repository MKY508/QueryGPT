#!/usr/bin/env python3
"""Minimal OpenAI-compatible gateway used by CI integration tests."""

from __future__ import annotations

import json
import os
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

HOST = os.environ.get("MOCK_LLM_HOST", "0.0.0.0")
PORT = int(os.environ.get("MOCK_LLM_PORT", "4010"))
MODEL_ID = os.environ.get("MOCK_LLM_MODEL_ID", "querygpt-ci")
DEFAULT_CONTENT = os.environ.get(
    "MOCK_LLM_RESPONSE",
    "[thinking:分析需求]\n"
    "分析已完成。\n\n"
    "```sql\n"
    "SELECT name, category FROM products ORDER BY id LIMIT 3;\n"
    "```",
)


def build_chat_response(content: str) -> dict[str, Any]:
    timestamp = int(time.time())
    return {
        "id": "chatcmpl-querygpt-ci",
        "object": "chat.completion",
        "created": timestamp,
        "model": MODEL_ID,
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": content,
                },
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": 8,
            "completion_tokens": max(1, len(content) // 4),
            "total_tokens": max(9, len(content) // 4 + 8),
        },
    }


def build_stream_chunks(content: str) -> list[bytes]:
    timestamp = int(time.time())
    chunks: list[bytes] = []
    step = 18
    for index in range(0, len(content), step):
        chunk = {
            "id": "chatcmpl-querygpt-ci",
            "object": "chat.completion.chunk",
            "created": timestamp,
            "model": MODEL_ID,
            "choices": [
                {
                    "index": 0,
                    "delta": {"content": content[index : index + step]},
                    "finish_reason": None,
                }
            ],
        }
        chunks.append(f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n".encode())

    final_chunk = {
        "id": "chatcmpl-querygpt-ci",
        "object": "chat.completion.chunk",
        "created": timestamp,
        "model": MODEL_ID,
        "choices": [
            {
                "index": 0,
                "delta": {},
                "finish_reason": "stop",
            }
        ],
    }
    chunks.append(f"data: {json.dumps(final_chunk, ensure_ascii=False)}\n\n".encode())
    chunks.append(b"data: [DONE]\n\n")
    return chunks


class MockGatewayHandler(BaseHTTPRequestHandler):
    server_version = "QueryGPTMockLLM/1.0"

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
        return

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw_body = self.rfile.read(length) if length > 0 else b"{}"
        try:
            return json.loads(raw_body.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            return {}

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._send_json(HTTPStatus.OK, {"status": "ok"})
            return

        if self.path == "/v1/models":
            self._send_json(
                HTTPStatus.OK,
                {
                    "object": "list",
                    "data": [
                        {
                            "id": MODEL_ID,
                            "object": "model",
                            "owned_by": "querygpt",
                        }
                    ],
                },
            )
            return

        self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/v1/chat/completions":
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return

        payload = self._read_json_body()
        content = DEFAULT_CONTENT
        if payload.get("stream"):
            chunks = build_stream_chunks(content)
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            for chunk in chunks:
                self.wfile.write(chunk)
                self.wfile.flush()
                time.sleep(0.02)
            return

        self._send_json(HTTPStatus.OK, build_chat_response(content))


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), MockGatewayHandler)
    print(f"Mock LLM gateway listening on http://{HOST}:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
