import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "@/app/settings/page";
import enMessages from "@/messages/en.json";
import zhMessages from "@/messages/zh.json";
import { matchesSettingsSection, resolveSettingsSection, settingsSectionHref } from "@/lib/settings/navigation";
import { mockSemanticDialogs } from "./semantic-dialog-mock";

const router = vi.hoisted(() => ({ prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(useSyncExternalStore(listener => {
    window.addEventListener("popstate", listener); window.addEventListener("test-settings-route", listener);
    return () => { window.removeEventListener("popstate", listener); window.removeEventListener("test-settings-route", listener); };
  }, () => window.location.search, () => "")),
}));

vi.mock("@/components/settings/ModelSettings", () => ({
  ModelSettings: () => <div data-testid="model-settings"><input aria-label="Model draft" defaultValue="" /></div>,
}));

vi.mock("@/components/settings/ConnectionSettings", () => ({
  ConnectionSettings: () => <div data-testid="connection-settings"><input aria-label="Connection draft" defaultValue="" /></div>,
}));

vi.mock("@/components/settings/PreferencesSettings", () => ({
  PreferencesSettings: ({ section }: { section: string }) => (
    <div data-testid={`preferences-${section}`}><input aria-label="Preference draft" defaultValue="" /></div>
  ),
}));

function renderPage(locale: "en" | "zh" = "zh") {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "zh" ? zhMessages : enMessages}
    >
      <SettingsPage />
    </NextIntlClientProvider>
  );
}

