import type { ConnectionFormData } from "./connections";
import { MODEL_PRESETS, ModelJsonMapError, parseJsonMap, type ModelFormData } from "./models";

export type SettingsIssue =
  | "required" | "nameTooLong" | "port" | "serviceUrl" | "urlCredentials"
  | "urlFragment" | "schema" | "certificatePath" | "pathTooLong"
  | "caRequired" | "certificatePair" | "encryptionRequired"
  | "invalidJson" | "objectRequired";
export type ModelField = keyof ModelFormData;
export type ConnectionField = keyof Omit<ConnectionFormData, "extra_options"> | keyof ConnectionFormData["extra_options"];
export type SettingsIssues<Field extends string> = Partial<Record<Field, SettingsIssue>>;

function nameIssue(value: string): SettingsIssue | undefined {
  if (!value.trim()) return "required";
  // Pydantic counts Unicode code points, not UTF-16 code units.
  if ([...value].length > 100) return "nameTooLong";
}

export function validateModelSettings(value: ModelFormData): SettingsIssues<ModelField> {
  const issues: SettingsIssues<ModelField> = {};
  const name = nameIssue(value.name.trim());
  if (name) issues.name = name;
  if (!value.model_id.trim()) issues.model_id = "required";
  const address = value.base_url.trim();
  if (!address && MODEL_PRESETS[value.provider]?.addressRequired) issues.base_url = "required";
  if (address) {
    try {
      const url = new URL(address);
      // URL() repairs incomplete addresses; the API requires an explicit authority.
      const authority = /^https?:\/\/([^/?#]+)/i.exec(address)?.[1];
      if (!authority || !url.hostname || !["http:", "https:"].includes(url.protocol)) {
        issues.base_url = "serviceUrl";
      } else if (authority.includes("@")) {
        issues.base_url = "urlCredentials";
      } else if (url.hash) {
        issues.base_url = "urlFragment";
      }
    } catch {
      issues.base_url = "serviceUrl";
    }
  }
  for (const [field, mapField] of [["headersText", "headers"], ["queryParamsText", "queryParams"]] as const) {
    try {
      parseJsonMap(value[field], mapField);
    } catch (error) {
      if (!(error instanceof ModelJsonMapError)) throw error;
      issues[field] = error.reason;
    }
  }
  return issues;
}

export function validateConnectionSettings(value: ConnectionFormData): SettingsIssues<ConnectionField> {
  const issues: SettingsIssues<ConnectionField> = {};
  const name = nameIssue(value.name);
  if (name) issues.name = name;
  if (!value.database.trim()) issues.database = "required";
  if (value.driver === "sqlite") return issues;
  if (!value.host.trim()) issues.host = "required";
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) issues.port = "port";
  if (!value.username.trim()) issues.username = "required";

  const options = value.extra_options;
  const schema = options.schema.trim();
  if (value.driver === "postgresql" && schema && !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(schema)) {
    issues.schema = "schema";
  }
  const paths = ["sslrootcert", "sslcert", "sslkey"] as const;
  if (options.sslmode === "disable") {
    if (paths.some(field => options[field].trim())) issues.sslmode = "encryptionRequired";
    return issues;
  }
  for (const field of paths) {
    const path = options[field].trim();
    if (/[\r\n\0]/.test(path) || path.toUpperCase().includes("-----BEGIN ")) {
      issues[field] = "certificatePath";
    } else if ([...path].length > 4096) {
      issues[field] = "pathTooLong";
    }
  }
  if (["verify-ca", "verify-full"].includes(options.sslmode) && !options.sslrootcert.trim()) {
    issues.sslrootcert = "caRequired";
  }
  if (Boolean(options.sslcert.trim()) !== Boolean(options.sslkey.trim())) {
    issues[options.sslcert.trim() ? "sslkey" : "sslcert"] = "certificatePair";
  }
  return issues;
}
