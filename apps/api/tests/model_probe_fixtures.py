"""Synthetic tool exchange for real SDK adapters; never calls a provider."""

import json

import httpx

from tests.test_model_session import reply


def probe_reply(request: httpx.Request) -> httpx.Response:
    body = json.loads(request.content)
    if not body.get("tools"):
        return reply(request)

    if request.url.path.endswith("/responses"):
        returns = [
            item["output"] for item in body["input"] if item.get("type") == "function_call_output"
        ]
        output_name = next(
            tool["name"] for tool in body["tools"] if tool["name"] != "read_check_value"
        )
    elif request.url.path.endswith("/messages"):
        returns = [
            "".join(item["text"] for item in part["content"])
            for message in body["messages"]
            if isinstance(message["content"], list)
            for part in message["content"]
            if part["type"] == "tool_result"
        ]
        output_name = next(
            tool["name"] for tool in body["tools"] if tool["name"] != "read_check_value"
        )
    else:
        returns = [message["content"] for message in body["messages"] if message["role"] == "tool"]
        output_name = next(
            tool["function"]["name"]
            for tool in body["tools"]
            if tool["function"]["name"] != "read_check_value"
        )

    name = output_name if returns else "read_check_value"
    arguments = json.loads(returns[-1]) if returns else {}
    payload = reply(request).json()
    if request.url.path.endswith("/messages"):
        payload["content"] = [{"type": "tool_use", "id": "probe", "name": name, "input": arguments}]
        payload["stop_reason"] = "tool_use"
    elif request.url.path.endswith("/responses"):
        payload["output"] = [
            {
                "type": "function_call",
                "id": "fc_probe",
                "call_id": "probe",
                "name": name,
                "arguments": json.dumps(arguments),
                "status": "completed",
            }
        ]
    else:
        payload["choices"][0] = {
            "index": 0,
            "message": {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "probe",
                        "type": "function",
                        "function": {"name": name, "arguments": json.dumps(arguments)},
                    }
                ],
            },
            "finish_reason": "tool_calls",
        }
    return httpx.Response(200, json=payload)
