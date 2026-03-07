import type {
  AgentTraceEntry,
  APIMessage,
  DataRow,
  SSEErrorData,
  SSEEventData,
  ExecutionContextSummary,
  Visualization,
} from "@/lib/types/api";
import { getErrorMessage } from "@/lib/types/api";
import type { ChatMessage } from "@/lib/types/chat";

export type ChatStreamEventPayload = Exclude<SSEEventData, { type: "error" | "done" }>;
export type ChatStreamErrorPayload = Extract<SSEEventData, { type: "error" }>;

export function mapApiMessage(msg: APIMessage): ChatMessage {
  return {
    role: msg.role,
    content: msg.content,
    sql: msg.metadata?.sql,
    visualization: msg.metadata?.visualization,
    data: msg.metadata?.data,
    pythonOutput: msg.metadata?.python_output,
    pythonImages: msg.metadata?.python_images,
    executionTime: msg.metadata?.execution_time,
    rowsCount: msg.metadata?.rows_count,
    executionContext: msg.metadata?.execution_context,
    diagnostics: msg.metadata?.diagnostics,
    hasError: Boolean(msg.metadata?.error || msg.metadata?.error_code),
    errorMessage: msg.metadata?.error,
    errorCode: msg.metadata?.error_code,
    errorCategory: msg.metadata?.error_category,
    canRetry: Boolean(msg.metadata?.error || msg.metadata?.error_code),
    originalQuery: msg.metadata?.original_query,
  };
}

export function buildPendingAssistantMessage(
  executionContext?: ExecutionContextSummary
): ChatMessage {
  return {
    role: "assistant",
    content: "",
    isLoading: true,
    status: "正在分析...",
    executionContext,
    diagnostics: [],
  };
}

export function mergeExecutionContext(
  current?: ExecutionContextSummary,
  incoming?: ExecutionContextSummary
): ExecutionContextSummary | undefined {
  if (!current && !incoming) return undefined;
  return {
    ...(current || {}),
    ...(incoming || {}),
  };
}

export function mergeDiagnostics(
  current?: AgentTraceEntry[],
  incoming?: AgentTraceEntry[]
): AgentTraceEntry[] | undefined {
  const combined = [...(current || []), ...(incoming || [])];
  if (!combined.length) return undefined;

  const seen = new Set<string>();
  return combined.filter((entry) => {
    const marker = JSON.stringify([
      entry.attempt ?? null,
      entry.phase ?? null,
      entry.status ?? null,
      entry.message ?? null,
    ]);
    if (seen.has(marker)) return false;
    seen.add(marker);
    return true;
  });
}

function updateLastMessage(
  messages: ChatMessage[],
  updater: (message: ChatMessage) => ChatMessage
): ChatMessage[] {
  if (!messages.length) return messages;
  const lastIndex = messages.length - 1;
  return messages.map((message, index) => (index === lastIndex ? updater(message) : message));
}

export function applyStreamEvent(
  messages: ChatMessage[],
  payload: ChatStreamEventPayload
): ChatMessage[] {
  if (!messages.length) return messages;

  if (payload.type === "progress") {
    const executionContext = payload.data.execution_context as ExecutionContextSummary | undefined;
    const diagnosticEntry = payload.data.diagnostic_entry as AgentTraceEntry | undefined;
    return updateLastMessage(messages, (message) => ({
      ...message,
      status: String(payload.data.message || ""),
      executionContext: mergeExecutionContext(message.executionContext, executionContext),
      diagnostics: mergeDiagnostics(message.diagnostics, diagnosticEntry ? [diagnosticEntry] : undefined),
    }));
  }

  if (payload.type === "result") {
    const executionContext = payload.data.execution_context as ExecutionContextSummary | undefined;
    const diagnostics = payload.data.diagnostics as AgentTraceEntry[] | undefined;
    return updateLastMessage(messages, (message) => ({
      ...message,
      content: String(payload.data.content || ""),
      sql: (payload.data.sql as string | undefined) || message.sql,
      data: (payload.data.data as DataRow[] | undefined) || message.data,
      executionTime: (payload.data.execution_time as number | undefined) || message.executionTime,
      rowsCount: (payload.data.rows_count as number | undefined) || message.rowsCount,
      executionContext: mergeExecutionContext(message.executionContext, executionContext),
      diagnostics: mergeDiagnostics(message.diagnostics, diagnostics),
      isLoading: false,
      status: undefined,
    }));
  }

  if (payload.type === "thinking") {
    return updateLastMessage(messages, (message) => ({
      ...message,
      thinkingStage: String(payload.data.stage || ""),
      status: String(payload.data.stage || ""),
    }));
  }

  if (payload.type === "visualization") {
    return updateLastMessage(messages, (message) => ({
      ...message,
      visualization: payload.data.chart as Visualization | undefined,
    }));
  }

  if (payload.type === "python_output") {
    return updateLastMessage(messages, (message) => ({
      ...message,
      pythonOutput: (message.pythonOutput || "") + String(payload.data.output || ""),
    }));
  }

  if (payload.type === "python_image") {
    return updateLastMessage(messages, (message) => ({
      ...message,
      pythonImages: [...(message.pythonImages || []), String(payload.data.image || "")],
    }));
  }

  return messages;
}

export function applyStreamErrorEvent(
  messages: ChatMessage[],
  payload: ChatStreamErrorPayload,
  query: string
): ChatMessage[] {
  if (!messages.length) return messages;

  const errorData = payload.data as SSEErrorData;
  const executionContext = errorData.execution_context as ExecutionContextSummary | undefined;
  const diagnostics = errorData.diagnostics as AgentTraceEntry[] | undefined;
  return updateLastMessage(messages, (message) => ({
    ...message,
    content: message.content || "",
    hasError: true,
    errorMessage: String(errorData.message || "执行失败"),
    errorCode: String(errorData.code || "EXECUTION_ERROR"),
    errorCategory: typeof errorData.error_category === "string" ? errorData.error_category : undefined,
    canRetry: true,
    originalQuery: query,
    executionContext: mergeExecutionContext(message.executionContext, executionContext),
    diagnostics: mergeDiagnostics(message.diagnostics, diagnostics),
    isLoading: false,
    status: undefined,
  }));
}

export function applyClientError(messages: ChatMessage[], query: string, error: unknown): ChatMessage[] {
  if (!messages.length) return messages;

  return updateLastMessage(messages, (message) => ({
    ...message,
    content: message.content || "",
    hasError: true,
    errorMessage: getErrorMessage(error),
    errorCode: "CLIENT_ERROR",
    errorCategory: "client",
    canRetry: true,
    originalQuery: query,
    isLoading: false,
    status: undefined,
  }));
}

export function markStoppedMessage(messages: ChatMessage[]): ChatMessage[] {
  if (!messages.length) return messages;

  return updateLastMessage(messages, (message) =>
    message.isLoading ? { ...message, content: message.content || "已停止", isLoading: false } : message
  );
}
