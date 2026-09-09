"use client";

import { CheckCircle, Database, Loader2, Play, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ConfiguredConnection } from "@/lib/types/api";
import { CONNECTION_DRIVERS, formatConnectionTarget, getConnectionDatabase } from "@/lib/settings/connections";
import { SettingsCollection, matchesSettingsItem } from "@/components/settings/SettingsCollection";
import { useArmedAction } from "@/lib/hooks/useArmedAction";
import { ArmedDeleteButton } from "@/components/ui/armed-delete-button";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import styles from "../SettingsResourceCard.module.css";

export function ConnectionSettingsList({ connections, isLoading, editingId, testResult, testingConnectionId, actionsDisabled,
  onEdit, onTest, onDelete }: {
  connections: ConfiguredConnection[]; isLoading: boolean; editingId: string | null;
  testResult: { id: string; success: boolean; text: string } | null;
  testingConnectionId: string | null; actionsDisabled: boolean;
  onEdit: (connection: ConfiguredConnection) => void; onTest: (id: string) => void; onDelete: (id: string) => void;
}) {
  const t = useTranslations("connectionSettings"), tc = useTranslations("common"), tl = useTranslations("settingsCollection");
  const { armedId, request, disarm } = useArmedAction();
  if (isLoading) return <div role="status" aria-label={tc("loading")} className="flex items-center justify-center py-12"><Loader2 aria-hidden="true" className="animate-spin text-muted-foreground" size={24} /></div>;
  return <SettingsCollection items={connections} searchLabel={tl("searchConnections")} filterLabel={tl("connectionFilter")}
    options={[{ value: "all", label: tl("allConnections") }, ...CONNECTION_DRIVERS.map(driver => ({ value: driver.value, label: driver.label }))]}
    matches={(connection, query, filter) => (filter === "all" || connection.driver === filter) && matchesSettingsItem(query,
      [connection.name, connection.driver, connection.host, getConnectionDatabase(connection)])}
    onBrowse={disarm} empty={<div className="py-12 text-center text-muted-foreground"><p>{t("noConnections")}</p><p className="mt-1 text-sm">{t("addFirstConnection")}</p></div>}>
    {visible => <ul className="space-y-3">{visible.map(connection => <li key={connection.id} data-testid={`connection-card-${connection.id}`}
      className={styles.card} data-editing={editingId === connection.id}>
      <div className={styles.heading}>
        <div className={styles.identity}><Database size={18} /></div>
        <button type="button" onClick={() => { disarm(); onEdit(connection); }} disabled={actionsDisabled}
          aria-label={tl("editItem", { name: connection.name })} title={tc("edit")}
          className="min-w-0 rounded-md text-left outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50">
          <span className="block text-sm font-semibold [overflow-wrap:anywhere]">{connection.name}</span>
          <span className={styles.target} title={formatConnectionTarget(connection)}>{formatConnectionTarget(connection)}</span>
        </button>
        {connection.is_default && <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">{tl("default")}</span>}
      </div>
      <div className={styles.footer}>
        <div className={styles.feedback} role="status" aria-atomic="true">
          {testResult?.id === connection.id && <p data-testid={`connection-test-result-${connection.id}`} data-status={testResult.success ? "success" : "error"}
            className={cn("flex items-start gap-2", testResult.success ? "text-success" : "text-destructive")}>
            {testResult.success ? <CheckCircle size={14} className="mt-0.5 shrink-0" /> : <XCircle size={14} className="mt-0.5 shrink-0" />}{testResult.text}
          </p>}
        </div>
        <div className={styles.actions}>
          <Button type="button" variant="outline" onClick={() => { disarm(); onTest(connection.id); }}
            disabled={actionsDisabled || testingConnectionId === connection.id}
            data-testid={`connection-test-${connection.id}`} aria-label={tl("checkConnection", { name: connection.name })} title={t("testConnection")}
            className="text-xs">
            {testingConnectionId === connection.id ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}{tl("check")}
          </Button>
          <ArmedDeleteButton armed={armedId === connection.id} onRequest={() => request(connection.id, () => onDelete(connection.id))}
            confirmLabel={tc("confirmDelete")} deleteLabel={tl("deleteItem", { name: connection.name })} disabled={actionsDisabled} />
        </div>
      </div>
    </li>)}</ul>}
  </SettingsCollection>;
}
