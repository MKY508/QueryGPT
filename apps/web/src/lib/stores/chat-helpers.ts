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
import { runtimeMessage } from "@/i18n/runtime";
import { parseAnalysisState } from "@/lib/analysis-state";

export type ChatStreamEventPayload = Exclude<SSEEventData, { type: "error" | "done" }>;
export type ChatStreamErrorPayload = Extract<SSEEventData, { type: "error" }>;

export type InvestigationErrorRecovery =
  | "retry"
  | "change_analysis_service"
  | "none";

const TRANSIENT_ERROR_CATEGORIES = new Set([
  "client",
  "connection",
  "timeout",
  "rate_limited",
]);

const TRANSIENT_ERROR_CODES = new Set([
  "CLIENT_ERROR",
  "MODEL_CONNECTION_ERROR",
  "MODEL_TIMEOUT",
  "MODEL_TIMEOUT_ERROR",
  "MODEL_RATE_LIMITED",
  "MODEL_RATE_LIMIT_ERROR",
  "PROCESS_INTERRUPTED",
]);

const ANALYSIS_SERVICE_ERROR_CATEGORIES = new Set([
  "auth",
  "model_endpoint",
  "model_not_found",
  "model_selection_conflict",
  "provider_format",
]);

const ANALYSIS_SERVICE_ERROR_CODES = new Set([
  "MODEL_AUTH_ERROR",
  "MODEL_ENDPOINT_ERROR",
  "MODEL_NOT_FOUND",
  "MODEL_NOT_FOUND_ERROR",
  "MODEL_SELECTION_CONFLICT",
  "MODEL_FORMAT_ERROR",
]);

/**
 * Decide which ordinary recovery action is truthful. A credential or model
 * configuration failure is deterministic, so repeating the same request with
 * the same service is intentionally not offered.
 */
export function getInvestigationErrorRecovery(
  errorCode?: string | null,
  errorCategory?: string | null
): InvestigationErrorRecovery {
  const code = (errorCode || "").toUpperCase();
  const category = (errorCategory || "").toLowerCase();

  if (ANALYSIS_SERVICE_ERROR_CODES.has(code) || ANALYSIS_SERVICE_ERROR_CATEGORIES.has(category)) {
    return "change_analysis_service";
  }
  // Older servers used a broad model_provider category; the stable code still
  // lets the client distinguish deterministic configuration failures.
  if (category === "model_provider" && code.includes("AUTH")) {
    return "change_analysis_service";
  }
  if (TRANSIENT_ERROR_CODES.has(code) || TRANSIENT_ERROR_CATEGORIES.has(category)) {
    return "retry";
  }
  return "none";
}

export function mapApiMessage(msg: APIMessage): ChatMessage {
  const isRecoverableInterruption =
    msg.metadata?.analysis_state === "needs_attention" &&
    ["CANCELLED", "PROCESS_INTERRUPTED"].includes(msg.metadata?.error_code || "");
  const recovery = getInvestigationErrorRecovery(
    msg.metadata?.error_code,
    msg.metadata?.error_category
  );
  return {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    sql: msg.metadata?.sql,
    pythonCode: msg.metadata?.python,
    visualization: msg.metadata?.visualization,
    data: msg.metadata?.data,
    pythonOutput: msg.metadata?.python_output,
    pythonImages: msg.metadata?.python_images,
    executionTime: msg.metadata?.execution_time,
    rowsCount: msg.metadata?.rows_count,
    executionContext: msg.metadata?.execution_context,
    diagnostics: msg.metadata?.diagnostics,
    hasError: Boolean(msg.metadata?.error || msg.metadata?.error_code) && !isRecoverableInterruption,
    errorMessage: msg.metadata?.error,
    errorCode: msg.metadata?.error_code,
    errorCategory: msg.metadata?.error_category,
    failedStage: msg.metadata?.failed_stage,
    canRetry: Boolean(
      msg.metadata?.original_query &&
        (recovery === "retry" || isRecoverableInterruption)
    ),
    originalQuery: msg.metadata?.original_query,
    report: msg.metadata?.report,
    analysisState: parseAnalysisState(msg.metadata?.analysis_state),
    analysisRunId: msg.metadata?.analysis_run_id,
    projectId: msg.metadata?.project_id,
    resumable: msg.metadata?.resumable,
    toolHistory: msg.metadata?.tool_history,
    semanticEngine: msg.metadata?.semantic_engine,
    correctionApplication: msg.metadata?.correction_application,
  };
}

