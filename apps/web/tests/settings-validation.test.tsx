import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelSettingsForm } from "@/components/settings/model-settings/ModelSettingsForm";
import { ConnectionSettingsForm } from "@/components/settings/connection-settings/ConnectionSettingsForm";
import { MODEL_PRESETS, initialModelFormData, type ModelFormData } from "@/lib/settings/models";
import { applyDriverDefaults, defaultConnectionFormData, type ConnectionFormData } from "@/lib/settings/connections";
import { validateConnectionSettings, validateModelSettings } from "@/lib/settings/validation";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";

const saved = vi.fn();
const validConnection = { ...defaultConnectionFormData, name: "Warehouse", database: "orders", username: "reader" };
function Model({ seed = initialModelFormData, scope = null, busy = false }: { seed?: ModelFormData; scope?: string | null; busy?: boolean }) {
  const [data, setData] = useState(seed);
  return <NextIntlClientProvider locale="en" messages={en}>
    <ModelSettingsForm editingId={scope} formData={data} activePreset={MODEL_PRESETS[data.provider]} isSubmitting={busy}
      onChange={setData} onPresetSelect={key => setData(current => ({ ...current, ...MODEL_PRESETS[key] }))} onReset={vi.fn()} onSubmit={saved} />
  </NextIntlClientProvider>;
}
function Connection({ seed = validConnection }: { seed?: ConnectionFormData }) {
  const [data, setData] = useState(seed);
  return <NextIntlClientProvider locale="zh" messages={zh}>
    <ConnectionSettingsForm editingId="existing" formData={data} isSubmitting={false} onChange={setData}
      onDriverChange={driver => setData(current => applyDriverDefaults(current, driver))} onReset={vi.fn()} onSubmit={saved} />
  </NextIntlClientProvider>;
}
const change = (id: string, value: string) => fireEvent.change(screen.getByTestId(id), { target: { value } });

