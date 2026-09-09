import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SemanticSaveRecovery } from "@/components/semantic/SemanticSaveRecovery";
import { api } from "@/lib/api/client";
import type { SemanticEntry } from "@/lib/types/api";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";

vi.mock("@/lib/api/client", () => ({ api: { get: vi.fn() } }));
const entry: SemanticEntry = {
  id: "definition", project_id: "project", key: "revenue", value: "按支付时间确认收入",
  entry_type: "business_rule", state: "confirmed", validity: "active", confidence: 1,
  evidence: [], source: "user", is_active: true, active_revision_id: "head-4", revision_number: 4,
  definition: { business_name: "收入" }, allowed_actions: [], created_at: "2026-09-09", updated_at: "2026-09-09",
};
const target = { projectId: "project", key: "revenue", entryId: "definition", expectedHead: "head-3" };
const present = (value: SemanticEntry) => ({ title: "收入", description: value.value, type: "口径", state: "已采用", formula: null, synonyms: [] });
const props = { target, conflict: true, draft: { title: "我的收入", description: "  未保存的草稿\n" }, present,
  fallbackFocus: { current: null }, onLoad: vi.fn(), onRetry: vi.fn() };
const wrap = (content: React.ReactNode, locale = "zh") => <NextIntlClientProvider locale={locale} messages={locale === "zh" ? zh : en}>{content}</NextIntlClientProvider>;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("desktop semantic recovery session", () => {
  it("aborts the previous identity and cannot display its late response under a new target", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(api.get).mockImplementationOnce(() => new Promise(yes => { resolve = yes; }) as ReturnType<typeof api.get>);
    const view = render(wrap(<SemanticSaveRecovery {...props} />));
    fireEvent.click(screen.getByRole("button", { name: zh.semanticSaveRecovery.read }));
    const signal = vi.mocked(api.get).mock.calls[0][1]?.signal as AbortSignal;
    view.rerender(wrap(<SemanticSaveRecovery {...props} target={{ ...target, entryId: "another", key: "cost" }} />));
    expect(signal.aborted).toBe(true);
    await act(async () => resolve({ data: { data: entry } }));
    expect(screen.queryByRole("region", { name: zh.semanticSaveRecovery.saved })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: zh.semanticSaveRecovery.read })).toBeEnabled();
    expect(props.onLoad).not.toHaveBeenCalled();
  });

  it("does not steal focus after the user moves away during a read", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(api.get).mockImplementationOnce(() => new Promise(yes => { resolve = yes; }) as ReturnType<typeof api.get>);
    render(wrap(<><SemanticSaveRecovery {...props} /><input aria-label="Other draft" /></>));
    const read = screen.getByRole("button", { name: zh.semanticSaveRecovery.read });
    read.focus(); fireEvent.click(read);
    screen.getByRole("textbox").focus();
    await act(async () => resolve({ data: { data: entry } }));
    expect(screen.getByRole("textbox")).toHaveFocus();
    expect(screen.getByRole("region", { name: zh.semanticSaveRecovery.saved })).toHaveTextContent(entry.value);
  });

  it.each(["zh", "en"])("preserves the read across draft edits and uses explicit confirmation in %s", async locale => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: entry } });
    const copy = locale === "zh" ? zh.semanticSaveRecovery : en.semanticSaveRecovery;
    const view = render(wrap(<SemanticSaveRecovery {...props} />, locale));
    fireEvent.click(screen.getByRole("button", { name: copy.read }));
    await screen.findByRole("region", { name: copy.saved });
    view.rerender(wrap(<SemanticSaveRecovery {...props} draft={{ ...props.draft, description: "继续编辑" }} />, locale));
    expect(screen.getByRole("region", { name: copy.draft })).toHaveTextContent("继续编辑");
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(props.onLoad).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: copy.load }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByRole("button", { name: copy.keep })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole("button", { name: copy.keep }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(props.onLoad).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: copy.load }));
    fireEvent.click(screen.getByRole("button", { name: copy.confirmLoad }));
    expect(props.onLoad).toHaveBeenCalledExactlyOnceWith(entry);
    expect(props.onRetry).not.toHaveBeenCalled();
  });
});