export function buildPendingAssistantMessage(
  executionContext?: ExecutionContextSummary,
  streamId?: string,
  resumeRunId?: string | null
): ChatMessage {
  return {
    role: "assistant",
    content: "",
    streamId,
    isLoading: true,
    executionContext,
    diagnostics: [],
    analysisRunId: resumeRunId || undefined,
    resumable: Boolean(resumeRunId),
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

function updateTargetMessage(
  messages: ChatMessage[],
  streamId: string | undefined,
  updater: (message: ChatMessage) => ChatMessage
): ChatMessage[] {
  if (!messages.length) return messages;
  const targetIndex = streamId
    ? messages.findIndex((message) => message.streamId === streamId)
    : messages.length - 1;
  if (targetIndex < 0) return messages;
  return messages.map((message, index) =>
    index === targetIndex ? updater(message) : message
  );
}

export function applyStreamEvent(
  messages: ChatMessage[],
  payload: ChatStreamEventPayload,
  streamId?: string
): ChatMessage[] {
  if (!messages.length) return messages;

  if (payload.type === "progress") {
    const executionContext = payload.data.execution_context as ExecutionContextSummary | undefined;
    const diagnosticEntry = payload.data.diagnostic_entry as AgentTraceEntry | undefined;
    const progressStage = [payload.data.step, payload.data.stage, payload.data.phase]
      .find((value) => typeof value === "string" && value.trim())
      ?.trim();
    return updateTargetMessage(messages, streamId, (message) => ({
      ...message,
      status: String(payload.data.message || ""),
      thinkingStage: progressStage || message.thinkingStage,
      analysisRunId: payload.data.analysis_run_id || message.analysisRunId,
      projectId: payload.data.project_id || message.projectId,
      analysisState: parseAnalysisState(payload.data.analysis_state) ?? message.analysisState,
      resumable: payload.data.resumable ?? message.resumable,
      executionContext: mergeExecutionContext(message.executionContext, executionContext),
      diagnostics: mergeDiagnostics(message.diagnostics, diagnosticEntry ? [diagnosticEntry] : undefined),
    }));
  }

  if (payload.type === "result") {
    const executionContext = payload.data.execution_context as ExecutionContextSummary | undefined;
    const diagnostics = payload.data.diagnostics as AgentTraceEntry[] | undefined;
    return updateTargetMessage(messages, streamId, (message) => ({
      ...message,
      content: String(payload.data.content || ""),
      sql: (payload.data.sql as string | undefined) || message.sql,
      pythonCode: (payload.data.python as string | undefined) || message.pythonCode,
      data: (payload.data.data as DataRow[] | undefined) || message.data,
      executionTime: (payload.data.execution_time as number | undefined) || message.executionTime,
      rowsCount: (payload.data.rows_count as number | undefined) || message.rowsCount,
      executionContext: mergeExecutionContext(message.executionContext, executionContext),
      diagnostics: mergeDiagnostics(message.diagnostics, diagnostics),
      report: payload.data.report || message.report,
      analysisState: parseAnalysisState(payload.data.analysis_state) ?? message.analysisState,
      analysisRunId: payload.data.analysis_run_id || message.analysisRunId,
      projectId: payload.data.project_id || message.projectId,
      resumable: payload.data.resumable ?? message.resumable,
      toolHistory: payload.data.tool_history || message.toolHistory,
      semanticEngine: payload.data.semantic_engine || message.semanticEngine,
      correctionApplication:
        payload.data.correction_application || message.correctionApplication,
      isLoading: true,
      status: runtimeMessage("savingInvestigationResult"),
    }));
  }

  if (payload.type === "thinking") {
    return updateTargetMessage(messages, streamId, (message) => ({
      ...message,
      thinkingStage: String(payload.data.stage || ""),
      status: String(payload.data.stage || ""),
    }));
  }

  if (payload.type === "visualization") {
    return updateTargetMessage(messages, streamId, (message) => ({
      ...message,
      visualization: payload.data.chart as Visualization | undefined,
    }));
  }

  if (payload.type === "python_output") {
    return updateTargetMessage(messages, streamId, (message) => ({
      ...message,
      pythonOutput: (message.pythonOutput || "") + String(payload.data.output || ""),
    }));
  }

  if (payload.type === "python_image") {
    return updateTargetMessage(messages, streamId, (message) => ({
      ...message,
      pythonImages: [...(message.pythonImages || []), String(payload.data.image || "")],
    }));
  }

  return messages;
}

export function applyStreamErrorEvent(
  messages: ChatMessage[],
  payload: ChatStreamErrorPayload,
  query: string,
  streamId?: string
): ChatMessage[] {
  if (!messages.length) return messages;

  const errorData = payload.data as SSEErrorData;
  const wasCancelled = errorData.code === "CANCELLED";
  const executionContext = errorData.execution_context as ExecutionContextSummary | undefined;
  const diagnostics = errorData.diagnostics as AgentTraceEntry[] | undefined;
  const recovery = getInvestigationErrorRecovery(
    errorData.code,
    errorData.error_category
  );
  return updateTargetMessage(messages, streamId, (message) => ({
    ...message,
    content:
      message.content ||
      (wasCancelled ? runtimeMessage("investigationStopped") : ""),
    hasError: !wasCancelled,
    errorMessage: String(errorData.message || runtimeMessage("executionFailed")),
    errorCode: String(errorData.code || "EXECUTION_ERROR"),
    errorCategory: typeof errorData.error_category === "string" ? errorData.error_category : undefined,
    failedStage: typeof errorData.failed_stage === "string" ? errorData.failed_stage : undefined,
    canRetry: wasCancelled || recovery === "retry",
    originalQuery: query,
    analysisState: parseAnalysisState(errorData.analysis_state) ?? "needs_attention",
    analysisRunId: errorData.analysis_run_id || message.analysisRunId,
    projectId: errorData.project_id || message.projectId,
    resumable: errorData.resumable ?? message.resumable,
    executionContext: mergeExecutionContext(message.executionContext, executionContext),
    diagnostics: mergeDiagnostics(message.diagnostics, diagnostics),
    correctionApplication:
      errorData.correction_application || message.correctionApplication,
    isLoading: false,
    status: undefined,
  }));
}

export function applyClientError(
  messages: ChatMessage[],
  query: string,
  error: unknown,
  streamId?: string
): ChatMessage[] {
  if (!messages.length) return messages;

  return updateTargetMessage(messages, streamId, (message) => ({
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

export function finalizeStreamMessage(
  messages: ChatMessage[],
  streamId?: string
): ChatMessage[] {
  return updateTargetMessage(messages, streamId, (message) => ({
    ...message,
    isLoading: false,
    status: undefined,
  }));
}

export function markStoppedMessage(
  messages: ChatMessage[],
  streamId?: string
): ChatMessage[] {
  if (!messages.length) return messages;

  return updateTargetMessage(messages, streamId, (message) =>
    message.isLoading
      ? {
          ...message,
          content: message.content || runtimeMessage("investigationStoppedSaved"),
          analysisState: "needs_attention",
          status: undefined,
          isLoading: false,
          canRetry: true,
        }
      : message
  );
}
