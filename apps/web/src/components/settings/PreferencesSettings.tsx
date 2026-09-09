"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";
import { api } from "@/lib/api/client";
import type { AppSettings, SystemCapabilities } from "@/lib/types/api";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { AppearancePreferences } from "./AppearancePreferences";
import { Button } from "@/components/ui/button";

export type PreferencesSection = "appearance" | "execution" | "diagnostics";

interface PreferencesSettingsProps {
  section?: PreferencesSection;
}

type AppSettingsUpdate = Partial<AppSettings>;

const defaultSettings: AppSettings = {
  context_rounds: 5,
  default_model_id: null,
  default_connection_id: null,
  python_enabled: true,
  diagnostics_enabled: true,
  auto_repair_enabled: true,
  preprocessing_enabled: true,
  self_analysis_enabled: true,
};

const appSettingsKeys = Object.keys(defaultSettings) as (keyof AppSettings)[];

function buildSettingsUpdate(
  current: AppSettings,
  baseline: AppSettings | null
): AppSettingsUpdate {
  if (!baseline) return {};
  return Object.fromEntries(
    appSettingsKeys
      .filter((key) => current[key] !== baseline[key])
      .map((key) => [key, current[key]])
  ) as AppSettingsUpdate;
}

function ToggleRow({
  title,
  description,
  checked,
  disabled = false,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "flex min-h-16 cursor-pointer items-start justify-between gap-5 border-b border-border bg-card px-4 py-3 transition-colors first:border-t hover:bg-muted/50 focus-within:bg-muted/50",
        disabled && "cursor-not-allowed opacity-60 hover:bg-card"
      )}
    >
      <div className="max-w-2xl">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="mt-1 text-sm leading-6 text-muted-foreground">{description}</div>
      </div>
      <span className="flex min-h-11 min-w-11 shrink-0 items-start justify-end pt-1">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="h-5 w-5 rounded border-input text-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        />
      </span>
    </label>
  );
}

