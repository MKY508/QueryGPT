import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { groupInvestigationEntries, InvestigationList } from "@/components/chat/InvestigationList";
import type { ChatMessage } from "@/lib/types/chat";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";

function entry(key: string, index: number, run = "run-a", project = "project-a") {
  const message: ChatMessage = { role: "assistant", content: key, projectId: project, analysisRunId: run, analysisState: "completed", report: {
    status: "completed", title: `Result ${index + 1}`, summary: index === 0 ? "Revenue refund review" : "Current comparison",
    findings: [], metrics: [], evidence: [], follow_ups: [],
  } };
  return { key, index, title: "Compare stores", message };
}
const entries = [entry("old", 0), entry("middle", 1), entry("latest", 2)];
function view(props: Partial<React.ComponentProps<typeof InvestigationList>> = {}, locale = "zh") {
  return <NextIntlClientProvider locale={locale} messages={locale === "zh" ? zh : en}>
    <InvestigationList entries={entries} selectedKey="latest" search="" onSelect={vi.fn()} {...props} />
  </NextIntlClientProvider>;
}

describe("investigation list", () => {
  it("reuses normalized search text between queries and replaces it with changed entries", () => {
    const item = entry("searchable", 0);
    item.title = "Normalization sentinel";
    item.message.report!.summary = "Ｒｅｖｅｎｕｅ refund";
    const items = [item];
    const normalize = vi.spyOn(String.prototype, "normalize");
    const indexed = () => normalize.mock.contexts.filter(value => String(value).startsWith("Normalization sentinel Result 1 ")).length;
    try {
      const rendered = render(view({ entries: items }));
      expect(indexed()).toBe(0);
      rendered.rerender(view({ entries: items, search: "revenue" }));
      expect(indexed()).toBe(1);
      rendered.rerender(view({ entries: items, search: "refund" }));
      expect(indexed()).toBe(1);
      expect(screen.getByRole("button")).toHaveTextContent("refund");
      const changed = [{ ...item, message: { ...item.message, report: { ...item.message.report!, summary: "Delivery costs" } } }];
      rendered.rerender(view({ entries: changed, search: "refund" }));
      expect(indexed()).toBe(2);
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      rendered.rerender(view({ entries: changed, search: "delivery" }));
      expect(indexed()).toBe(2);
      expect(screen.getByRole("button")).toHaveTextContent("Delivery");
    } finally { normalize.mockRestore(); }
  });

  it("preserves original earlier-record numbers when search removes records between matches", () => {
    const items = Array.from({ length: 5 }, (_, index) => entry(`item-${index}`, index));
    for (const index of [1, 3]) items[index].message.report!.summary = "匹配退款";
    const select = vi.fn();
    render(view({ entries: items, search: "退款", onSelect: select }));
    const second = screen.getByRole("button", { name: /Result 2/ });
    const fourth = screen.getByRole("button", { name: /Result 4/ });
    expect(second).toHaveTextContent("记录 2"); expect(fourth).toHaveTextContent("记录 4");
    expect(screen.queryByRole("button", { name: /Result 3/ })).not.toBeInTheDocument();
    fireEvent.click(fourth); expect(select).toHaveBeenCalledExactlyOnceWith("item-3");
    expect(items.map(item => item.key)).toEqual(["item-0", "item-1", "item-2", "item-3", "item-4"]);
  });
  it("groups known run and project identity, orders by newest activity and does not merge unknown runs", () => {
    const unknown = { ...entry("unknown", 5), message: { role: "assistant" as const, content: "Unknown" } };
    const groups = groupInvestigationEntries([entries[0], entry("different-run", 1, "run-b"), entries[2], entry("different-project", 3, "run-a", "project-b"), unknown,
      { ...unknown, key: "another-unknown", index: 6 }]);
    expect(groups.map(group => group.latest.key)).toEqual(["another-unknown", "unknown", "different-project", "latest", "different-run"]);
    expect(groups[3].earlier.map(item => item.key)).toEqual(["old"]);
  });

  it("shows the latest result first and expands older records without selecting or submitting anything", () => {
    const select = vi.fn(); render(view({ onSelect: select }));
    expect(screen.queryByRole("button", { name: /Result 1/ })).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "2 条较早记录" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(select).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Result 1/ }));
    expect(select).toHaveBeenCalledExactlyOnceWith("old");
    fireEvent.click(toggle);
    expect(screen.queryByRole("button", { name: /Result 1/ })).not.toBeInTheDocument();
  });

  it("reveals a selected old result and keeps it visible when a newer attempt arrives", () => {
    const rendered = render(view());
    rendered.rerender(view({ selectedKey: "old" }));
    expect(screen.getByRole("button", { name: /Result 1/ })).toHaveAttribute("aria-current", "true");
    fireEvent.click(screen.getByRole("button", { name: "2 条较早记录" }));
    expect(screen.queryByRole("button", { name: /Result 1/ })).not.toBeInTheDocument();
    rendered.rerender(view({ entries: [...entries, entry("newest", 3)], selectedKey: "old" }));
    expect(screen.getByRole("button", { name: /Result 1/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "3 条较早记录" })).toHaveAttribute("aria-expanded", "true");
  });

  it("reveals older search matches with context, supports normalized terms and restores collapsed state", () => {
    const rendered = render(view({}, "en"));
    expect(screen.getByRole("button", { name: "2 earlier records" })).toHaveAttribute("aria-expanded", "false");
    rendered.rerender(view({ search: "ＲＥＶＥＮＵＥ refund" }, "en"));
    expect(screen.getByText("1 earlier match")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Result 1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Result 1/ })).toHaveTextContent("Revenue refund review");
    expect(screen.queryByRole("button", { name: /Result 2/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Compare stores/ })).toBeInTheDocument();
    rendered.rerender(view({}, "en"));
    expect(screen.getByRole("button", { name: "2 earlier records" })).toHaveAttribute("aria-expanded", "false");
    rendered.rerender(view({ search: "unmatched" }, "en"));
    expect(screen.getByText("No matching questions.")).toBeInTheDocument();
  });

  it("shows searchable report context without selecting a result and hides it again after clearing", () => {
    const select = vi.fn();
    const rendered = render(view({ selectedKey: "elsewhere", search: "Result 3", onSelect: select }));
    expect(screen.getByText("Result 3")).toBeVisible();
    expect(screen.getByText("Current comparison")).toBeVisible();
    expect(select).not.toHaveBeenCalled();
    rendered.rerender(view({ selectedKey: "elsewhere", search: "", onSelect: select }));
    expect(screen.queryByText("Result 3")).not.toBeInTheDocument();
    expect(screen.queryByText("Current comparison")).not.toBeInTheDocument();
  });

  it("crops long search summaries around literal Unicode matches without rendering markup", () => {
    const result = entry("unicode", 0);
    const summary = "背景说明。".repeat(100) + "Ｃａｆｅ́ <script>观察</script>" + "后续记录。".repeat(100);
    result.message.report!.summary = summary;
    const { container } = render(view({ entries: [result], search: "café", selectedKey: "elsewhere" }));
    const mark = container.querySelector("mark")!;
    expect(mark).toHaveTextContent("Ｃａｆｅ́");
    expect(mark.parentElement!.textContent!.length).toBeLessThan(80);
    expect(mark.parentElement).toHaveTextContent("<script>观察</script>");
    expect(container.querySelector("script")).toBeNull();
    expect(result.message.report!.summary).toBe(summary);
  });

  it("moves focus to the disclosure when a focused latest row becomes a collapsed older record", () => {
    const rendered = render(view({ entries: [entries[0]], selectedKey: "another-investigation" }));
    screen.getByRole("button", { name: /Compare stores/ }).focus();
    rendered.rerender(view({ entries, selectedKey: "another-investigation" }));
    expect(screen.getByRole("button", { name: "2 条较早记录" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "2 条较早记录" })).toHaveAttribute("aria-expanded", "false");
  });
});