describe("SettingsPage", () => {
  let restoreDialogs: () => void;
  beforeEach(() => {
    window.history.replaceState({}, "", "/settings");
    restoreDialogs = mockSemanticDialogs();
    const push = window.history.pushState.bind(window.history);
    vi.spyOn(window.history, "pushState").mockImplementation((...args) => { push(...args); window.dispatchEvent(new Event("test-settings-route")); });
  });
  afterEach(() => { cleanup(); restoreDialogs(); vi.restoreAllMocks(); });

  it("keeps current settings and removes legacy prompt, schema, semantic and config migration UI", async () => {
    renderPage();

    expect(await screen.findByTestId("model-settings")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "分析服务" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "设置" })).not.toBeInTheDocument();
    expect(screen.getByTestId("settings-tab-connections")).toBeInTheDocument();
    expect(screen.getByTestId("settings-tab-execution")).toBeInTheDocument();
    expect(screen.getByTestId("settings-tab-appearance")).toBeInTheDocument();
    expect(screen.getByTestId("settings-tab-advanced")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-tab-prompts")).not.toBeInTheDocument();
    expect(screen.queryByTestId("settings-tab-schema")).not.toBeInTheDocument();
    expect(screen.queryByTestId("settings-tab-semantic")).not.toBeInTheDocument();
    expect(screen.queryByTestId("legacy-connection-migration")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "关于" })[0]).toHaveAttribute("href", "/about");

    fireEvent.click(screen.getByTestId("settings-tab-appearance"));
    expect(await screen.findByTestId("preferences-appearance")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "外观" })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("settings-tab-execution"));
    expect(await screen.findByTestId("preferences-execution")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "执行" })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("settings-tab-advanced"));
    expect(await screen.findByTestId("preferences-diagnostics")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "调查诊断" })).toBeInTheDocument();
  });

  it("does not revive a retired settings panel from an old URL", async () => {
    window.history.replaceState({}, "", "/settings?tab=prompts");

    renderPage();

    expect(await screen.findByTestId("model-settings")).toBeInTheDocument();
    expect(screen.queryByTestId("preferences-diagnostics")).not.toBeInTheDocument();
  });

  it("opens a requested tab without mounting the default panel first", async () => {
    window.history.replaceState({}, "", "/settings?tab=connections");

    renderPage();

    expect(await screen.findByTestId("connection-settings")).toBeInTheDocument();
    expect(screen.queryByTestId("model-settings")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "数据连接" })).toBeInTheDocument();
  });

  it("renders navigation and panel titles from the English settings catalog", async () => {
    renderPage("en");

    expect(await screen.findByTestId("model-settings")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Analysis service" })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Data connections" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "About" })[0]).toHaveAttribute("href", "/about");

    fireEvent.click(screen.getByTestId("settings-tab-execution"));
    expect(await screen.findByTestId("preferences-execution")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Execution" })).toBeInTheDocument();
  });

  it("retains visited forms while URLs and browser history determine the active section", async () => {
    window.history.replaceState({}, "", "/settings?tab=models&from=project#details");
    const view = renderPage();
    fireEvent.change(await screen.findByLabelText("Model draft"), { target: { value: "Unsubmitted service" } });
    act(() => { fireEvent.click(screen.getByTestId("settings-tab-connections")); fireEvent.click(screen.getByTestId("settings-tab-models")); });
    expect(window.location.search).toBe("?tab=models&from=project");
    fireEvent.click(screen.getByTestId("settings-tab-connections"));
    expect(window.location.search).toBe("?tab=connections&from=project"); expect(window.location.hash).toBe("#details");
    fireEvent.change(await screen.findByLabelText("Connection draft"), { target: { value: "Unsubmitted connection" } });
    expect(screen.getByTestId("model-settings").closest("section")).toHaveAttribute("hidden");
    expect(screen.getByTestId("model-settings").closest("section")).toHaveAttribute("inert");
    const count = vi.mocked(window.history.pushState).mock.calls.length;
    fireEvent.click(screen.getByTestId("settings-tab-connections")); expect(window.history.pushState).toHaveBeenCalledTimes(count);
    act(() => { window.history.replaceState({}, "", "/settings?tab=models&from=project"); window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(screen.getByRole("heading", { name: "分析服务" })).toBeInTheDocument(); expect(screen.getByLabelText("Model draft")).toHaveValue("Unsubmitted service");
    fireEvent.click(screen.getByTestId("settings-tab-execution"));
    fireEvent.change(await screen.findByLabelText("Preference draft"), { target: { value: "unsaved choices" } });
    fireEvent.click(screen.getByTestId("settings-tab-advanced")); expect(await screen.findByTestId("preferences-diagnostics")).toBeInTheDocument();
    expect(screen.getByLabelText("Preference draft")).toHaveValue("unsaved choices");
    fireEvent.click(screen.getByTestId("settings-tab-connections")); expect(screen.getByLabelText("Connection draft")).toHaveValue("Unsubmitted connection");
    fireEvent.click(screen.getByTestId("settings-tab-execution")); expect(screen.getByLabelText("Preference draft")).toHaveValue("unsaved choices");
    view.rerender(<NextIntlClientProvider locale="en" messages={enMessages}><SettingsPage /></NextIntlClientProvider>);
    expect(screen.getByRole("heading", { name: "Execution" })).toBeInTheDocument();
    expect(screen.getByLabelText("Preference draft")).toHaveValue("unsaved choices");
    expect(screen.getByLabelText("Model draft")).toHaveValue("Unsubmitted service");
  });

  it("filters the desktop directory without hiding it or switching the current panel", async () => {
    renderPage(); await screen.findByTestId("model-settings");
    const directory = screen.getByRole("navigation", { name: "设置目录" });
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "不存在的栏目" } });
    expect(within(directory).getByRole("status")).toHaveTextContent("没有匹配");
    expect(window.history.pushState).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "清除栏目搜索" }));
    expect(input).toHaveValue(""); expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "数据 连接" } });
    expect(within(directory).getAllByRole("link")).toHaveLength(1);
    fireEvent.click(within(directory).getByRole("link", { name: "数据连接" }));
    expect(await screen.findByTestId("connection-settings")).toBeInTheDocument();
    expect(directory).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(screen.getByRole("heading", { name: "数据连接" })).toHaveFocus());
    expect(window.location.search).toBe("?tab=connections");
  });

  it("accepts only current destinations and only encodes navigation in URLs", () => {
    for (const key of [null, "preferences", "runtime", "diagnostics", "prompts", "__proto__", "constructor", "toString"]) expect(resolveSettingsSection(key)).toBe("models");
    expect(settingsSectionHref("connections", "?tab=models&from=project&tab=advanced")).toBe("/settings?tab=connections&from=project");
    expect(matchesSettingsSection("ＤＡＴＡ  connection", "Data connections", "Manage databases")).toBe(true);
    expect(matchesSettingsSection("主题", "外观", "调整语言和界面主题")).toBe(true);
  });

  it("defers directory filtering until composition commits and keeps the current draft", async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText("Model draft"), { target: { value: "未提交的配置" } });
    const input = screen.getByRole("searchbox");
    const directory = screen.getByRole("navigation", { name: "设置目录" });
    expect(input).toHaveAttribute("aria-controls", directory.id);
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "数据连接" } });
    expect(within(directory).getAllByRole("link")).toHaveLength(5);
    fireEvent.compositionEnd(input, { data: "数据连接" });
    expect(within(directory).getAllByRole("link")).toHaveLength(1);
    expect(screen.getByLabelText("Model draft")).toHaveValue("未提交的配置");
    expect(window.history.pushState).not.toHaveBeenCalled();
  });

  it("restores each section's reading position and leaves modified clicks to the browser", async () => {
    renderPage(); await screen.findByTestId("model-settings");
    const scroll = screen.getByTestId("settings-scroll");
    scroll.scrollTop = 320; fireEvent.scroll(scroll);
    fireEvent.click(screen.getByTestId("settings-tab-connections"), { metaKey: true });
    expect(window.history.pushState).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("settings-tab-connections"));
    await screen.findByTestId("connection-settings");
    expect(scroll.scrollTop).toBe(0);
    scroll.scrollTop = 180; fireEvent.scroll(scroll);
    fireEvent.click(screen.getByTestId("settings-tab-models"));
    expect(scroll.scrollTop).toBe(320);
    fireEvent.click(screen.getByTestId("settings-tab-connections"));
    expect(scroll.scrollTop).toBe(180);
  });
});
