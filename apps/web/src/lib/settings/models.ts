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
}

export type ModelTestResult = {
  id: string;
  success: boolean;
  message: string;
  response_time_ms?: number;
} & ModelDiagnostics;

export type ModelJsonMapField = "headers" | "queryParams";
export type ModelJsonMapErrorReason = "invalidJson" | "objectRequired";

export class ModelJsonMapError extends Error {
  constructor(
    readonly field: ModelJsonMapField,
    readonly reason: ModelJsonMapErrorReason
  ) {
    super();
    this.name = "ModelJsonMapError";
  }
}

export type ModelPreset = Pick<
  ModelFormData,
  "provider" | "api_format" | "base_url" | "api_key_optional"
> & { model_id?: string; addressRequired?: boolean };

export const MODEL_PRESETS: Record<string, ModelPreset> = {
  orcarouter: {
    provider: "orcarouter",
    api_format: "openai_compatible",
    base_url: "https://api.orcarouter.ai/v1",
    model_id: "orcarouter/auto",
    api_key_optional: false,
  },
  openai: {
    provider: "openai",
    api_format: "openai_compatible",
    base_url: "https://api.openai.com/v1",
    model_id: "gpt-4o",
    api_key_optional: false,
  },
  deepseek: {
    provider: "deepseek",
    api_format: "openai_compatible",
    base_url: "https://api.deepseek.com",
    model_id: "deepseek-chat",
    api_key_optional: false,
  },
  groq: {
    provider: "groq",
    api_format: "openai_compatible",
    base_url: "https://api.groq.com/openai/v1",
    model_id: "openai/gpt-oss-120b",
    api_key_optional: false,
  },
  qwen: {
    provider: "qwen",
    api_format: "openai_compatible",
    base_url: "",
    model_id: "qwen-plus",
    addressRequired: true,
    api_key_optional: false,
  },
  anthropic: {
    provider: "anthropic",
    api_format: "anthropic_native",
    base_url: "https://api.anthropic.com",
    api_key_optional: false,
  },
  ollama: {
    provider: "ollama",
    api_format: "ollama_local",
    base_url: "http://localhost:11434",
    api_key_optional: true,
  },
  custom: {
    provider: "custom",
    api_format: "openai_compatible",
    base_url: "",
    addressRequired: true,
    api_key_optional: false,
  },
};

export function selectModelPreset(current: ModelFormData, key: string): ModelFormData {
  const preset = MODEL_PRESETS[key] ?? MODEL_PRESETS.custom;
  if (current.provider === preset.provider) return current;
  return {
    ...current,
    provider: preset.provider,
    model_id: preset.model_id ?? "",
    base_url: preset.base_url,
    api_format: preset.api_format,
    api_key_optional: preset.api_key_optional,
    api_key: "",
    headersText: "{}",
    queryParamsText: "{}",
  };
}

// Account attribution is established by OrcaRouter at signup, not by API headers.
export const ORCAROUTER_REFERRAL_URL = "https://www.orcarouter.ai/ref/ref_86d1b2f35d6800d5f85b";

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
};

export function prettifyJson(value: Record<string, string> | undefined): string {
  return JSON.stringify(value || {}, null, 2);
}

export function parseJsonMap(
  value: string,
  field: ModelJsonMapField
): Record<string, string> {
  if (!value.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ModelJsonMapError(field, "invalidJson");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ModelJsonMapError(field, "objectRequired");
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
      headers: parseJsonMap(formData.headersText, "headers"),
      query_params: parseJsonMap(formData.queryParamsText, "queryParams"),
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
  };
}
