import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api/client";
import type { AppSettings, ModelSummary } from "@/lib/types/api";
import { getAnalysisServicePresentation } from "./AnalysisServiceSelector";

export interface ChatAreaModelSelectionOptions {
  /** The model recorded by an existing conversation or analysis run. */
  lockedModelId?: string | null;
  /** Prevents a running or existing investigation from silently changing model. */
  selectionLocked?: boolean;
}

export function useChatAreaState(
  models: ModelSummary[] | undefined,
  appSettings: AppSettings | undefined,
  options: ChatAreaModelSelectionOptions = {}
) {
  const t = useTranslations("chatArea");
  const queryClient = useQueryClient();
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [modelSelectionError, setModelSelectionError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const pendingDefaultModelRef = useRef<string | null>(null);

  const updateDefaultModel = useMutation<
    AppSettings,
    unknown,
    string,
    { previousSettings?: AppSettings; previousModelId: string | null }
  >({
    mutationFn: async (modelId) => {
      if (!appSettings) throw new Error(t("serviceSettingsNotLoaded"));
      const response = await api.put("/api/v1/settings", {
        ...appSettings,
        default_model_id: modelId,
      });
      return response.data.data as AppSettings;
    },
    onMutate: async (modelId) => {
      setModelSelectionError(null);
      pendingDefaultModelRef.current = modelId;
      await queryClient.cancelQueries({ queryKey: ["app-settings"] });
      const previousSettings = queryClient.getQueryData<AppSettings>(["app-settings"]);
      const previousModelId = selectedModelId;
      setSelectedModelId(modelId);
      if (appSettings) {
        queryClient.setQueryData<AppSettings>(["app-settings"], {
          ...appSettings,
          default_model_id: modelId,
        });
      }
      return { previousSettings, previousModelId };
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(["app-settings"], settings);
      setSelectedModelId(settings.default_model_id || null);
    },
    onError: (_error, _modelId, context) => {
      pendingDefaultModelRef.current = null;
      if (context?.previousSettings) {
        queryClient.setQueryData(["app-settings"], context.previousSettings);
      }
      setSelectedModelId(context?.previousModelId || null);
      setModelSelectionError(t("serviceSaveFailed"));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["app-settings"] });
    },
  });

  // The backend default is the only durable choice for a new investigation.
  // Existing investigations use their recorded model and never consult browser storage.
  useEffect(() => {
    const activeModels = (models || []).filter((model) => model.is_active !== false);
    if (!activeModels.length) {
      setSelectedModelId(null);
      return;
    }

    if (options.selectionLocked) {
      const lockedModel = activeModels.find((model) => model.id === options.lockedModelId);
      if (lockedModel) setSelectedModelId(lockedModel.id);
      return;
    }

    if (updateDefaultModel.isPending) return;
    const pendingDefaultModelId = pendingDefaultModelRef.current;
    if (pendingDefaultModelId) {
      const pendingModel = activeModels.find(
        (model) => model.id === pendingDefaultModelId
      );
      if (pendingModel) {
        setSelectedModelId(pendingModel.id);
        if (appSettings?.default_model_id === pendingDefaultModelId) {
          pendingDefaultModelRef.current = null;
        }
        return;
      }
      pendingDefaultModelRef.current = null;
    }
    const preferredId = appSettings?.default_model_id;
    const nextId =
      activeModels.find((model) => model.id === preferredId)?.id ||
      activeModels.find((model) => model.is_default)?.id ||
      null;
    setSelectedModelId(nextId);
  }, [
    appSettings?.default_model_id,
    models,
    options.lockedModelId,
    options.selectionLocked,
    updateDefaultModel.isPending,
  ]);

  const selectModel = (modelId: string) => {
    if (options.selectionLocked || updateDefaultModel.isPending) return;
    const model = models?.find(
      (candidate) => candidate.id === modelId && candidate.is_active !== false
    );
    if (!model || !getAnalysisServicePresentation(model).selectable) return;
    updateDefaultModel.mutate(modelId);
  };

  const selectedModel = models?.find((item) => item.id === selectedModelId);
  const selectedModelPresentation = selectedModel
    ? getAnalysisServicePresentation(selectedModel)
    : null;
  const modelReady = Boolean(
    selectedModel &&
      selectedModel.is_active !== false &&
      selectedModelPresentation?.selectable
  );

  return {
    selectedModelId,
    input,
    selectedModel,
    selectedModelPresentation,
    modelReady,
    setInput,
    selectModel,
    modelSelectionLocked: Boolean(options.selectionLocked),
    modelSelectionSaving: updateDefaultModel.isPending,
    modelSelectionError,
    clearModelSelectionError: () => setModelSelectionError(null),
  };
}
