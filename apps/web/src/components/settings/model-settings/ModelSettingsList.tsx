"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ConfiguredModel } from "@/lib/types/api";
import { getModelServiceState, type ModelServiceCheck } from "@/lib/settings/model-service";
import { useArmedAction } from "@/lib/hooks/useArmedAction";
import { SettingsCollection, matchesSettingsItem } from "@/components/settings/SettingsCollection";
import { ModelServiceCard } from "./ModelServiceCard";

interface ModelSettingsListProps {
  models: ConfiguredModel[];
  isLoading: boolean;
  checks: Record<string, ModelServiceCheck>;
  deletePending: boolean;
  actionsDisabled?: boolean;
  editingId?: string | null;
  onTest: (id: string) => void;
  onEdit: (model: ConfiguredModel) => void;
  onDelete: (id: string) => void;
}

export function ModelSettingsList({ models, isLoading, checks, deletePending,
  actionsDisabled = false, editingId = null, onTest, onEdit, onDelete,
}: ModelSettingsListProps) {
  const t = useTranslations("modelSettings");
  const tl = useTranslations("settingsCollection");
  const { armedId, request: requestDelete, disarm } = useArmedAction();

  if (isLoading) return <div role="status" className="flex justify-center py-12">
    <Loader2 className="animate-spin text-muted-foreground" size={24} aria-hidden="true" />
    <span className="sr-only">{t("loadingServices")}</span>
  </div>;

  return <SettingsCollection items={models} searchLabel={tl("searchModels")} filterLabel={tl("modelFilter")}
    options={[{ value: "all", label: tl("allModels") }, { value: "default", label: tl("defaultModels") }, { value: "attention", label: tl("needsAttention") }]}
    matches={(model, query, filter) => {
      const check = checks[model.id];
      const state = getModelServiceState(model, check?.status === "complete" ? check.result : null);
      return (filter === "all" || filter === "default" && model.is_default || filter === "attention" && state !== "available" && state !== "unchecked")
        && matchesSettingsItem(query, [model.name, model.provider, model.model_id]);
    }}
    onBrowse={disarm}
    empty={<div className="rounded-xl border border-dashed border-border px-6 py-16 text-center">
      <p className="font-serif text-xl text-foreground">{t("noModels")}</p>
      <p className="mt-2 text-sm text-muted-foreground">{t("selectPresetFirst")}</p>
    </div>}>
    {visible => <ul className="space-y-3 [container-type:inline-size]">
      {visible.map(model => <ModelServiceCard key={model.id} model={model}
        check={checks[model.id]}
        disabled={actionsDisabled || deletePending} editing={editingId === model.id} deleteArmed={armedId === model.id}
        onEdit={() => { disarm(); onEdit(model); }} onTest={() => { disarm(); onTest(model.id); }}
        onDelete={() => requestDelete(model.id, () => onDelete(model.id))} onInspect={disarm} />)}
    </ul>}
  </SettingsCollection>;
}
