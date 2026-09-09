import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelSettings } from "@/components/settings/ModelSettings";
import { ModelSettingsForm } from "@/components/settings/model-settings/ModelSettingsForm";
import {
  initialModelFormData,
  MODEL_PRESETS,
  type ModelTestResult,
} from "@/lib/settings/models";
import enMessages from "@/messages/en.json";
import zhMessages from "@/messages/zh.json";
import { mockSemanticDialogs } from "./semantic-dialog-mock";

const resourceState = vi.hoisted(() => ({
  testResult: null as ModelTestResult | null,
}));

vi.mock("@/components/settings/hooks/useModelSettingsResource", () => ({
  useModelSettingsResource: () => ({
    models: [{ id: "service-a", name: "Daily analysis", provider: "groq", model_id: "analysis-model", credential_state: "readable", health_status: "unknown", is_default: true, created_at: "2026-09-09T00:00:00Z" }],
    isLoading: false,
    error: null,
    checks: resourceState.testResult ? { [resourceState.testResult.id]: { status: "complete", result: resourceState.testResult } } : {},
    isSubmitting: false,
    deletePending: false,
    clearError: vi.fn(),
    addModel: vi.fn(),
    updateModel: vi.fn(),
    deleteModel: vi.fn(),
    testModel: vi.fn(),
  }),
}));

function renderForm(locale: "en" | "zh") {
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "zh" ? zhMessages : enMessages}
    >
      <ModelSettingsForm
        editingId={null}
        formData={initialModelFormData}
        activePreset={MODEL_PRESETS.openai}
        isSubmitting={false}
        onChange={vi.fn()}
        onPresetSelect={vi.fn()}
        onReset={vi.fn()}
        onSubmit={vi.fn()}
      />
    </NextIntlClientProvider>
  );
}

function renderModelSettings(locale: "en" | "zh") {
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "zh" ? zhMessages : enMessages}
    >
      <ModelSettings />
    </NextIntlClientProvider>
  );
}

function renderSettings(locale: "en" | "zh") {
  renderModelSettings(locale);
  fireEvent.click(screen.getByTestId("model-add-button"));
}

