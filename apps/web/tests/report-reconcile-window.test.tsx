import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import { ReportConflictPanel } from "@/components/reports/ReportConflictPanel";
import type { ReportDocument } from "@/lib/reports";
import { mockSemanticDialogs } from "./semantic-dialog-mock";
import messages from "@/messages/zh.json";

afterEach(cleanup);
const base: ReportDocument = { id: "report", project_id: "project", title: "原始报告", description: "", status: "draft", version: 1, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z", pages: [{ id: "page", title: "概览", order_index: 0, config: {}, blocks: [] }] };

it("requires a snapshot-specific choice and prevents task shortcuts from reaching the editor", () => {
  const restoreDialogs = mockSemanticDialogs();
  const apply = vi.fn(), close = vi.fn(), behind = vi.fn();
  const mine = { ...base, title: "我的报告" }, latest = { ...base, title: "保存的报告", version: 2 };
  const view = (remote: ReportDocument, busy = false) => <NextIntlClientProvider locale="zh" messages={messages}><div onKeyDown={behind}>
    <ReportConflictPanel base={base} mine={mine} latest={remote} loading={false} applying={busy} failed={false} applyFailed={false} onRetry={vi.fn()} onApply={apply} onClose={close} />
  </div></NextIntlClientProvider>;
  try {
    const { rerender } = render(view(latest));
    const submit = screen.getByRole("button", { name: messages.reportConflict.apply });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getAllByRole("radio")[0]);
    expect(submit).toBeEnabled(); fireEvent.click(submit);
    expect(apply.mock.calls[0][0]).toMatchObject({ title: mine.title, version: latest.version });
    rerender(view({ ...latest, title: "更新后的报告", version: 3 }));
    expect(submit).toBeDisabled();
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "s", metaKey: true });
    expect(fireEvent.keyDown(dialog, { key: "Escape", isComposing: true })).toBe(false);
    expect(behind).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
    rerender(view(latest, true));
    const cancel = new Event("cancel", { cancelable: true }); fireEvent(dialog, cancel);
    expect(cancel.defaultPrevented).toBe(true);
  } finally { cleanup(); restoreDialogs(); }
});
