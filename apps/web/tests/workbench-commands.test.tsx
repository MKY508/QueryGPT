import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchCommands } from "@/components/chat/WorkbenchCommands";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";
import { mockSemanticDialogs } from "./semantic-dialog-mock";

let restoreDialogs: () => void;
const scrollDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");

beforeEach(() => {
  restoreDialogs = mockSemanticDialogs();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});
afterEach(() => {
  cleanup(); restoreDialogs(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (scrollDescriptor) Object.defineProperty(Element.prototype, "scrollIntoView", scrollDescriptor);
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

function props() {
  return { projectName: "经营复盘", busy: false, onContinue: vi.fn(), onNewAnalysis: vi.fn(), onOpenData: vi.fn(),
    onOpenUnderstanding: vi.fn(), onOpenHistory: vi.fn(), onOpenProjects: vi.fn(), onOpenReports: vi.fn(), onOpenSettings: vi.fn() };
}
const wrap = (values: ReturnType<typeof props>, locale: "zh" | "en" = "zh", scope = "p1") =>
  <StrictMode><NextIntlClientProvider locale={locale} messages={locale === "zh" ? zh : en}>
    <WorkbenchCommands key={scope} {...values} />
  </NextIntlClientProvider></StrictMode>;
const search = () => screen.getByRole("combobox");
const selected = () => document.querySelector('[cmdk-item][aria-selected="true"]');
const open = () => fireEvent.click(screen.getByRole("button", { name: zh.workbenchCommands.title }));

describe("workbench commands", () => {
  it("filters real cmdk items with normalized cross-word aliases without executing, then selects once", async () => {
    const values = props(); render(wrap(values)); open();
    expect(search()).toHaveFocus(); expect(screen.getAllByRole("option")).toHaveLength(8);
    fireEvent.change(search(), { target: { value: "ＲＥＰＯＲＴ project" } });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
    expect(screen.getByRole("option")).toHaveTextContent("打开项目报表");
    expect(values.onOpenReports).not.toHaveBeenCalled();
    fireEvent.keyDown(search(), { key: "Enter" });
    expect(values.onOpenReports).toHaveBeenCalledOnce(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    open(); expect(search()).toHaveValue("");
    fireEvent.change(search(), { target: { value: "unavailable command" } });
    await screen.findByText(zh.workbenchCommands.empty);
    fireEvent.keyDown(search(), { key: "Enter" });
    expect(values.onOpenReports).toHaveBeenCalledOnce();
  });

  it("skips busy commands, updates their availability live, and supports arrows and pointer handoff", async () => {
    const values = { ...props(), busy: true }; const view = render(wrap(values)); open();
    expect(screen.getByRole("option", { name: /新建调查/ })).toHaveAttribute("aria-disabled", "true");
    fireEvent.keyDown(search(), { key: "ArrowDown" });
    expect(selected()).toHaveTextContent("查看项目数据");
    fireEvent.click(screen.getByRole("option", { name: /新建调查/ }));
    expect(values.onNewAnalysis).not.toHaveBeenCalled();
    view.rerender(wrap({ ...values, busy: false }));
    fireEvent.change(search(), { target: { value: "新建" } });
    await waitFor(() => expect(selected()).toHaveTextContent("新建调查"));
    fireEvent.click(screen.getByRole("option", { name: "新建调查" }));
    expect(values.onNewAnalysis).toHaveBeenCalledOnce();
    open(); fireEvent.click(screen.getByRole("option", { name: "查找历史调查…" }));
    expect(values.onOpenHistory).toHaveBeenCalledOnce();
  });

  it("ignores composition and modifier variants, preserves the draft on cancel, and traps Tab", () => {
    const values = props(); render(<><input aria-label="draft" defaultValue="未发送的问题" />{wrap(values)}</>);
    const draft = screen.getByLabelText("draft"); draft.focus();
    for (const extra of [{ altKey: true }, { shiftKey: false }, { isComposing: true }, { keyCode: 229 }, { repeat: true }]) {
      fireEvent.keyDown(draft, { key: "P", metaKey: true, shiftKey: true, ...extra });
    }
    fireEvent.keyDown(draft, { key: "k", metaKey: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.keyDown(draft, { key: "P", ctrlKey: true, shiftKey: true });
    const field = search(); fireEvent.compositionStart(field);
    fireEvent.keyDown(field, { key: "Enter" }); fireEvent.keyDown(field, { key: "Escape", isComposing: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument(); expect(values.onContinue).not.toHaveBeenCalled();
    fireEvent.compositionEnd(field);
    fireEvent.keyDown(field, { key: "Tab" });
    expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true }); expect(field).toHaveFocus();
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(draft).toHaveValue("未发送的问题");
    // jsdom has no geometry; cancellation uses the visible trigger fallback.
    expect(screen.getByRole("button", { name: "快速操作" })).toHaveFocus();
  });

  it("allows inline navigation but not modal or inert workspaces, and invalidates a changed project scope", () => {
    const values = props(); const view = render(<>{wrap(values)}<dialog open aria-label="Inline navigation" /></>);
    open(); expect(search()).toHaveFocus();
    fireEvent.keyDown(search(), { key: "Escape" });
    expect(screen.getByRole("button", { name: "快速操作" })).toHaveFocus();
    view.rerender(<>{wrap(values)}<dialog open aria-modal="true" /></>);
    fireEvent.keyDown(window, { key: "p", metaKey: true, shiftKey: true });
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    view.rerender(<div inert>{wrap(values)}</div>);
    fireEvent.keyDown(window, { key: "p", metaKey: true, shiftKey: true });
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    view.rerender(<div style={{ display: "none" }}>{wrap(values)}</div>);
    fireEvent.keyDown(window, { key: "p", metaKey: true, shiftKey: true });
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    view.rerender(wrap(values)); open();
    view.rerender(wrap(values, "zh", "p2"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(values.onOpenProjects).not.toHaveBeenCalled();
  });

  it("renders English choices and does not offer report navigation without a current project", async () => {
    const values = props(); const view = render(wrap(values)); open();
    view.rerender(<NextIntlClientProvider locale="en" messages={en}><WorkbenchCommands {...values} onOpenReports={undefined} /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Quick actions" }));
    expect(screen.queryByRole("option", { name: "Open project reports" })).not.toBeInTheDocument();
    fireEvent.change(search(), { target: { value: "设置" } });
    await waitFor(() => expect(screen.getByRole("option")).toHaveTextContent("Open settings"));
    fireEvent.keyDown(search(), { key: "Enter" }); expect(values.onOpenSettings).toHaveBeenCalledOnce();
  });
});
