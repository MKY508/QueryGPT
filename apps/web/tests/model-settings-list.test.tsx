import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import {
  ModelSettingsList,
  getModelTestResultMessage,
  getModelServiceState,
} from "@/components/settings/model-settings/ModelSettingsList";
import type { ModelTestResult } from "@/lib/settings/models";
import type { ConfiguredModel } from "@/lib/types/api";
import enMessages from "@/messages/en.json";
import zhMessages from "@/messages/zh.json";

function model(overrides: Partial<ConfiguredModel>): ConfiguredModel {
  return {
    id: "service-a",
    name: "日常分析",
    provider: "custom",
    model_id: "analysis-model",
    is_default: false,
    created_at: "2026-07-19T00:00:00Z",
    credential_state: "readable",
    health_status: "unknown",
    ...overrides,
  };
}

function renderList(
  models: ConfiguredModel[],
  locale: "en" | "zh" = "zh",
  testResult: ModelTestResult | null = null
) {
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "zh" ? zhMessages : enMessages}
    >
      <ModelSettingsList
        models={models}
        isLoading={false}
        testResult={testResult}
        testingModelId={undefined}
        deletePending={false}
        onTest={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    </NextIntlClientProvider>
  );
}

describe("ModelSettingsList", () => {
  it("keeps stored credentials separate from real service health", () => {
    expect(getModelServiceState(model({ health_status: "healthy" }))).toBe("available");
    expect(getModelServiceState(model({ health_status: "unknown" }))).toBe("unchecked");
    expect(
      getModelServiceState(
        model({ health_status: "unhealthy", last_error_category: "auth" })
      )
    ).toBe("reconnect");
    expect(
      getModelServiceState(
        model({ health_status: "unhealthy", last_error_category: "connection" })
      )
    ).toBe("temporarily_unavailable");
    expect(getModelServiceState(model({ health_status: "unhealthy", last_error_category: "tool_calling" }))).toBe("needs_configuration");
    expect(getModelServiceState(model({ credential_state: "unreadable" }))).toBe(
      "configuration_unreadable"
    );
  });

  it("maps structured connection outcomes without depending on API prose", () => {
    const copy = {
      success: "success",
      credentials: "credentials",
      configuration: "configuration",
      capability: "capability",
      temporary: "temporary",
      failed: "failed",
    };

    expect(getModelTestResultMessage({ success: true }, copy)).toBe("success");
    for (const category of ["tool_calling", "structured_output"]) {
      expect(getModelTestResultMessage({ success: false, error_category: category }, copy)).toBe("capability");
    }
    expect(
      getModelTestResultMessage({ success: false, error_category: "auth" }, copy)
    ).toBe("credentials");
    expect(
      getModelTestResultMessage(
        { success: false, error_category: "provider_format" },
        copy
      )
    ).toBe("configuration");
    expect(
      getModelTestResultMessage({ success: false, error_category: "timeout" }, copy)
    ).toBe("temporary");
    expect(
      getModelTestResultMessage({ success: false, error_category: "future_code" }, copy)
    ).toBe("failed");
  });

  it("shows persisted business states and a named check action", () => {
    renderList([
      model({ id: "available", health_status: "healthy", last_response_time_ms: 240 }),
      model({ id: "unchecked" }),
      model({ id: "reconnect", health_status: "unhealthy", last_error_category: "auth" }),
      model({
        id: "temporary",
        health_status: "unhealthy",
        last_error_category: "timeout",
      }),
      model({ id: "unreadable", credential_state: "unreadable" }),
    ]);

    expect(screen.getByTestId("model-health-available")).toHaveTextContent("可用");
    expect(screen.getByTestId("model-health-unchecked")).toHaveTextContent("未检查");
    expect(screen.getByTestId("model-health-reconnect")).toHaveTextContent("需要重新连接");
    expect(screen.getByTestId("model-health-temporary")).toHaveTextContent("暂时不可用");
    expect(screen.getByTestId("model-health-unreadable")).toHaveTextContent("配置不可读取");
    expect(screen.getAllByRole("button", { name: /检查分析服务/ })).toHaveLength(5);
    expect(screen.queryByText("Key 已配置")).not.toBeInTheDocument();
  });

  it("treats a legacy stored-key flag as unchecked, not available", () => {
    renderList([
      model({
        credential_state: undefined,
        health_status: undefined,
        api_key_configured: true,
      }),
    ]);

    expect(screen.getByTestId("model-health-service-a")).toHaveTextContent("未检查");
    expect(screen.queryByText("可用")).not.toBeInTheDocument();
  });

  it("renders an English credential result without exposing Chinese API prose", () => {
    renderList(
      [model({ health_status: "unhealthy", last_error_category: "auth" })],
      "en",
      {
        id: "service-a",
        success: false,
        message: "访问凭证需要更新",
        error_category: "auth",
      }
    );

    expect(
      screen.getByText("The access credential was rejected or could not be read.")
    ).toBeInTheDocument();
    expect(screen.queryByText("访问凭证需要更新")).not.toBeInTheDocument();
  });
});