describe("ModelSettingsForm i18n", () => {
  it("switches providers without carrying credentials and validates a Qwen workspace endpoint", () => {
    renderSettings("en");
    fireEvent.change(screen.getByTestId("model-api-key-input"), { target: { value: "previous-provider-key" } });
    fireEvent.change(screen.getByTestId("model-headers-textarea"), { target: { value: '{"x-old":"value"}' } });
    fireEvent.click(screen.getByTestId("model-preset-groq"));
    expect(screen.getByTestId("model-id-input")).toHaveValue("openai/gpt-oss-120b");
    expect(screen.getByTestId("model-api-key-input")).toHaveValue("");
    expect(screen.getByTestId("model-headers-textarea")).toHaveValue("{}");
    fireEvent.change(screen.getByTestId("model-id-input"), { target: { value: "my-selected-model" } });
    fireEvent.click(screen.getByTestId("model-preset-groq"));
    expect(screen.getByTestId("model-id-input")).toHaveValue("my-selected-model");
    fireEvent.click(screen.getByTestId("model-preset-qwen"));
    expect(screen.getByTestId("model-id-input")).toHaveValue("qwen-plus");
    fireEvent.submit(screen.getByTestId("model-form"));
    expect(screen.getByTestId("model-base-url-input")).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(screen.getByTestId("model-api-format-select"), { target: { value: "openai_responses" } });
    expect(screen.getByTestId("model-api-format-select")).toHaveValue("openai_responses");
  });
  it("applies the OrcaRouter gateway preset and exposes the configured affiliate link", () => {
    renderSettings("en");
    fireEvent.click(screen.getByTestId("model-preset-orcarouter"));
    expect(screen.getByTestId("model-id-input")).toHaveValue("orcarouter/auto");
    expect(screen.getByTestId("model-base-url-input")).toHaveValue("https://api.orcarouter.ai/v1");
    const link = screen.getByRole("link", { name: "Get an OrcaRouter API key (affiliate link)" });
    expect(link).toHaveAttribute("href", "https://www.orcarouter.ai/ref/ref_86d1b2f35d6800d5f85b");
    expect(link).toHaveAttribute("rel", "noopener noreferrer sponsored");
    fireEvent.click(screen.getByTestId("model-preset-deepseek"));
    expect(screen.queryByRole("link", { name: /affiliate link/ })).not.toBeInTheDocument();
  });

  let restoreDialogs: () => void;
  beforeEach(() => {
    restoreDialogs = mockSemanticDialogs();
    resourceState.testResult = null;
  });
  afterEach(() => { cleanup(); restoreDialogs(); });

  it("renders user-facing setup copy from the English catalog", () => {
    renderForm("en");

    expect(screen.getByText("Choose a service")).toBeInTheDocument();
    expect(screen.getByText("Display name")).toBeInTheDocument();
    expect(screen.getByText("Advanced connection options")).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "OpenAI compatible" })
    ).toBeInTheDocument();
    expect(screen.queryByTestId("model-healthcheck-mode-select")).not.toBeInTheDocument();
    expect(screen.queryByText("openai_compatible")).not.toBeInTheDocument();
    expect(screen.queryByText("chat_completion")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close form" })).toBeInTheDocument();
  });

  it("renders the same setup fields from the Chinese catalog", () => {
    renderForm("zh");

    expect(screen.getByText("选择服务")).toBeInTheDocument();
    expect(screen.getByTestId("model-preset-deepseek")).toHaveTextContent(
      "DeepSeek"
    );
    expect(screen.getByText("显示名称")).toBeInTheDocument();
    expect(screen.getByText("高级连接选项")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "OpenAI 兼容" })).toBeInTheDocument();
    expect(screen.queryByTestId("model-healthcheck-mode-select")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭表单" })).toBeInTheDocument();
  });

  it("localizes a non-object Headers validation error in English", () => {
    renderSettings("en");

    fireEvent.change(screen.getByTestId("model-headers-textarea"), {
      target: { value: "[]" },
    });
    fireEvent.submit(screen.getByTestId("model-form"));

    expect(
      screen.getByText("Additional request headers (JSON) must be a JSON object.")
    ).toBeInTheDocument();
  });

  it("localizes malformed Query Params JSON in Chinese", () => {
    renderSettings("zh");

    fireEvent.change(screen.getByTestId("model-query-params-textarea"), {
      target: { value: "{" },
    });
    fireEvent.submit(screen.getByTestId("model-form"));

    expect(
      screen.getByText("附加请求参数（JSON）必须是有效的 JSON。")
    ).toBeInTheDocument();
  });

  it("renders a successful English summary without exposing Chinese API prose", () => {
    resourceState.testResult = {
      id: "service-a",
      success: true,
      message: "连接成功",
      source_provider: "groq",
      api_format: "openai_compatible",
    };

    renderModelSettings("en");

    expect(screen.getByText("Connection succeeded.")).toBeInTheDocument();
    expect(screen.getByTestId("model-details-service-a")).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("Connection details"));
    expect(screen.getByText("openai_compatible")).toBeInTheDocument();
    expect(screen.getByText("Service provider")).toBeInTheDocument();
    expect(screen.queryByText("连接成功")).not.toBeInTheDocument();
  });

  it("uses a safe Chinese summary for an unknown provider error", () => {
    resourceState.testResult = {
      id: "service-a",
      success: false,
      message: "Provider returned malformed response",
      error_category: "future_provider_error",
    };

    renderModelSettings("zh");

    expect(
      screen.getByText("连接检查未完成，请检查服务设置后重试。")
    ).toBeInTheDocument();
    expect(screen.queryByText("Provider returned malformed response")).not.toBeInTheDocument();
  });
});
