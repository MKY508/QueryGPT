"use client";

import type { FormEvent } from "react";
import { ChevronDown, Loader2, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MODEL_PRESETS,
  type ModelFormData,
  type ModelPreset,
} from "@/lib/settings/models";
import { useTranslations } from "next-intl";

interface ModelSettingsFormProps {
  editingId: string | null;
  formData: ModelFormData;
  activePreset: ModelPreset;
  isSubmitting: boolean;
  onChange: (next: ModelFormData) => void;
  onPresetSelect: (presetKey: string) => void;
  onReset: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

const fieldClassName =
  "w-full border border-border bg-background px-3 py-2.5 text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15";

export function ModelSettingsForm({
  editingId,
  formData,
  activePreset,
  isSubmitting,
  onChange,
  onPresetSelect,
  onReset,
  onSubmit,
}: ModelSettingsFormProps) {
  const t = useTranslations("modelSettings");
  const tc = useTranslations("common");
  const providerLabel = (key: string) => {
    if (key === "openai") return t("presetOpenai");
    if (key === "deepseek") return t("presetDeepseek");
    if (key === "anthropic") return t("presetAnthropic");
    if (key === "ollama") return t("presetOllama");
    if (key === "custom") return t("presetCustom");
    return key;
  };
  const apiFormatLabel = (value: ModelFormData["api_format"]) => {
    if (value === "openai_compatible") return t("form.protocolOpenaiCompatible");
    if (value === "anthropic_native") return t("form.protocolAnthropicNative");
    if (value === "ollama_local") return t("form.protocolOllamaLocal");
    return t("form.protocolCustom");
  };

  return (
    <form
      onSubmit={onSubmit}
      data-testid="model-form"
      className="border-y border-border bg-card px-4 py-5 sm:px-5"
    >
      <div className="flex items-start justify-between gap-5">
        <div>
          <h3 className="text-base font-semibold text-foreground">
            {editingId ? t("editModel") : t("addModel")}
          </h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {t("form.chooseServiceHint")}
          </p>
        </div>
        <button
          type="button"
          onClick={onReset}
          aria-label={t("form.close")}
          className="p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X size={18} />
        </button>
      </div>

      <fieldset className="mt-5">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {t("form.chooseService")}
        </legend>
        <div className="grid border-l border-t border-border sm:grid-cols-2 lg:grid-cols-5">
          {Object.entries(MODEL_PRESETS).map(([key, preset]) => (
            <button
              key={key}
              type="button"
              onClick={() => onPresetSelect(key)}
              data-testid={`model-preset-${key}`}
              className={cn(
                "min-h-20 border-b border-r border-border px-3 py-3 text-left transition-colors",
                formData.provider === preset.provider
                  ? "bg-primary/10 shadow-[inset_3px_0_0_hsl(var(--primary))]"
                  : "bg-background hover:bg-muted"
              )}
            >
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Sparkles size={13} className="text-primary" />
                {key === "openai" && t("presetOpenai")}
                {key === "deepseek" && t("presetDeepseek")}
                {key === "anthropic" && t("presetAnthropic")}
                {key === "ollama" && t("presetOllama")}
                {key === "custom" && t("presetCustom")}
              </div>
              <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                {preset.api_format === "anthropic_native" && t("descAnthropic")}
                {preset.api_format === "ollama_local" && t("descOllama")}
                {preset.api_format === "openai_compatible" && t("descOpenai")}
              </p>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            {t("form.serviceName")}
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(event) => onChange({ ...formData, name: event.target.value })}
            data-testid="model-name-input"
            className={fieldClassName}
            placeholder={t("form.serviceNameHint")}
            required
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            {t("form.model")}
          </label>
          <input
            type="text"
            value={formData.model_id}
            onChange={(event) => onChange({ ...formData, model_id: event.target.value })}
            data-testid="model-id-input"
            className={fieldClassName}
            placeholder={t("modelIdPlaceholder")}
            required
          />
        </div>
        <div className="md:col-span-2">
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            {t("form.serviceAddress")}
          </label>
          <input
            type="url"
            value={formData.base_url}
            onChange={(event) => onChange({ ...formData, base_url: event.target.value })}
            data-testid="model-base-url-input"
            className={fieldClassName}
            placeholder="https://api.example.com/v1"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            {t("form.serviceAddressHint")}
          </p>
        </div>
        <div className="md:col-span-2">
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            {t("form.accessKey")}{" "}
            {editingId && (
              <span className="font-normal text-muted-foreground">{t("apiKeyEditHint")}</span>
            )}
          </label>
          <input
            type="password"
            value={formData.api_key}
            onChange={(event) => onChange({ ...formData, api_key: event.target.value })}
            data-testid="model-api-key-input"
            className={fieldClassName}
            placeholder={formData.api_key_optional ? t("apiKeyLocalHint") : "sk-..."}
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground md:col-span-2">
          <input
            type="checkbox"
            checked={formData.is_default}
            onChange={(event) => onChange({ ...formData, is_default: event.target.checked })}
            data-testid="model-default-checkbox"
            className="h-4 w-4 rounded text-primary"
          />
          {t("form.defaultService")}
        </label>
      </div>

      <details
        data-testid="model-compatibility-settings"
        className="group mt-6 border-t border-border pt-1"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-3 text-sm text-muted-foreground marker:content-none">
          <span>
            <span className="font-medium text-foreground">{t("form.compatibility")}</span>
            <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">
              {t("form.compatibilityHint")}
            </span>
          </span>
          <ChevronDown size={16} className="transition-transform group-open:rotate-180" />
        </summary>

        <div className="grid gap-5 border-t border-border bg-muted/40 px-4 py-5 md:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              {t("form.serviceType")}
            </label>
            <select
              value={formData.provider}
              onChange={(event) => onPresetSelect(event.target.value)}
              data-testid="model-provider-select"
              className={fieldClassName}
            >
              {Object.keys(MODEL_PRESETS).map((key) => (
                <option key={key} value={key}>
                  {providerLabel(key)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              {t("form.protocol")}
            </label>
            <select
              value={formData.api_format}
              onChange={(event) =>
                onChange({
                  ...formData,
                  api_format: event.target.value as ModelFormData["api_format"],
                })
              }
              data-testid="model-api-format-select"
              className={fieldClassName}
            >
              <option value="openai_compatible">
                {apiFormatLabel("openai_compatible")}
              </option>
              <option value="anthropic_native">
                {apiFormatLabel("anthropic_native")}
              </option>
              <option value="ollama_local">{apiFormatLabel("ollama_local")}</option>
              <option value="custom">{apiFormatLabel("custom")}</option>
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("currentFormat")}: {apiFormatLabel(activePreset.api_format)}
            </p>
          </div>
          <label className="flex cursor-pointer items-center gap-2 self-end pb-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={formData.api_key_optional}
              onChange={(event) =>
                onChange({ ...formData, api_key_optional: event.target.checked })
              }
              data-testid="model-api-key-optional-checkbox"
              className="h-4 w-4 rounded text-primary"
            />
            {t("form.noKey")}
          </label>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              {t("form.headers")}
            </label>
            <textarea
              value={formData.headersText}
              onChange={(event) => onChange({ ...formData, headersText: event.target.value })}
              data-testid="model-headers-textarea"
              className={`${fieldClassName} h-32 font-mono text-xs`}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              {t("form.params")}
            </label>
            <textarea
              value={formData.queryParamsText}
              onChange={(event) =>
                onChange({ ...formData, queryParamsText: event.target.value })
              }
              data-testid="model-query-params-textarea"
              className={`${fieldClassName} h-32 font-mono text-xs`}
            />
          </div>
        </div>
      </details>

      <div className="mt-6 flex justify-end gap-2 border-t border-border pt-5">
        <button
          type="button"
          onClick={onReset}
          className="px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {tc("cancel")}
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          data-testid="model-submit-button"
          className="flex items-center gap-2 bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {isSubmitting && <Loader2 size={16} className="animate-spin" />}
          {editingId ? tc("update") : tc("save")}
        </button>
      </div>
    </form>
  );
}
