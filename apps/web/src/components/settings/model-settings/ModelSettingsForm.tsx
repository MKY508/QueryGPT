"use client";

import type { FormEvent, RefObject } from "react";
import {
  ORCAROUTER_REFERRAL_URL,
  type ModelFormData,
  type ModelPreset,
} from "@/lib/settings/models";
import { useTranslations } from "next-intl";
import { validateModelSettings } from "@/lib/settings/validation";
import { useSettingsValidation } from "@/components/settings/hooks/useSettingsValidation";
import { ModelProviderPicker } from "./ModelProviderPicker";
import { SettingsDisclosure, SettingsForm } from "../SettingsForm";
import styles from "../SettingsForm.module.css";

interface ModelSettingsFormProps {
  embedded?: boolean;
  formRef?: RefObject<HTMLFormElement | null>;
  editingId: string | null;
  preserveSavedKey?: boolean;
  formData: ModelFormData;
  activePreset: ModelPreset;
  isSubmitting: boolean;
  onChange: (next: ModelFormData) => void;
  onPresetSelect: (presetKey: string) => void;
  onReset: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function ModelSettingsForm({
  embedded = false,
  formRef,
  editingId,
  preserveSavedKey = false,
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
  const tv = useTranslations("settingsValidation");
  const errors = Object.fromEntries(Object.entries(validateModelSettings(formData)).map(([field, issue]) => [
    field,
    issue === "invalidJson" || issue === "objectRequired"
      ? t(`validation.${issue}`, { field: t(field === "headersText" ? "form.headers" : "form.params") })
      : tv(issue),
  ]));
  const validation = useSettingsValidation({ scope: editingId, errors, busy: isSubmitting });
  const apiFormatLabel = (value: ModelFormData["api_format"]) => {
    if (value === "openai_compatible") return t("form.protocolOpenaiCompatible");
    if (value === "openai_responses") return "OpenAI Responses";
    if (value === "anthropic_native") return t("form.protocolAnthropicNative");
    if (value === "ollama_local") return t("form.protocolOllamaLocal");
    return t("form.protocolCustom");
  };

  return (
    <SettingsForm
      embedded={embedded}
      formRef={formRef}
      title={editingId ? t("editModel") : t("addModel")}
      closeLabel={t("form.close")}
      submitLabel={editingId ? tc("update") : tc("save")}
      busy={isSubmitting}
      testId="model"
      feedback={validation.summary}
      onCancel={onReset}
      onSubmit={event => validation.submit(event, onSubmit)}
    >
      <ModelProviderPicker key={editingId ?? "new"} value={formData.provider} initiallyExpanded={!editingId} onSelect={onPresetSelect} />

      <div className={styles.grid}>
        <div>
          <label htmlFor={validation.id("name")} className={styles.label}>
            {t("form.serviceName")}
          </label>
          <input {...validation.field("name")}
            type="text"
            value={formData.name}
            onChange={(event) => onChange({ ...formData, name: event.target.value })}
            data-testid="model-name-input"
            data-settings-primary-field=""
            className={styles.control}
            placeholder={t("form.serviceNameHint")}
            required
          />
          {validation.error("name")}
        </div>
        <div>
          <label htmlFor={validation.id("model_id")} className={styles.label}>
            {t("form.model")}
          </label>
          <input {...validation.field("model_id")}
            type="text"
            value={formData.model_id}
            onChange={(event) => onChange({ ...formData, model_id: event.target.value })}
            data-testid="model-id-input"
            className={styles.control}
            placeholder={t("modelIdPlaceholder")}
            required
          />
          {validation.error("model_id")}
        </div>
        <div className={styles.fullWidth}>
          <label htmlFor={validation.id("base_url")} className={styles.label}>
            {t("form.serviceAddress")}
          </label>
          <input {...validation.field("base_url", validation.id("base_url-hint"))}
            type="url"
            value={formData.base_url}
            onChange={(event) => onChange({ ...formData, base_url: event.target.value })}
            data-testid="model-base-url-input"
            className={styles.control}
            placeholder="https://api.example.com/v1"
            required={activePreset.addressRequired}
          />
          {validation.error("base_url")}
          <p id={validation.id("base_url-hint")} className={styles.hint}>
            {t(formData.provider === "qwen" ? "form.qwenAddressHint" : "form.serviceAddressHint")}
          </p>
        </div>
        <div className={styles.fullWidth}>
          <label htmlFor={validation.id("api_key")} className={styles.label}>
            {t("form.accessKey")}{" "}
            {preserveSavedKey && (
              <span className="font-normal text-muted-foreground">{t("apiKeyEditHint")}</span>
            )}
          </label>
          <input {...validation.field("api_key")}
            type="password"
            value={formData.api_key}
            onChange={(event) => onChange({ ...formData, api_key: event.target.value })}
            data-testid="model-api-key-input"
            className={styles.control}
            placeholder={formData.api_key_optional ? t("apiKeyLocalHint") : "sk-..."}
          />
          {formData.provider === "orcarouter" && <a href={ORCAROUTER_REFERRAL_URL} target="_blank" rel="noopener noreferrer sponsored" className="mt-2 inline-flex min-h-8 items-center text-xs text-primary underline underline-offset-4">{t("orcaGetKey")}</a>}
        </div>
        <label htmlFor={validation.id("is_default")} className={styles.fullWidth + " " + styles.checkbox}>
          <input {...validation.field("is_default")}
            type="checkbox"
            checked={formData.is_default}
            onChange={(event) => onChange({ ...formData, is_default: event.target.checked })}
            data-testid="model-default-checkbox"
            className="h-4 w-4 rounded text-primary"
          />
          {t("form.defaultService")}
        </label>
      </div>

      <SettingsDisclosure title={t("form.compatibility")} data-testid="model-compatibility-settings">
        <div className={styles.grid}>
          <div>
            <label htmlFor={validation.id("api_format")} className={styles.label}>
              {t("form.protocol")}
            </label>
            <select {...validation.field("api_format")}
              value={formData.api_format}
              onChange={(event) =>
                onChange({
                  ...formData,
                  api_format: event.target.value as ModelFormData["api_format"],
                })
              }
              data-testid="model-api-format-select"
              className={styles.control}
            >
              <option value="openai_compatible">
                {apiFormatLabel("openai_compatible")}
              </option>
              <option value="openai_responses">OpenAI Responses</option>
              <option value="anthropic_native">
                {apiFormatLabel("anthropic_native")}
              </option>
              <option value="ollama_local">{apiFormatLabel("ollama_local")}</option>
              <option value="custom">{apiFormatLabel("custom")}</option>
            </select>
          </div>
          <label htmlFor={validation.id("api_key_optional")} className={styles.checkbox + " self-end"}>
            <input {...validation.field("api_key_optional")}
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
            <label htmlFor={validation.id("headersText")} className={styles.label}>
              {t("form.headers")}
            </label>
            <textarea {...validation.field("headersText")}
              value={formData.headersText}
              onChange={(event) => onChange({ ...formData, headersText: event.target.value })}
              data-testid="model-headers-textarea"
              className={styles.control + " h-32 font-mono"}
            />
            {validation.error("headersText")}
          </div>
          <div>
            <label htmlFor={validation.id("queryParamsText")} className={styles.label}>
              {t("form.params")}
            </label>
            <textarea {...validation.field("queryParamsText")}
              value={formData.queryParamsText}
              onChange={(event) =>
                onChange({ ...formData, queryParamsText: event.target.value })
              }
              data-testid="model-query-params-textarea"
              className={styles.control + " h-32 font-mono"}
            />
            {validation.error("queryParamsText")}
          </div>
        </div>
      </SettingsDisclosure>
    </SettingsForm>
  );
}
