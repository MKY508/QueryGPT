import type { StandingPrepareResponse } from "@/lib/types/api";

type StandingAttentionMessageKey =
  | "standingNeedsAttention"
  | "standingReasonPlaybookUnavailable"
  | "standingReasonPlaybookChanged"
  | "standingReasonPlaybookSourcesUnbound"
  | "standingReasonSourcePendingConfirmation"
  | "standingReasonSourceNotUnique"
  | "standingReasonSourceChangedSinceBaseline"
  | "standingReasonSourceNotReady"
  | "standingReasonSourceWorkingCopyMissing"
  | "standingReasonSourceSchemaChanged"
  | "standingReasonSourceVersionInvalid"
  | "standingReasonSourceRecipeChanged"
  | "standingReasonSemanticMissing"
  | "standingReasonSemanticInactive"
  | "standingReasonSemanticChanged"
  | "standingReasonRelationshipUnavailable"
  | "standingReasonRelationshipChanged"
  | "standingReasonProjectInputUnavailable"
  | "standingReasonRunMissing"
  | "standingReasonResultRejected"
  | "standingReasonExecutionFailed";

type StandingAttentionTranslator = (
  key: StandingAttentionMessageKey,
  values?: Record<string, string>,
) => string;

export function standingAttentionFeedback(
  prepared: Pick<
    StandingPrepareResponse,
    "attention_reason" | "attention_reason_code" | "attention_reason_params"
  >,
  t: StandingAttentionTranslator,
): string {
  const fallbackReason = t("standingNeedsAttention");
  const params = prepared.attention_reason_params || {};
  const sourceValues = params.source ? { source: params.source } : null;
  switch (prepared.attention_reason_code) {
    case "standing_playbook_unavailable":
      return t("standingReasonPlaybookUnavailable");
    case "standing_playbook_changed":
      return t("standingReasonPlaybookChanged");
    case "standing_playbook_sources_unbound":
      return t("standingReasonPlaybookSourcesUnbound");
    case "standing_source_pending_confirmation":
      return sourceValues
        ? t("standingReasonSourcePendingConfirmation", sourceValues)
        : fallbackReason;
    case "standing_source_not_unique":
      return sourceValues ? t("standingReasonSourceNotUnique", sourceValues) : fallbackReason;
    case "standing_source_changed_since_baseline":
      return sourceValues
        ? t("standingReasonSourceChangedSinceBaseline", sourceValues)
        : fallbackReason;
    case "standing_source_not_ready":
      return sourceValues ? t("standingReasonSourceNotReady", sourceValues) : fallbackReason;
    case "standing_source_working_copy_missing":
      return sourceValues
        ? t("standingReasonSourceWorkingCopyMissing", sourceValues)
        : fallbackReason;
    case "standing_source_schema_changed":
      return sourceValues ? t("standingReasonSourceSchemaChanged", sourceValues) : fallbackReason;
    case "standing_source_version_invalid":
      return sourceValues ? t("standingReasonSourceVersionInvalid", sourceValues) : fallbackReason;
    case "standing_source_recipe_changed_since_baseline":
      return sourceValues
        ? t("standingReasonSourceRecipeChanged", sourceValues)
        : fallbackReason;
    case "standing_semantic_definition_missing":
      return t("standingReasonSemanticMissing");
    case "standing_semantic_definition_inactive":
      return t("standingReasonSemanticInactive");
    case "standing_semantic_definition_changed_since_baseline":
      return t("standingReasonSemanticChanged");
    case "standing_relationship_definition_unavailable":
      return t("standingReasonRelationshipUnavailable");
    case "standing_relationship_definition_changed":
      return t("standingReasonRelationshipChanged");
    case "standing_project_input_unavailable":
      return t("standingReasonProjectInputUnavailable");
    case "standing_in_flight_run_missing":
      return t("standingReasonRunMissing");
    case "standing_result_rejected":
      return t("standingReasonResultRejected");
    case "standing_execution_failed":
      return t("standingReasonExecutionFailed");
    default:
      return fallbackReason;
  }
}
