import type {
  AgentTraceEntry,
  DataRow,
  ExecutionContextSummary,
  Visualization,
} from "@/lib/types/api";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  isLoading?: boolean;
  status?: string;
  thinkingStage?: string;
  sql?: string;
  visualization?: Visualization;
  data?: DataRow[];
  pythonOutput?: string;
  pythonImages?: string[];
  executionTime?: number;
  rowsCount?: number;
  executionContext?: ExecutionContextSummary;
  diagnostics?: AgentTraceEntry[];
  hasError?: boolean;
  errorMessage?: string;
  errorCode?: string;
  errorCategory?: string;
  canRetry?: boolean;
  originalQuery?: string;
}
