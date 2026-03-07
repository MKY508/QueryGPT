/**
 * API 类型定义
 * 消除 any 类型，提供类型安全
 */

// ===== 通用类型 =====

/** 数据库查询结果行 */
export type DataRow = Record<string, string | number | boolean | null>;

/** 图表数据点 */
export interface ChartDataPoint {
  name: string;
  [key: string]: string | number;
}

export interface ModelExtraOptions {
  api_format?: "openai_compatible" | "anthropic_native" | "ollama_local" | "custom";
  headers?: Record<string, string>;
  query_params?: Record<string, string>;
  api_key_optional?: boolean;
  healthcheck_mode?: "chat_completion" | "models_list";
}

export interface ModelDiagnostics {
  resolved_provider?: string;
  resolved_base_url?: string;
  api_format?: string;
  api_key_required?: boolean;
  error_category?: string;
}

export interface AgentTraceEntry {
  attempt?: number;
  phase?: string;
  status?: "success" | "error" | "repaired" | "info";
  message?: string;
  error_code?: string;
  error_category?: string;
  recoverable?: boolean;
  sql?: string;
  python?: string;
}

export interface ExecutionContextSummary {
  model_id?: string;
  model_name?: string;
  model_identifier?: string;
  source_provider?: string;
  resolved_provider?: string;
  provider_summary?: string;
  connection_id?: string;
  connection_name?: string;
  connection_driver?: string;
  connection_host?: string;
  database_name?: string;
  context_rounds?: number;
  api_format?: string;
}

export interface AppSettings {
  default_model_id?: string | null;
  default_connection_id?: string | null;
  context_rounds: number;
  python_enabled: boolean;
  diagnostics_enabled: boolean;
  auto_repair_enabled: boolean;
}

export interface SystemCapabilities {
  install_profile: "core" | "analytics";
  python_enabled: boolean;
  diagnostics_enabled: boolean;
  auto_repair_enabled: boolean;
  analytics_installed: boolean;
  available_python_libraries: string[];
  missing_optional_libraries: string[];
}

// ===== SSE 事件类型 =====

/** SSE 进度事件数据 */
export interface SSEProgressData {
  step?: string;
  stage?: string;
  phase?: string;
  attempt?: number;
  message: string;
  conversation_id?: string;
  execution_context?: ExecutionContextSummary;
  diagnostic_entry?: AgentTraceEntry;
}

/** SSE 结果事件数据 */
export interface SSEResultData {
  content: string;
  sql?: string;
  data?: DataRow[];
  rows_count?: number;
  execution_time?: number;
  execution_context?: ExecutionContextSummary;
  diagnostics?: AgentTraceEntry[];
}

/** SSE 可视化事件数据 */
export interface SSEVisualizationData {
  chart: {
    type: "bar" | "line" | "pie" | "area";
    data: ChartDataPoint[];
    xKey?: string;
    yKeys?: string[];
  };
}

/** SSE 错误事件数据 */
export interface SSEErrorData {
  code: string;
  message: string;
  error_category?: string;
  failed_stage?: string;
  attempt?: number;
  conversation_id?: string;
  execution_context?: ExecutionContextSummary;
  diagnostics?: AgentTraceEntry[];
}

/** SSE 完成事件数据 */
export interface SSEDoneData {
  conversation_id?: string;
}

/** SSE 思考阶段事件数据 */
export interface SSEThinkingData {
  stage: string;
  detail?: string;
}

/** SSE Python 输出事件数据 */
export interface SSEPythonOutputData {
  output: string;
  stream: "stdout" | "stderr";
}

/** SSE Python 图表事件数据 */
export interface SSEPythonImageData {
  image: string; // base64 编码
  format: "png" | "jpeg";
}

/** SSE 事件联合类型 */
export type SSEEventData =
  | { type: "progress"; data: SSEProgressData }
  | { type: "thinking"; data: SSEThinkingData }
  | { type: "result"; data: SSEResultData }
  | { type: "visualization"; data: SSEVisualizationData }
  | { type: "python_output"; data: SSEPythonOutputData }
  | { type: "python_image"; data: SSEPythonImageData }
  | { type: "error"; data: SSEErrorData }
  | { type: "done"; data: SSEDoneData };

// ===== 消息类型 =====

/** 可视化配置 */
export interface Visualization {
  type?: "bar" | "line" | "pie" | "area";
  data?: ChartDataPoint[];
  title?: string;
}

/** 消息元数据 */
export interface MessageMetadata {
  sql?: string;
  execution_time?: number;
  rows_count?: number;
  visualization?: Visualization;
  data?: DataRow[];
  python_output?: string;
  python_images?: string[];
  error?: string;
  error_code?: string;
  error_category?: string;
  original_query?: string;
  execution_context?: ExecutionContextSummary;
  diagnostics?: AgentTraceEntry[];
}

/** API 返回的消息 */
export interface APIMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata?: MessageMetadata;
  created_at: string;
}

/** 对话 */
export interface Conversation {
  id: string;
  title: string;
  model?: string;
  model_id?: string;
  connection_id?: string;
  connection_name?: string;
  provider_summary?: string;
  context_rounds?: number;
  status: string;
  messages: APIMessage[];
  created_at: string;
  updated_at: string;
}

// ===== 对话列表类型 =====

/** 对话列表项 */
export interface ConversationListItem {
  id: string;
  title: string;
  model?: string;
  model_id?: string;
  connection_id?: string;
  connection_name?: string;
  provider_summary?: string;
  context_rounds?: number;
  status: string;
  created_at: string;
  updated_at: string;
}

/** 分页响应 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

// ===== 错误类型 =====

/** API 错误 */
export interface APIError {
  message: string;
  code?: string;
  detail?: string | Array<{ msg: string; loc: string[] }>;
}

/** 类型守卫：检查是否为 Error 对象 */
export function isError(error: unknown): error is Error {
  return error instanceof Error;
}

/** 获取错误消息 */
export function getErrorMessage(error: unknown): string {
  if (isError(error)) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "未知错误";
}

// ===== 提示词类型 =====

/** 提示词 */
export interface Prompt {
  id: string;
  name: string;
  content: string;
  description?: string;
  version: number;
  is_active: boolean;
  is_default: boolean;
  parent_id?: string;
  created_at: string;
  updated_at?: string;
}

/** 提示词版本 */
export interface PromptVersion {
  id: string;
  name: string;
  version: number;
  is_active: boolean;
  created_at: string;
}

/** 创建提示词请求 */
export interface PromptCreate {
  name: string;
  content: string;
  description?: string;
  is_default?: boolean;
}

/** 更新提示词请求 */
export interface PromptUpdate {
  name?: string;
  content?: string;
  description?: string;
}