export function PreferencesSettings({ section = "appearance" }: PreferencesSettingsProps) {
  const [formData, setFormData] = useState<AppSettings>(defaultSettings);
  const [baselineSettings, setBaselineSettings] = useState<AppSettings | null>(null);
  const queryClient = useQueryClient();
  const t = useTranslations("preferences");
  const tCommon = useTranslations("common");
  const needsPersistedSettings = section !== "appearance";

  const settingsQuery = useQuery({
    queryKey: ["app-settings"],
    queryFn: async () => {
      const response = await api.get("/api/v1/settings");
      return response.data.data as AppSettings;
    },
    enabled: needsPersistedSettings,
  });

  const capabilitiesQuery = useQuery({
    queryKey: ["system-capabilities"],
    queryFn: async () => {
      const response = await api.get("/api/v1/system/capabilities");
      return response.data.data as SystemCapabilities;
    },
    enabled: section === "diagnostics",
  });

  const updateMutation = useMutation({
    mutationFn: async (data: AppSettingsUpdate) => {
      const response = await api.put("/api/v1/settings", data);
      return response.data.data as AppSettings;
    },
    onSuccess: (savedSettings) => {
      const nextBaseline = { ...defaultSettings, ...savedSettings };
      setFormData(nextBaseline);
      setBaselineSettings(nextBaseline);
      queryClient.setQueryData(["app-settings"], savedSettings);
      queryClient.invalidateQueries({ queryKey: ["system-capabilities"] });
    },
  });

  useEffect(() => {
    if (!settingsQuery.data) return;
    const nextBaseline = { ...defaultSettings, ...settingsQuery.data };
    setFormData(nextBaseline);
    setBaselineSettings(nextBaseline);
  }, [settingsQuery.data]);

  const settingsUpdate = useMemo(
    () => buildSettingsUpdate(formData, baselineSettings),
    [baselineSettings, formData]
  );
  const hasChanges = Object.keys(settingsUpdate).length > 0;

  const handleChange = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    updateMutation.reset();
    setFormData((previous) => ({ ...previous, [key]: value }));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!hasChanges) return;
    updateMutation.mutate(settingsUpdate);
  };

  const capabilitiesRequired = section === "diagnostics";
  const loadFailed =
    needsPersistedSettings &&
    (settingsQuery.isError || (capabilitiesRequired && capabilitiesQuery.isError));
  const loadPending =
    needsPersistedSettings &&
    !loadFailed &&
    (settingsQuery.isLoading ||
      !baselineSettings ||
      (capabilitiesRequired && capabilitiesQuery.isLoading));
  const retryPending =
    settingsQuery.isFetching || (capabilitiesRequired && capabilitiesQuery.isFetching);

  const retryLoad = () => {
    if (settingsQuery.isError) {
      void settingsQuery.refetch();
    }
    if (capabilitiesRequired && capabilitiesQuery.isError) {
      void capabilitiesQuery.refetch();
    }
  };

  if (loadFailed) {
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card px-4 py-5"
      >
        <p className="text-sm text-foreground">{t("loadFailed")}</p>
        <Button type="button" variant="outline" onClick={retryLoad} disabled={retryPending}>
          {retryPending && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
          {tCommon("retry")}
        </Button>
      </div>
    );
  }

  if (loadPending) {
    return (
      <div
        role="status"
        className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"
      >
        <Loader2 className="animate-spin" size={20} aria-hidden="true" />
        <span>{tCommon("loading")}</span>
      </div>
    );
  }

  const capabilities = capabilitiesQuery.data;

  return (
    <div>
      <form onSubmit={handleSubmit} className="space-y-9">
        {section === "appearance" && <AppearancePreferences />}
        {section === "execution" && (
          <>
            <section>
              <div className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {t("execution.consent")}
              </div>
              <ToggleRow
                title={t("execution.preprocessing")}
                description={t("execution.preprocessingDescription")}
                checked={formData.preprocessing_enabled}
                disabled={updateMutation.isPending}
                onChange={(value) => handleChange("preprocessing_enabled", value)}
              />
              <ToggleRow
                title={t("execution.selfAnalysis")}
                description={t("execution.selfAnalysisDescription")}
                checked={formData.self_analysis_enabled}
                disabled={updateMutation.isPending}
                onChange={(value) => handleChange("self_analysis_enabled", value)}
              />
            </section>
            <section>
              <div className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {t("execution.behavior")}
              </div>
              <ToggleRow
                title={t("execution.codeAnalysis")}
                description={t("execution.codeAnalysisDescription")}
                checked={formData.python_enabled}
                disabled={updateMutation.isPending}
                onChange={(value) => handleChange("python_enabled", value)}
              />
              <ToggleRow
                title={t("execution.autoRepair")}
                description={t("execution.autoRepairDescription")}
                checked={formData.auto_repair_enabled}
                disabled={updateMutation.isPending}
                onChange={(value) => handleChange("auto_repair_enabled", value)}
              />
            </section>
          </>
        )}

        {section === "diagnostics" && (
          <>
            <section>
              <ToggleRow
                title={t("diagnostics.keepDiagnostics")}
                description={t("diagnostics.keepDiagnosticsDescription")}
                checked={formData.diagnostics_enabled}
                disabled={updateMutation.isPending}
                onChange={(value) => handleChange("diagnostics_enabled", value)}
              />
            </section>
            <details className="group border-t border-border pt-5">
              <summary className="cursor-pointer list-none text-sm font-medium text-foreground marker:content-none">
                {t("diagnostics.environmentDetails")}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {t("diagnostics.environmentDescription")}
                </span>
              </summary>
              <div className="mt-4 grid grid-cols-2 overflow-hidden rounded-xl border border-border">
                <div className="border-b border-r border-border bg-card px-4 py-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.11em] text-muted-foreground">
                    {t("execution.environment")}
                  </div>
                  <div className="mt-2 text-sm font-medium text-foreground">
                    {capabilities?.install_profile || "core"}
                  </div>
                </div>
                <div className="border-b border-r border-border bg-card px-4 py-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.11em] text-muted-foreground">
                    {t("execution.libraries")}
                  </div>
                  <div className="mt-2 text-sm leading-6 text-foreground">
                    {capabilities?.available_python_libraries?.join(", ") || "—"}
                  </div>
                  {capabilities?.missing_optional_libraries?.length ? (
                    <div className="mt-2 text-xs text-warning">
                      {t("execution.unavailable")}: {capabilities.missing_optional_libraries.join(", ")}
                    </div>
                  ) : null}
                </div>
              </div>
            </details>
          </>
        )}

        {needsPersistedSettings && (
          <div className="border-t border-border pt-5">
            <Button type="submit" disabled={!hasChanges || updateMutation.isPending}>
              {updateMutation.isPending ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Save size={16} />
              )}
              {t("saveSettings")}
            </Button>
            {updateMutation.isSuccess && (
              <p role="status" className="mt-2 text-sm text-success">
                {t("saved")}
              </p>
            )}
            {updateMutation.isError && (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {t("saveFailed")}
              </p>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
