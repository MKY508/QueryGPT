"use client";

import { AlertCircle, CheckCircle, ChevronDown, ChevronRight, Clock3, Loader2, RefreshCw, XCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { ConfiguredModel } from "@/lib/types/api";
import { getModelServiceState, getModelTestResultMessage, type ModelServiceCheck } from "@/lib/settings/model-service";
import { ArmedDeleteButton } from "@/components/ui/armed-delete-button";
import { ModelProviderMark, ModelProviderName } from "./ModelProviderIdentity";
import { Button } from "@/components/ui/button";
import styles from "../SettingsResourceCard.module.css";

const STATES = {
  available: { label: "statusAvailable", hint: "statusAvailableHint", Icon: CheckCircle, tone: "text-primary bg-primary/10" },
  unchecked: { label: "statusUnchecked", hint: "statusUncheckedHint", Icon: Clock3, tone: "text-muted-foreground bg-muted" },
  reconnect: { label: "statusReconnect", hint: "statusReconnectHint", Icon: AlertCircle, tone: "text-warning bg-warning/10" },
  needs_configuration: { label: "statusNeedsConfiguration", hint: "statusNeedsConfigurationHint", Icon: AlertCircle, tone: "text-warning bg-warning/10" },
  temporarily_unavailable: { label: "statusTemporarilyUnavailable", hint: "statusTemporarilyUnavailableHint", Icon: AlertCircle, tone: "text-warning bg-warning/10" },
  configuration_unreadable: { label: "statusConfigurationUnreadable", hint: "statusConfigurationUnreadableHint", Icon: XCircle, tone: "text-destructive bg-destructive/10" },
} as const;

function formatCheckedAt(value: string | null | undefined, locale: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

export function ModelServiceCard({ model, check, disabled, editing, deleteArmed, onEdit, onTest, onDelete, onInspect }: {
  model: ConfiguredModel; check?: ModelServiceCheck;
  disabled: boolean; editing: boolean; deleteArmed: boolean;
  onEdit: () => void; onTest: () => void; onDelete: () => void; onInspect: () => void;
}) {
  const t = useTranslations("modelSettings");
  const tc = useTranslations("common");
  const tl = useTranslations("settingsCollection");
  const locale = useLocale();
  const result = check?.status === "complete" ? check.result : null;
  const checking = check?.status === "checking";
  const status = STATES[getModelServiceState(model, result)];
  const Icon = checking ? Loader2 : status.Icon;
  const checkedAt = formatCheckedAt(model.last_checked_at, locale);
  const latency = result ? result.response_time_ms : model.last_response_time_ms;
  const message = check?.status === "failed" ? t(check.afterSave ? "savedButConnectionCheckFailed" : "testFailed") : result ? getModelTestResultMessage(result, {
    success: t("testResultSuccess"), credentials: t("testResultCredentials"),
    configuration: t("testResultConfiguration"), capability: t("testResultCapability"),
    temporary: t("testResultTemporary"), failed: t("testResultFailed"),
  }) : t(status.hint);

  return <li className={styles.card} data-testid={`model-card-${model.id}`} data-editing={editing}>
    <div className={styles.heading}>
      <ModelProviderMark provider={model.provider} selected={model.is_default} />
      <div className="min-w-0">
        <button type="button" onClick={onEdit} disabled={disabled} aria-label={tl("editItem", { name: model.name })}
          className="group inline-flex max-w-full items-center gap-2 rounded-sm text-left text-sm font-semibold outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50">
          <span className="min-w-0 [overflow-wrap:anywhere]">{model.name}</span>
          <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-muted-foreground/60 group-hover:text-primary" />
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <ModelProviderName provider={model.provider} />
          {model.model_id && <><span aria-hidden="true">·</span><span className="min-w-0 [overflow-wrap:anywhere]">{model.model_id}</span></>}
          {model.is_default && <span className="font-medium text-primary">{tl("default")}</span>}
        </div>
      </div>
      <div className={styles.status}>
        <span data-testid={`model-health-${model.id}`} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${checking ? "bg-muted text-muted-foreground" : status.tone}`}>
          <Icon size={13} aria-hidden="true" className={checking ? "animate-spin" : ""} />
          {checking ? t("checking") : t(status.label)}
        </span>
      </div>
    </div>
    <div className={styles.footer}>
      <div className={styles.feedback} role="status" aria-atomic="true">
        <p>{checking ? t("checkingService") : message}</p>
        {!check && checkedAt && <p className="mt-1">{t("lastCheckedAt", { time: checkedAt })}</p>}
      </div>
      <div className={styles.actions}>
        <Button type="button" variant="outline" onClick={onTest} disabled={checking || disabled}
          data-testid={`model-test-${model.id}`} aria-label={t("checkService", { name: model.name })}
          className="text-xs">
          <RefreshCw size={14} aria-hidden="true" className={checking ? "animate-spin" : ""} />
          {checking ? t("checking") : t("check")}
        </Button>
        <ArmedDeleteButton armed={deleteArmed} onRequest={onDelete} confirmLabel={tc("confirmDelete")}
          deleteLabel={tl("deleteItem", { name: model.name })} disabled={disabled} />
      </div>
    </div>
    <details className={styles.details} onToggle={onInspect} data-testid={`model-details-${model.id}`}>
      <summary aria-label={t("connectionDetailsFor", { name: model.name })}>
        <span>{t("connectionDetails")}</span><ChevronDown size={14} aria-hidden="true" />
      </summary>
      <dl className={styles.definition}>
        <dt>{t("sourceProvider")}</dt><dd><ModelProviderName provider={result?.source_provider || model.provider} /></dd>
        <dt>{t("apiFormat")}</dt><dd>{result?.api_format || model.extra_options?.api_format || "—"}</dd>
        <dt>{t("baseUrl")}</dt><dd>{result?.resolved_base_url || model.base_url || "—"}</dd>
        {typeof latency === "number" && <><dt>{t("latency")}</dt><dd>{t("responseTime", { ms: latency })}</dd></>}
        {result && !result.success && <><dt>{t("errorCategoryLabel")}</dt><dd>{result.error_category || "unknown"}</dd></>}
      </dl>
    </details>
  </li>;
}
