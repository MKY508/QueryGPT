"use client";

import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { ModelSettingsForm } from "@/components/settings/model-settings/ModelSettingsForm";
import { ModelSettingsList } from "@/components/settings/model-settings/ModelSettingsList";
import { useModelSettingsResource } from "@/components/settings/hooks/useModelSettingsResource";
import {
  MODEL_PRESETS,
  buildModelFormData,
  buildModelPayload,
  initialModelFormData,
  ModelJsonMapError,
  type ModelFormData,
} from "@/lib/settings/models";
import type { ConfiguredModel } from "@/lib/types/api";
import { useTranslations } from "next-intl";

export function ModelSettings() {
  const t = useTranslations("modelSettings");
  const {
    models,
    isLoading,
    error,
    checks,
    isSubmitting,
    deletePending,
    clearError,
    addModel,
    updateModel,
    deleteModel,
    testModel,
  } = useModelSettingsResource({
    addModelFailed: t("addModelFailed"),
    updateModelFailed: t("updateModelFailed"),
    deleteModelFailed: t("deleteModelFailed"),
  });
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<ModelFormData>(initialModelFormData);
  const [validationError, setValidationError] = useState<string | null>(null);
  const activePreset = useMemo(
    () => MODEL_PRESETS[formData.provider] || MODEL_PRESETS.custom,
    [formData.provider]
  );
  const displayError = validationError ?? error;

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData(initialModelFormData);
    setValidationError(null);
    clearError();
  };

  const applyPreset = (presetKey: string) => {
    const preset = MODEL_PRESETS[presetKey] || MODEL_PRESETS.custom;
    setShowForm(true);
    setValidationError(null);
    setFormData((current) => ({
      ...current,
      provider: preset.provider,
      api_format: preset.api_format,
      base_url: preset.base_url,
      api_key_optional: preset.api_key_optional,
    }));
  };

  const handleEdit = (model: ConfiguredModel) => {
    setEditingId(model.id);
    setFormData(buildModelFormData(model));
    setShowForm(true);
    setValidationError(null);
    clearError();
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    try {
      buildModelPayload(formData);
    } catch (error) {
      if (error instanceof ModelJsonMapError) {
        const field = error.field === "headers" ? t("form.headers") : t("form.params");
        const messageKey =
          error.reason === "invalidJson"
            ? "validation.invalidJson"
            : "validation.objectRequired";
        setValidationError(t(messageKey, { field }));
      } else {
        setValidationError(t("validationError"));
      }
      return;
    }

    setValidationError(null);
    try {
      if (editingId) {
        await updateModel(editingId, formData);
        resetForm();
        return;
      }
      await addModel(formData);
      resetForm();
    } catch {
      // Error state is already handled by the resource hook.
    }
  };

  const handleDelete = (id: string) => {
    deleteModel(id);
  };

  return (
    <div className="space-y-7">
      <div className="flex items-center justify-end">
        <button
          onClick={() => {
            if (showForm) {
              resetForm();
              return;
            }
            setShowForm(true);
          }}
          data-testid="model-add-button"
          className="flex items-center gap-2 bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus size={16} />
          {t("addService")}
        </button>
      </div>

      {displayError && (
        <div className="flex items-center justify-between border-l-2 border-destructive bg-destructive/10 px-4 py-3">
          <span className="text-sm text-destructive">{displayError}</span>
          <button
            onClick={() => {
              setValidationError(null);
              clearError();
            }}
            className="text-destructive/60 hover:text-destructive"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {showForm && (
        <ModelSettingsForm
          editingId={editingId}
          formData={formData}
          activePreset={activePreset}
          isSubmitting={isSubmitting}
          onChange={setFormData}
          onPresetSelect={applyPreset}
          onReset={resetForm}
          onSubmit={handleSubmit}
        />
      )}

      <ModelSettingsList
        models={models}
        isLoading={isLoading}
        checks={checks}
        editingId={editingId}
        actionsDisabled={isSubmitting || deletePending}
        deletePending={deletePending}
        onTest={testModel}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />
    </div>
  );
}
