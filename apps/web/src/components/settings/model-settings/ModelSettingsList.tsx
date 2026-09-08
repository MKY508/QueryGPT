"use client";

import {
  AlertCircle,
  CheckCircle,
  Clock3,
  Loader2,
  Pencil,
  RefreshCw,
  Star,
  XCircle,
} from "lucide-react";
import type { ConfiguredModel } from "@/lib/types/api";
import type { ModelTestResult } from "@/lib/settings/models";
import { useLocale, useTranslations } from "next-intl";
import { useArmedAction } from "@/lib/hooks/useArmedAction";
import { ArmedDeleteButton } from "@/components/ui/armed-delete-button";

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
export function getModelServiceState(model: ConfiguredModel): ModelServiceState {
  const credentialState =
    model.credential_state ||
    (model.extra_options?.api_key_optional
      ? "not_required"
      : model.api_key_configured
        ? "readable"
        : "missing");

  if (credentialState === "unreadable") return "configuration_unreadable";
  if (credentialState === "missing") return "reconnect";
  if (model.health_status === "healthy") return "available";
  if (model.health_status === "unhealthy") {
    if (["tool_calling", "structured_output", "provider_format", "model_endpoint", "model_not_found"].includes(model.last_error_category ?? "")) {
      return "needs_configuration";
    }
    return model.last_error_category === "auth" ? "reconnect" : "temporarily_unavailable";
  }
  return "unchecked";
}

function formatCheckedAt(value: string | null | undefined, locale: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

interface ModelSettingsListProps {
  models: ConfiguredModel[];
  isLoading: boolean;
  testResult: ModelTestResult | null;
  testingModelId: string | undefined;
  deletePending: boolean;
  onTest: (id: string) => void;
  onEdit: (model: ConfiguredModel) => void;
  onDelete: (id: string) => void;
}

export function ModelSettingsList({
  models,
  isLoading,
  testResult,
  testingModelId,
  deletePending,
  onTest,
  onEdit,
  onDelete,
}: ModelSettingsListProps) {
  const t = useTranslations("modelSettings");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { armedId: armedDeleteId, request: requestDelete } = useArmedAction();
  const testResultMessages: ModelTestResultMessages = {
    success: t("testResultSuccess"),
    credentials: t("testResultCredentials"),
    configuration: t("testResultConfiguration"),
    capability: t("testResultCapability"),
    temporary: t("testResultTemporary"),
    failed: t("testResultFailed"),
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-muted-foreground" size={24} />
      </div>
    );
  }

  if (!models.length) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>{t("noModels")}</p>
        <p className="text-sm mt-1">{t("selectPresetFirst")}</p>
      </div>
    );
  }

  return (
    <div className="border-t border-border">
      {models.map((model) => {
        const serviceState = getModelServiceState(model);
        const checkedAt = formatCheckedAt(model.last_checked_at, locale);
        const status = {
          available: {
            label: t("statusAvailable"),
            hint: t("statusAvailableHint"),
            className: "bg-primary/10 text-primary",
            Icon: CheckCircle,
          },
          unchecked: {
            label: t("statusUnchecked"),
            hint: t("statusUncheckedHint"),
            className: "bg-muted text-muted-foreground",
            Icon: Clock3,
          },
          reconnect: {
            label: t("statusReconnect"),
            hint: t("statusReconnectHint"),
            className: "bg-warning/10 text-warning",
            Icon: AlertCircle,
          },
          needs_configuration: {
            label: t("statusNeedsConfiguration"),
            hint: t("statusNeedsConfigurationHint"),
            className: "bg-warning/10 text-warning",
            Icon: AlertCircle,
          },
          temporarily_unavailable: {
            label: t("statusTemporarilyUnavailable"),
            hint: t("statusTemporarilyUnavailableHint"),
            className: "bg-warning/10 text-warning",
            Icon: AlertCircle,
          },
          configuration_unreadable: {
            label: t("statusConfigurationUnreadable"),
            hint: t("statusConfigurationUnreadableHint"),
            className: "bg-destructive/10 text-destructive",
            Icon: XCircle,
          },
        }[serviceState];
        const StatusIcon = status.Icon;

        return (
          <div
            key={model.id}
            data-testid={`model-card-${model.id}`}
            className="border-b border-border bg-card px-4 py-4 transition-colors hover:bg-muted"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {model.is_default && (
                    <Star size={16} className="fill-yellow-500 text-yellow-500" />
                  )}
                  <div className="font-medium text-foreground">{model.name}</div>
                  <span
                    data-testid={`model-health-${model.id}`}
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium ${status.className}`}
                  >
                    <StatusIcon size={13} aria-hidden="true" />
                    {status.label}
                  </span>
                </div>
                <div className="text-sm text-muted-foreground">{model.model_id}</div>
                {model.base_url && (
                  <div className="max-w-2xl truncate font-mono text-xs text-muted-foreground">
                    {model.base_url}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span>{status.hint}</span>
                  {checkedAt && <span>{t("lastCheckedAt", { time: checkedAt })}</span>}
                  {typeof model.last_response_time_ms === "number" && (
                    <span>{t("responseTime", { ms: model.last_response_time_ms })}</span>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => onTest(model.id)}
                  disabled={Boolean(testingModelId)}
                  data-testid={`model-test-${model.id}`}
                  className="inline-flex items-center gap-1.5 border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary disabled:cursor-wait disabled:opacity-60"
                  aria-label={t("checkService", { name: model.name })}
                >
                  {testingModelId === model.id ? (
                    <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <RefreshCw size={15} aria-hidden="true" />
                  )}
                  {testingModelId === model.id ? t("checking") : t("check")}
                </button>
                <button
                  onClick={() => onEdit(model)}
                  className="p-2 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                  title={tc("edit")}
                >
                  <Pencil size={16} />
                </button>
                <ArmedDeleteButton
                  armed={armedDeleteId === model.id}
                  onRequest={() => requestDelete(model.id, () => onDelete(model.id))}
                  confirmLabel={tc("confirmDelete")}
                  deleteLabel={tc("delete")}
                  disabled={deletePending}
                />
              </div>
            </div>

            {testResult?.id === model.id && (
              <div className="mt-3 flex items-center gap-2 text-sm">
                {testResult.success ? (
                  <CheckCircle size={16} className="text-primary" />
                ) : (
                  <XCircle size={16} className="text-destructive" />
                )}
                <span className="text-muted-foreground">
                  {getModelTestResultMessage(testResult, testResultMessages)}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