describe("configuration field validation", () => {
  afterEach(() => { cleanup(); saved.mockClear(); });

  it("validates model names, explicit addresses and both JSON fields without requiring or echoing keys", () => {
    const value = { ...initialModelFormData, name: "经营分析", provider: "custom", api_key: "example-private-input" };
    expect(validateModelSettings(value)).toEqual({ base_url: "required" });
    for (const base_url of ["http://localhost:11434", "https://proxy.example.invalid/v1?region=cn", "http://[::1]:11434/v1"]) {
      expect(validateModelSettings({ ...value, base_url, api_key: "" })).toEqual({});
    }
    for (const base_url of ["localhost:11434", "https:example.invalid", "https:///example.invalid", "ftp://example.invalid", "https://example.invalid:65536"]) {
      expect(validateModelSettings({ ...value, base_url })).toEqual({ base_url: "serviceUrl" });
    }
    expect(validateModelSettings({ ...value, base_url: "https://@example.invalid" })).toEqual({ base_url: "urlCredentials" });
    expect(validateModelSettings({ ...value, base_url: "https://example.invalid/#part" })).toEqual({ base_url: "urlFragment" });
    expect(validateModelSettings({ ...value, provider: "openai", name: " 🪶".trim().repeat(100), headersText: "[]", queryParamsText: "{" })).toEqual({ headersText: "objectRequired", queryParamsText: "invalidJson" });
    expect(validateModelSettings({ ...value, name: "中".repeat(101), model_id: " " })).toMatchObject({ name: "nameTooLong", model_id: "required" });
    expect(JSON.stringify(validateModelSettings(value))).not.toContain(value.api_key);
  });

  it("keeps integer ports and TLS/schema rules scoped to the selected database type", () => {
    for (const port of [NaN, Infinity, 0, -1, 3306.5, 65536]) expect(validateConnectionSettings({ ...validConnection, port })).toEqual({ port: "port" });
    for (const port of [1, 5432, 65535]) expect(validateConnectionSettings({ ...validConnection, port })).toEqual({});
    const options = { ...validConnection.extra_options, sslmode: "verify-full", schema: "bad-name", sslcert: "/cert/client.pem" };
    expect(validateConnectionSettings({ ...validConnection, driver: "postgresql", extra_options: options })).toEqual({ schema: "schema", sslrootcert: "caRequired", sslkey: "certificatePair" });
    expect(validateConnectionSettings({ ...validConnection, extra_options: { ...options, sslmode: "disable" } })).toEqual({ sslmode: "encryptionRequired" });
    expect(validateConnectionSettings({ ...validConnection, extra_options: { ...validConnection.extra_options, sslrootcert: "-----BEGIN CERTIFICATE-----" } })).toEqual({ sslrootcert: "certificatePath" });
    const sqlite = applyDriverDefaults({ ...validConnection, port: NaN, host: "", username: "" }, "sqlite");
    expect(validateConnectionSettings(sqlite)).toEqual({});
    expect(validateConnectionSettings({ ...sqlite, database: " " })).toEqual({ database: "required" });
  });

  it("reports after submit, opens folded model errors, focuses the first field and clears errors as corrected", () => {
    render(<Model seed={{ ...initialModelFormData, provider: "custom", model_id: " ", headersText: "[]", queryParamsText: "{" }} />);
    expect(document.querySelector('[aria-invalid="true"]')).toBeNull();
    expect(screen.getByTestId("model-compatibility-settings")).not.toHaveAttribute("open");
    fireEvent.submit(screen.getByTestId("model-form"));
    expect(saved).not.toHaveBeenCalled();
    expect(screen.getByLabelText(en.modelSettings.form.serviceName)).toHaveFocus();
    expect(screen.getByTestId("model-compatibility-settings")).toHaveAttribute("open");
    expect(screen.getByRole("status")).toHaveTextContent("5 fields need attention");
    const url = screen.getByTestId("model-base-url-input");
    expect(url).toHaveAccessibleDescription(`${en.modelSettings.form.serviceAddressHint} ${en.settingsValidation.required}`);
    change("model-name-input", "Local analysis"); change("model-id-input", "local-model");
    fireEvent.click(screen.getByTestId("model-preset-ollama"));
    expect(url).not.toHaveAttribute("aria-invalid");
    expect(url).toHaveAccessibleDescription(en.modelSettings.form.serviceAddressHint);
    fireEvent.click(screen.getByRole("button", { name: "2 fields need attention" }));
    expect(screen.getByLabelText(en.modelSettings.form.headers)).toHaveFocus();
    change("model-headers-textarea", "{}"); change("model-query-params-textarea", "{}");
    expect(document.querySelector('[aria-invalid="true"]')).toBeNull();
    fireEvent.submit(screen.getByTestId("model-form")); expect(saved).toHaveBeenCalledTimes(1);
  });

  it("preserves decimal and blank port entry, reveals certificate errors and keeps existing driver changes available", () => {
    render(<Connection seed={{ ...validConnection, port: 5432.5, driver: "postgresql", extra_options: { ...validConnection.extra_options, sslmode: "verify-full" } }} />);
    const port = screen.getByLabelText(zh.connectionSettings.port);
    expect(port).toHaveValue(5432.5);
    const disclosure = screen.getByTestId("connection-security-options") as HTMLDetailsElement;
    disclosure.open = false; fireEvent(disclosure, new Event("toggle"));
    fireEvent.submit(screen.getByTestId("connection-form"));
    expect(port).toHaveFocus(); expect(port).toHaveAccessibleDescription(zh.settingsValidation.port);
    expect(disclosure).toHaveAttribute("open"); expect(saved).not.toHaveBeenCalled();
    change("connection-port-input", ""); expect(port).toHaveValue(null);
    change("connection-port-input", "5432");
    fireEvent.click(screen.getByRole("button", { name: "还有 1 项需要修改" }));
    expect(screen.getByLabelText(zh.connectionSettings.security.caCertificatePath)).toHaveFocus();
    change("connection-ca-path-input", "/cert/ca.pem");
    expect(screen.getByLabelText(zh.connectionSettings.databaseType)).toBeEnabled();
    change("connection-driver-select", "sqlite");
    expect(screen.queryByTestId("connection-port-input")).not.toBeInTheDocument();
    expect(document.querySelector('[aria-invalid="true"]')).toBeNull();
    fireEvent.submit(screen.getByTestId("connection-form")); expect(saved).toHaveBeenCalledTimes(1);
  });

  it("resets feedback for another edit scope, respects busy state and associates every label uniquely", () => {
    const { rerender } = render(<Model scope="first" />);
    fireEvent.submit(screen.getByTestId("model-form")); expect(screen.getByTestId("model-name-input")).toHaveAttribute("aria-invalid", "true");
    rerender(<Model scope="second" busy />);
    expect(screen.getByTestId("model-name-input")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByTestId("model-name-input")).toBeDisabled();
    expect(screen.getByRole("button", { name: en.common.cancel })).toBeDisabled();
    expect(screen.getByTestId("model-submit-button")).toBeDisabled();
    fireEvent.submit(screen.getByTestId("model-form")); expect(saved).not.toHaveBeenCalled();
    const ids = Array.from(document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input,select,textarea")).map(input => {
      expect(input.labels?.length).toBe(1); expect(input.id).not.toBe(""); return input.id;
    });
    expect(new Set(ids).size).toBe(ids.length);
    expect(screen.getByTestId("model-api-key-input")).toHaveAttribute("type", "password");
  });

  it.each([false, true])("respects another panel's actual modal ownership (modal=%s)", modal => {
    render(<>
      <dialog open aria-modal={modal ? "true" : undefined}>
        <button type="button">Keep editing</button>
      </dialog>
      <Model />
    </>);
    const decision = screen.getByRole("button", { name: "Keep editing" });
    decision.focus();
    fireEvent.submit(screen.getByTestId("model-form"));
    expect(modal ? decision : screen.getByTestId("model-name-input")).toHaveFocus();
  });

  it("can locate an invalid field inside its own modal alongside an inline panel", () => {
    render(<>
      <dialog open aria-label="Directory" />
      <dialog open aria-modal="true" aria-label="Edit service"><Model /></dialog>
    </>);
    fireEvent.submit(screen.getByTestId("model-form"));
    expect(screen.getByTestId("model-name-input")).toHaveFocus();
  });
});
