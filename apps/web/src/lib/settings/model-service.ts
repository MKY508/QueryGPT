import type { ConfiguredModel } from "@/lib/types/api";
import type { ModelTestResult } from "./models";

export type ModelServiceCheck =
  | { status: "checking" }
  | { status: "complete"; result: ModelTestResult }
  | { status: "failed"; afterSave: boolean };

export type ModelServiceState =
  | "available"
  | "unchecked"
  | "reconnect"
  | "needs_configuration"
  | "temporarily_unavailable"
  | "configuration_unreadable";

export interface ModelTestResultMessages {
  success: string;
  credentials: string;
  configuration: string;
  capability: string;
  temporary: string;
  failed: string;
}

export function getModelTestResultMessage(
  result: Pick<ModelTestResult, "success" | "error_category">,
  messages: ModelTestResultMessages
): string {
  if (result.success) return messages.success;
  if (result.error_category === "auth") return messages.credentials;
  if (result.error_category === "tool_calling" || result.error_category === "structured_output") {
    return messages.capability;
  }
  if (
    result.error_category === "model_endpoint" ||
    result.error_category === "model_not_found" ||
    result.error_category === "provider_format"
  ) {
    return messages.configuration;
  }
  if (
    result.error_category === "timeout" ||
    result.error_category === "connection" ||
    result.error_category === "rate_limited"
  ) {
    return messages.temporary;
  }
  return messages.failed;
}

/**
 * Credential storage and provider health are separate facts. A saved secret
 * must never be presented as proof that the service can complete an analysis.
 */
export function getModelServiceState(model: ConfiguredModel, result?: ModelTestResult | null): ModelServiceState {
  const credentialState =
    model.credential_state ||
    (model.extra_options?.api_key_optional
      ? "not_required"
      : model.api_key_configured
        ? "readable"
        : "missing");

  if (credentialState === "unreadable") return "configuration_unreadable";
  if (credentialState === "missing") return "reconnect";
  const currentResult = result?.id === model.id ? result : null;
  const health = currentResult ? (currentResult.success ? "healthy" : "unhealthy") : model.health_status;
  const category = currentResult ? currentResult.error_category : model.last_error_category;
  if (health === "healthy") return "available";
  if (health === "unhealthy") {
    if (["tool_calling", "structured_output", "provider_format", "model_endpoint", "model_not_found"].includes(category ?? "")) {
      return "needs_configuration";
    }
    return category === "auth" ? "reconnect" : "temporarily_unavailable";
  }
  return "unchecked";
}
