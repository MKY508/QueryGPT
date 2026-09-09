"use client";

import { useMemo } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { ModelSettingsForm } from "@/components/settings/model-settings/ModelSettingsForm";
import { ModelSettingsList } from "@/components/settings/model-settings/ModelSettingsList";
import { useModelSettingsResource } from "@/components/settings/hooks/useModelSettingsResource";
import { useSettingsFormSession } from "@/components/settings/hooks/useSettingsFormSession";
import {
  MODEL_PRESETS,
  buildModelFormData,
  initialModelFormData,
  selectModelPreset,
} from "@/lib/settings/models";
import type { ConfiguredModel } from "@/lib/types/api";
import { useTranslations } from "next-intl";
import styles from "./SettingsWorkspace.module.css";
import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/InlineNotice";
import { SettingsEditor } from "@/components/settings/SettingsEditor";

export function ModelSettings({ active = true }: { active?: boolean }) {
  const t = useTranslations("modelSettings");
  const tc = useTranslations("common");
  const te = useTranslations("settingsEditor");
  const {
    models,
    isLoading,
    loadFailed,
    hasLoaded,
    refreshing,
    refresh,
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
  }, active);
  const { showForm, editingId, formData, setFormData, writeBusy, formRef, addRef, create, edit,
    close: resetForm, submit, unavailable, dismissUnavailable, confirmation, confirming } = useSettingsFormSession({ initial: initialModelFormData, kind: "models", active,
    busy: isSubmitting || deletePending,
    resolveEdit: id => { const model = models.find(model => model.id === id); return model ? buildModelFormData(model) : null; },
    onTransition: clearError,
  });
  const activePreset = useMemo(
    () => MODEL_PRESETS[formData.provider] || MODEL_PRESETS.custom,
    [formData.provider]
  );
  const displayError = unavailable ?? error;

  const applyPreset = (presetKey: string) => {
    setFormData((current) => selectModelPreset(current, presetKey));
  };

  const handleEdit = (model: ConfiguredModel) => {
    edit(model.id);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (writeBusy) return;

    try {
      await submit((value, id) => id ? updateModel(id, value) : addModel(value));
    } catch {
      // Error state is already handled by the resource hook.
    }
  };

  const handleDelete = (id: string) => {
    deleteModel(id);
  };

  const notice = displayError && <InlineNotice dismissLabel={t("dismissError")} onDismiss={() => {
    dismissUnavailable(); clearError();
  }}>{displayError}</InlineNotice>;

  return (
    <div className={showForm ? styles.split : undefined}>
      <div className="min-w-0 space-y-7">
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="icon" onClick={() => void refresh()} disabled={refreshing || writeBusy}
          aria-label={tc("refresh")} title={tc("refresh")}>
          <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
        </Button>
        <Button ref={addRef}
          disabled={writeBusy}
          onClick={create}
          data-testid="model-add-button"
        >
          <Plus size={16} />
          {t("addService")}
        </Button>
      </div>

      {loadFailed && <InlineNotice>{t(hasLoaded ? "refreshError" : "loadError")}</InlineNotice>}

      {!showForm && notice}

      {(!loadFailed || hasLoaded) && <ModelSettingsList
        models={models}
        editingId={editingId}
        isLoading={isLoading}
        checks={checks}
        deletePending={deletePending}
        actionsDisabled={writeBusy}
        onTest={testModel}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />}
      </div>
      {showForm && <SettingsEditor active={active} confirming={confirming} title={te(editingId ? "editModel" : "newModel")}
        disabled={writeBusy} onClose={resetForm} notice={notice}>
        <ModelSettingsForm embedded
          formRef={formRef}
          editingId={editingId}
          preserveSavedKey={Boolean(editingId && models.some(model => model.id === editingId && model.provider === formData.provider))}
          formData={formData}
          activePreset={activePreset}
          isSubmitting={writeBusy}
          onChange={setFormData}
          onPresetSelect={applyPreset}
          onReset={resetForm}
          onSubmit={handleSubmit}
        />
      </SettingsEditor>}
      {confirmation}
    </div>
  );
}
