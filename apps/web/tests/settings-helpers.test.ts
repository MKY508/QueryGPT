import { describe, expect, it } from "vitest";
import {
  applyDriverDefaults,
  buildConnectionFormData,
  defaultConnectionFormData,
  formatConnectionTarget,
} from "@/lib/settings/connections";
import type { ConfiguredConnection } from "@/lib/types/api";
import {
  buildModelFormData,
  buildModelPayload,
  ModelJsonMapError,
  parseJsonMap,
} from "@/lib/settings/models";

describe("settings helpers", () => {
  it("parses JSON map and normalizes values to strings", () => {
    expect(parseJsonMap('{"x-test": 1}', "headers")).toEqual({ "x-test": "1" });
  });

  it("returns structured errors for invalid advanced JSON parameters", () => {
    expect(() => parseJsonMap("{", "headers")).toThrow(ModelJsonMapError);

    try {
      parseJsonMap("[]", "queryParams");
    } catch (error) {
      expect(error).toBeInstanceOf(ModelJsonMapError);
      expect(error).toMatchObject({
        field: "queryParams",
        reason: "objectRequired",
      });
    }
  });

  it("builds model payload with normalized fields", () => {
    const payload = buildModelPayload({
      name: " DeepSeek ",
      provider: "deepseek",
      model_id: " deepseek-chat ",
      base_url: " https://api.deepseek.com ",
      api_key: " secret ",
      is_default: true,
      api_format: "openai_compatible",
      api_key_optional: false,
      headersText: '{"x-test":"1"}',
      queryParamsText: '{"temperature":0.1}',
    });

    expect(payload.name).toBe("DeepSeek");
    expect(payload.model_id).toBe("deepseek-chat");
    expect(payload.extra_options.headers).toEqual({ "x-test": "1" });
    expect(payload.extra_options.query_params).toEqual({ temperature: "0.1" });
  });

  it("builds model form data from saved config", () => {
    const formData = buildModelFormData({
      id: "m1",
      name: "Claude",
      provider: "anthropic",
      model_id: "claude-3-7-sonnet",
      base_url: "https://api.anthropic.com",
      is_default: false,
      created_at: "",
      extra_options: {
        api_format: "anthropic_native",
        headers: { "x-test": "1" },
      },
    });

    expect(formData.api_format).toBe("anthropic_native");
    expect(formData.headersText).toContain("x-test");
  });

  it("applies driver defaults and builds connection form data", () => {
    const sqliteForm = applyDriverDefaults(
      {
        ...defaultConnectionFormData,
        extra_options: {
          sslmode: "verify-full",
          sslrootcert: "/certs/root.pem",
          sslcert: "/certs/client.pem",
          sslkey: "/certs/client.key",
          schema: "finance",
        },
      },
      "sqlite"
    );
    expect(sqliteForm.port).toBe(0);
    expect(sqliteForm.extra_options).toEqual(defaultConnectionFormData.extra_options);

    const formData = buildConnectionFormData({
      id: "c1",
      name: "Analytics",
      driver: "postgresql",
      host: "db.internal",
      port: 5432,
      database: "analytics",
      username: "readonly",
      extra_options: {
        sslmode: "verify-full",
        sslrootcert: "/certs/root.pem",
        schema: "finance",
      },
      is_default: true,
      created_at: "",
    });

    expect(formData.database).toBe("analytics");
    expect(formData.password).toBe("");
    expect(formData.extra_options).toMatchObject({
      sslmode: "verify-full",
      sslrootcert: "/certs/root.pem",
      schema: "finance",
    });
  });

  it("normalizes the live SQLite response shape for editing and display", () => {
    const connection = {
      id: "c2",
      name: "Local receipts",
      driver: "sqlite",
      host: null,
      port: null,
      username: null,
      database: "/data/receipts.sqlite",
      is_default: false,
      created_at: "2026-07-19T00:00:00Z",
    } satisfies ConfiguredConnection;

    expect(buildConnectionFormData(connection)).toMatchObject({
      host: "",
      port: 0,
      username: "",
      database: "/data/receipts.sqlite",
    });
    expect(formatConnectionTarget(connection)).toBe("/data/receipts.sqlite");
  });
});
