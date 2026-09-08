import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelSettings } from "@/components/settings/ModelSettings";
import { ModelSettingsForm } from "@/components/settings/model-settings/ModelSettingsForm";
import {
  initialModelFormData,
  MODEL_PRESETS,
  type ModelTestResult,
} from "@/lib/settings/models";
import enMessages from "@/messages/en.json";
import zhMessages from "@/messages/zh.json";

const resourceState = vi.hoisted(() => ({
  testResult: null as ModelTestResult | null,
}));

vi.mock("@/components/settings/hooks/useModelSettingsResource", () => ({
  useModelSettingsResource: () => ({
    models: [],
    isLoading: false,
    error: null,
    testResult: resourceState.testResult,
    isSubmitting: false,
    testingModelId: null,
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
  beforeEach(() => {
    resourceState.testResult = null;
  });

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
      "DeepSeek / OpenAI 兼容"
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
    };

    renderModelSettings("en");

    expect(screen.getByText("Connection succeeded.")).toBeInTheDocument();
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
