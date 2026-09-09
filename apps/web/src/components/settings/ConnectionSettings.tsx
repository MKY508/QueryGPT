"use client";

import { Plus, RefreshCw } from "lucide-react";
import { ConnectionSettingsList } from "@/components/settings/connection-settings/ConnectionSettingsList";
import { ConnectionSettingsForm } from "@/components/settings/connection-settings/ConnectionSettingsForm";
import { useConnectionSettingsResource } from "@/components/settings/hooks/useConnectionSettingsResource";
import { useSettingsFormSession } from "@/components/settings/hooks/useSettingsFormSession";
import {
  applyDriverDefaults,
  buildConnectionFormData,
  defaultConnectionFormData,
} from "@/lib/settings/connections";
import type { ConfiguredConnection } from "@/lib/types/api";
import { useTranslations } from "next-intl";
import styles from "./SettingsWorkspace.module.css";
import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/InlineNotice";
import { SettingsEditor } from "@/components/settings/SettingsEditor";

export function ConnectionSettings({ active = true }: { active?: boolean }) {
  const t = useTranslations("connectionSettings");
  const tc = useTranslations("common");
  const te = useTranslations("settingsEditor");
  const {
    connections,
    isLoading,
    loadFailed,
    hasLoaded,
    refreshing,
    refresh,
    error,
    clearError,
    testResult,
    deletePending,
    testingConnectionId,
    addConnection,
    updateConnection,
    deleteConnection,
    testConnection,
    isSubmitting,
  } = useConnectionSettingsResource({
    success: t("testResultSuccess"),
    failure: t("testResultFailed"),
    requestFailure: t("testRequestFailed"),
  }, active);
  const { showForm, editingId, formData, setFormData, writeBusy, formRef, addRef, create, edit,
    close: resetForm, submit, unavailable, dismissUnavailable, confirmation, confirming } = useSettingsFormSession({ initial: defaultConnectionFormData, kind: "connections", active,
    busy: isSubmitting || deletePending,
    resolveEdit: id => { const connection = connections.find(connection => connection.id === id); return connection ? buildConnectionFormData(connection) : null; },
    onTransition: clearError,
  });

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (writeBusy) return;
    try {
      await submit((value, id) => id ? updateConnection(id, value) : addConnection(value));
    } catch {
      // The resource exposes a localized error; never log credential payloads.
    }
  };

  const handleEdit = (connection: ConfiguredConnection) => {
    edit(connection.id);
  };

  const handleDelete = (id: string) => {
    deleteConnection(id);
  };

  const notice = (unavailable || error) && <InlineNotice dismissLabel={t("dismissError")} onDismiss={() => {
    dismissUnavailable(); clearError();
  }}>{unavailable ?? (error ? t(error) : null)}</InlineNotice>;

  return (
    <div className={showForm ? styles.split : undefined}>
      <div className="min-w-0">
      <div className="mb-7 flex items-center justify-end gap-2">
        <Button variant="ghost" size="icon" onClick={() => void refresh()} disabled={refreshing || writeBusy}
          aria-label={tc("refresh")} title={tc("refresh")}>
          <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
        </Button>
        <Button ref={addRef}
          disabled={writeBusy}
          onClick={create}
          data-testid="connection-add-button"
        >
          <Plus size={16} />
          {t("addDatabase")}
        </Button>
      </div>

      {loadFailed && <InlineNotice>{t(hasLoaded ? "refreshError" : "loadError")}</InlineNotice>}
      {!showForm && notice}

      {(!loadFailed || hasLoaded) && <ConnectionSettingsList connections={connections} isLoading={isLoading}
        editingId={editingId} testResult={testResult} testingConnectionId={testingConnectionId}
        actionsDisabled={writeBusy} onEdit={handleEdit} onTest={testConnection} onDelete={handleDelete} />}
      </div>
      {showForm && <SettingsEditor active={active} confirming={confirming} title={te(editingId ? "editConnection" : "newConnection")}
        disabled={writeBusy} onClose={resetForm} notice={notice}>
        <ConnectionSettingsForm embedded
          formRef={formRef}
          editingId={editingId}
          formData={formData}
          isSubmitting={writeBusy}
          onChange={setFormData}
          onDriverChange={(driver) => setFormData((current) => applyDriverDefaults(current, driver))}
          onReset={resetForm}
          onSubmit={handleSubmit}
        />
      </SettingsEditor>}
      {confirmation}
    </div>
  );
}
