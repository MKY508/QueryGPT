import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { ReportPageNavigator } from "@/components/reports/ReportPageNavigator";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";

describe("report page navigation", () => {
  it.each(["zh", "en"] as const)("keeps navigation available during mutation locks in %s", locale => {
    const messages = locale === "zh" ? zh : en;
    const copy = messages.reportWorkspace;
    const select = vi.fn(), add = vi.fn();
    const pages = [{ id: "one", title: "经营概览" }, { id: "two", title: "门店明细" }];
    const panel = (activePageId: string, editing = true) => <NextIntlClientProvider locale={locale} messages={messages}>
      <ReportPageNavigator pages={pages} activePageId={activePageId} editing={editing} mutationDisabled onSelectPage={select} onAddPage={add} />
    </NextIntlClientProvider>;
    const { rerender } = render(panel("one"));
    expect(screen.getByRole("button", { name: copy.previousPage })).toBeDisabled();
    expect(screen.getByRole("button", { name: copy.addPage })).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "two" } });
    expect(select).toHaveBeenLastCalledWith("two");
    rerender(panel("two", false));
    expect(screen.getByRole("combobox")).toHaveValue("two");
    expect(screen.getByRole("button", { name: copy.nextPage })).toBeDisabled();
    expect(screen.queryByRole("button", { name: copy.addPage })).not.toBeInTheDocument();
    expect(add).not.toHaveBeenCalled();
  });
});
