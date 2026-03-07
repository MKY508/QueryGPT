import type {
  ConfiguredModel,
  ModelDiagnostics,
  ModelExtraOptions,
} from "@/lib/types/api";

export interface ModelFormData {
  name: string;
  provider: string;
  model_id: string;
  base_url: string;
  api_key: string;
  is_default: boolean;
  api_format: NonNullable<ModelExtraOptions["api_format"]>;
  api_key_optional: boolean;
  headersText: string;
  queryParamsText: string;
  healthcheck_mode: NonNullable<ModelExtraOptions["healthcheck_mode"]>;
}

export type ModelTestResult = {
  id: string;
  success: boolean;
  message: string;
  response_time_ms?: number;
} & ModelDiagnostics;

export type ModelPreset = Pick<
  ModelFormData,
  "provider" | "api_format" | "base_url" | "api_key_optional" | "healthcheck_mode"
>;

export const MODEL_PRESETS: Record<string, ModelPreset> = {
  openai: {
    provider: "openai",
    api_format: "openai_compatible",
    base_url: "",
    api_key_optional: false,
    healthcheck_mode: "chat_completion",
  },
  deepseek: {
    provider: "deepseek",
    api_format: "openai_compatible",
    base_url: "https://api.deepseek.com",
    api_key_optional: false,
    healthcheck_mode: "chat_completion",
  },
  anthropic: {
    provider: "anthropic",
    api_format: "anthropic_native",
    base_url: "https://api.anthropic.com",
    api_key_optional: false,
    healthcheck_mode: "chat_completion",
  },
  ollama: {
    provider: "ollama",
    api_format: "ollama_local",
    base_url: "http://localhost:11434",
    api_key_optional: true,
    healthcheck_mode: "chat_completion",
  },
  custom: {
    provider: "custom",
    api_format: "openai_compatible",
    base_url: "",
    api_key_optional: false,
    healthcheck_mode: "chat_completion",
  },
};

export const initialModelFormData: ModelFormData = {
  name: "",
  provider: "openai",
  model_id: "gpt-4o",
  base_url: "",
  api_key: "",
  is_default: false,
  api_format: "openai_compatible",
  api_key_optional: false,
  headersText: "{}",
  queryParamsText: "{}",
  healthcheck_mode: "chat_completion",
};

export function prettifyJson(value: Record<string, string> | undefined): string {
  return JSON.stringify(value || {}, null, 2);
}

export function parseJsonMap(value: string, label: string): Record<string, string> {
  if (!value.trim()) return {};
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} 必须是 JSON 对象`);
  }

  const normalized: Record<string, string> = {};
  for (const [key, item] of Object.entries(parsed)) {
    normalized[key] = String(item);
  }
  return normalized;
}

export function buildModelPayload(formData: ModelFormData) {
  return {
    name: formData.name.trim(),
    provider: formData.provider,
    model_id: formData.model_id.trim(),
    base_url: formData.base_url.trim() || null,
    api_key: formData.api_key.trim() || null,
    is_default: formData.is_default,
    extra_options: {
      api_format: formData.api_format,
      api_key_optional: formData.api_key_optional,
      healthcheck_mode: formData.healthcheck_mode,
      headers: parseJsonMap(formData.headersText, "Headers"),
      query_params: parseJsonMap(formData.queryParamsText, "Query Params"),
    },
  };
}

export function buildModelFormData(model: ConfiguredModel): ModelFormData {
  return {
    name: model.name,
    provider: model.provider,
    model_id: model.model_id,
    base_url: model.base_url || "",
    api_key: "",
    is_default: model.is_default,
    api_format:
      model.extra_options?.api_format ||
      MODEL_PRESETS[model.provider]?.api_format ||
      "openai_compatible",
    api_key_optional: model.extra_options?.api_key_optional || model.provider === "ollama",
    headersText: prettifyJson(model.extra_options?.headers),
    queryParamsText: prettifyJson(model.extra_options?.query_params),
    healthcheck_mode: model.extra_options?.healthcheck_mode || "chat_completion",
  };
}
