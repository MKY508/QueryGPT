// Only established product stages enter the ordinary activity list. Arbitrary
// messages, reasoning, diagnostics and tool arguments are never retained here.
const STAGE_DETAIL_KEYS = {
  start: "preparingDesc", context_ready: "contextReadyDesc", understanding: "understandingDesc",
  restoring: "restoringDesc", prepared: "preparingDesc", confirmation_processing: "awaitingDesc",
  data_received: "preparingMaterialsDesc", investigating: "verifyingDesc", analyzing: "verifyingDesc",
  routing: "preparingMaterialsDesc", generating_sql: "checkingDataDesc", executing: "checkingDataDesc",
  processing: "verifyingDesc", visualizing: "visualizingDesc", summarizing: "aggregatingDesc",
  waiting_confirmation: "awaitingDesc", needs_attention: "needsAttentionDesc", paused: "needsAttentionDesc",
  completed: "completedDesc", restore_saved_steps: "restoringDesc", understand_data: "understandingDesc",
  confirmation_required: "awaitingDesc", check_saved_method: "savedMethodDesc", investigate: "verifyingDesc",
  project_context_checked: "contextReadyDesc", prepare_materials: "preparingMaterialsDesc",
  read_database: "readingDatabaseDesc", read_files: "readingFilesDesc", validate_results: "finalValidationDesc",
  relate_sources: "relatingSourcesDesc", aggregate_results: "aggregatingDesc",
  check_confirmed_definitions: "confirmedDefinitionsDesc", render_chart: "visualizingDesc",
  validate_relationships: "relationshipValidationDesc", supplemental_analysis: "supplementalAnalysisDesc",
  prepare_capabilities: "capabilitiesDesc", record_understanding: "recordingUnderstandingDesc",
  more_data_required: "needsAttentionDesc", complete_report: "completedDesc",
  business_explanation_unavailable: "businessExplanationUnavailableDesc",
} as const;

type StageDetailKey = (typeof STAGE_DETAIL_KEYS)[keyof typeof STAGE_DETAIL_KEYS];
export type AnalysisActivityStep = Exclude<StageDetailKey, "completedDesc" | "needsAttentionDesc" | "awaitingDesc">;
export const MAX_ANALYSIS_ACTIVITY = 12;

export function analysisStageDetailKey(stage: unknown): StageDetailKey | undefined {
  if (typeof stage !== "string") return undefined;
  const key = stage.trim().toLowerCase();
  return Object.hasOwn(STAGE_DETAIL_KEYS, key) ? STAGE_DETAIL_KEYS[key as keyof typeof STAGE_DETAIL_KEYS] : undefined;
}

export function appendAnalysisActivity(current: AnalysisActivityStep[] | undefined, stage: unknown): AnalysisActivityStep[] | undefined {
  const key = analysisStageDetailKey(stage);
  // Terminal/waiting claims belong to the actual result, not to a progress log.
  if (!key || key === "completedDesc" || key === "needsAttentionDesc" || key === "awaitingDesc" || current?.at(-1) === key) return current;
  return [...(current || []), key].slice(-MAX_ANALYSIS_ACTIVITY);
}
