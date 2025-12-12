import axios from "axios";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// 请求拦截器 - 添加 Token
api.interceptors.request.use((config) => {
  // 从 localStorage 获取 token (zustand persist)
  const authData = localStorage.getItem("querygpt-auth");
  if (authData) {
    try {
      const { state } = JSON.parse(authData);
      if (state?.accessToken) {
        config.headers.Authorization = `Bearer ${state.accessToken}`;
      }
    } catch {
      // ignore
    }
  }
  return config;
});

// 响应拦截器 - 处理错误
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // 如果是 401 错误且不是刷新 token 的请求
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      // 尝试刷新 token
      const authData = localStorage.getItem("querygpt-auth");
      if (authData) {
        try {
          const { state } = JSON.parse(authData);
          if (state?.refreshToken) {
            const response = await axios.post(`${API_URL}/api/v1/auth/refresh`, {
              refresh_token: state.refreshToken,
            });

            const { access_token, refresh_token } = response.data.data;

            // 更新存储
            const newState = {
              ...state,
              accessToken: access_token,
              refreshToken: refresh_token,
            };
            localStorage.setItem(
              "querygpt-auth",
              JSON.stringify({ state: newState })
            );

            // 重试原请求
            originalRequest.headers.Authorization = `Bearer ${access_token}`;
            return api(originalRequest);
          }
        } catch {
          // 刷新失败，清除认证状态
          localStorage.removeItem("querygpt-auth");
          window.location.href = "/";
        }
      }
    }

    return Promise.reject(error);
  }
);

// 获取当前 token
function getAccessToken(): string {
  const authData = localStorage.getItem("querygpt-auth");
  if (authData) {
    try {
      const { state } = JSON.parse(authData);
      return state?.accessToken || "";
    } catch {
      return "";
    }
  }
  return "";
}

// SSE 流式请求 - 使用 fetch + ReadableStream 替代 EventSource
// 这样可以通过 headers 传递 token，更安全
export function createEventSource(
  url: string,
  params: Record<string, string>
): EventSource {
  const searchParams = new URLSearchParams(params);
  const fullUrl = `${API_URL}${url}?${searchParams.toString()}`;
  const token = getAccessToken();

  // 仍然使用 EventSource，但 token 通过 URL 传递
  // 注意：这在生产环境中应该使用 HTTPS 来保护 token
  // 更安全的方案是使用 fetch API，但需要修改 chat store 的实现
  const eventSource = new EventSource(
    `${fullUrl}&token=${encodeURIComponent(token)}`
  );

  return eventSource;
}

// SSE 事件类型
interface SSEEvent {
  type: string;
  data: Record<string, unknown>;
}

// 更安全的 SSE 实现 - 使用 fetch API
export async function* createSecureEventStream(
  url: string,
  params: Record<string, string>
): AsyncGenerator<SSEEvent> {
  const searchParams = new URLSearchParams(params);
  const fullUrl = `${API_URL}${url}?${searchParams.toString()}`;
  const token = getAccessToken();

  const response = await fetch(fullUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "text/event-stream",
    },
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
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            yield { type: "message", data };
          } catch {
            // 忽略解析错误
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
