"use client";

import { Check, Eye, Loader2, PencilLine, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/** Mode selection never writes a document; saving remains an explicit action. */
export function ReportEditingControls({ editing, onModeChange, canSave, status, onSave }: {
  editing: boolean;
  onModeChange: (editing: boolean) => void;
  canSave: boolean;
  status: "ready" | "saving" | "saved";
  onSave: () => void;
}) {
  const t = useTranslations("reportWorkspace");
  const modes = [
    { value: false, label: t("read"), accessibleLabel: t("readReport"), Icon: Eye },
    { value: true, label: t("edit"), accessibleLabel: t("editReport"), Icon: PencilLine },
  ];
  return <div className="flex shrink-0 items-center gap-2">
    <div role="group" aria-label={t("reportMode")} className="flex h-9 items-center gap-0.5 rounded-md border border-border bg-background p-0.5">
      {modes.map(({ value, label, accessibleLabel, Icon }) => <Button key={String(value)} size="sm"
        variant={editing === value ? "primary" : "ghost"} aria-pressed={editing === value} aria-label={accessibleLabel}
        onClick={() => { if (editing !== value) onModeChange(value); }}>
        <Icon size={13} aria-hidden="true" /><span>{label}</span>
      </Button>)}
    </div>
    {editing && <Button onClick={onSave} disabled={!canSave || status === "saving"}
      aria-label={t(status === "saving" ? "saving" : "save")} className="min-w-20 text-xs">
      {status === "saving" ? <Loader2 size={14} aria-hidden="true" className="animate-spin" />
        : status === "saved" ? <Check size={14} aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}
      <span>{t(status === "saving" ? "saving" : status === "saved" ? "saved" : "save")}</span>
    </Button>}
  </div>;
}
