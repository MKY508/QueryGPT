import axios from "axios";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 30000,
});

interface SSEEvent {
  type: string;
  data: Record<string, unknown>;
}

export async function* createSecureEventStream(
  url: string,
  params: Record<string, string>,
  signal?: AbortSignal
): AsyncGenerator<SSEEvent> {
  const searchParams = new URLSearchParams(params);
  const fullUrl = `${API_URL}${url}?${searchParams.toString()}`;

  const response = await fetch(fullUrl, {
    method: "GET",
    headers: {
      Accept: "text/event-stream",
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const data = JSON.parse(line.slice(6));
          yield { type: "message", data };
        } catch {
          // 忽略单条 SSE 解析错误
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
