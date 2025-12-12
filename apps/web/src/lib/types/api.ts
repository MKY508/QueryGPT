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

// ===== SSE 事件类型 =====

/** SSE 进度事件数据 */
export interface SSEProgressData {
  step: string;
  message: string;
}

/** SSE 结果事件数据 */
export interface SSEResultData {
  content: string;
  sql?: string;
  data?: DataRow[];
  rows_count?: number;
  execution_time?: number;
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
}

/** SSE 完成事件数据 */
export interface SSEDoneData {
  conversation_id?: string;
}

/** SSE 事件联合类型 */
export type SSEEventData =
  | { type: "progress"; data: SSEProgressData }
  | { type: "result"; data: SSEResultData }
  | { type: "visualization"; data: SSEVisualizationData }
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
  visualization?: Visualization;
  data?: DataRow[];
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
