import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api/client";
import type { AppSettings, ModelSummary } from "@/lib/types/api";
import { getAnalysisServicePresentation } from "./AnalysisServiceSelector";

export interface AnalysisModelSelectionOptions {
  lockedModelId?: string | null;
  selectionLocked?: boolean;
}

type ModelChoice = { id: string; baseline: string | null };

export function useAnalysisModelSelection(
  models: ModelSummary[] | undefined,
  appSettings: AppSettings | undefined,
  options: AnalysisModelSelectionOptions = {}
) {
  const t = useTranslations("chatArea");
  const queryClient = useQueryClient();
  const [choice, setChoice] = useState<ModelChoice | null>(null);
  const [modelSelectionError, setModelSelectionError] = useState<string | null>(null);
  const writing = useRef(false);

  const mutation = useMutation<AppSettings, unknown, ModelChoice>({
    retry: false,
    networkMode: "always",
    mutationFn: async ({ id }) => {
      const response = await api.put("/api/v1/settings", { default_model_id: id });
      const settings = response.data.data as AppSettings | undefined;
      if (!settings || settings.default_model_id !== id) {
        throw new Error("Unconfirmed default model");
      }
      return settings;
    },
    onSuccess: async (settings, submitted) => {
      await queryClient.cancelQueries({ queryKey: ["app-settings"], exact: true });
      queryClient.setQueryData<AppSettings>(["app-settings"], (current) => {
        if (current && current.default_model_id !== submitted.baseline) return current;
        return { ...(current || settings), default_model_id: submitted.id };
      });
    },
    onError: () => {
      setChoice(null);
      setModelSelectionError(t("serviceSaveFailed"));
    },
    onSettled: () => {
      writing.current = false;
      void queryClient.invalidateQueries({ queryKey: ["app-settings"], exact: true });
    },
  });

  const defaultId = appSettings?.default_model_id || null;
  if (choice && !mutation.isPending && defaultId !== choice.baseline) setChoice(null);
  const activeModels = (models || []).filter((model) => model.is_active !== false);
  const preferredId = options.selectionLocked
    ? options.lockedModelId
    : choice && (mutation.isPending || defaultId === choice.baseline) ? choice.id : defaultId;
  const selectedModel = activeModels.find((model) => model.id === preferredId)
    || (!options.selectionLocked && !choice ? activeModels.find((model) => model.is_default) : undefined);
  const selectedModelPresentation = selectedModel ? getAnalysisServicePresentation(selectedModel) : null;

  const selectModel = (modelId: string) => {
    if (options.selectionLocked || writing.current) return;
    if (!appSettings) {
      setModelSelectionError(t("serviceSettingsNotLoaded"));
      return;
    }
    const model = activeModels.find((candidate) => candidate.id === modelId);
    if (!model || !getAnalysisServicePresentation(model).selectable) return;
    const submitted = { id: modelId, baseline: defaultId };
    writing.current = true;
    setChoice(submitted);
    setModelSelectionError(null);
    mutation.mutate(submitted);
  };

  return {
    selectedModelId: selectedModel?.id || null,
    selectedModel,
    selectedModelPresentation,
    modelReady: Boolean(selectedModelPresentation?.selectable),
    selectModel,
    modelSelectionLocked: Boolean(options.selectionLocked),
    modelSelectionSaving: mutation.isPending,
    modelSelectionError,
    clearModelSelectionError: () => setModelSelectionError(null),
  };
}
