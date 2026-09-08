import type {
  AnalysisReport,
  AgentTraceEntry,
  CorrectionApplication,
  DataRow,
  ExecutionContextSummary,
  Visualization,
} from "@/lib/types/api";

import type { AnalysisState } from "@/lib/types/analysis-state";

export interface ChatMessage {
  id?: string;
  streamId?: string;
  role: "user" | "assistant" | "system";
  content: string;
  isLoading?: boolean;
  status?: string;
  thinkingStage?: string;
  sql?: string;
  pythonCode?: string;
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
  failedStage?: string;
  canRetry?: boolean;
  originalQuery?: string;
  report?: AnalysisReport;
  analysisState?: AnalysisState;
  analysisRunId?: string;
  projectId?: string;
  resumable?: boolean;
  toolHistory?: Array<Record<string, unknown>>;
  semanticEngine?: string;
  correctionApplication?: CorrectionApplication;
  confirmationResolved?: string;
  semanticValidationSelection?: Array<{
    entry_id: string;
    expected_active_revision_id: string;
  }>;
}
