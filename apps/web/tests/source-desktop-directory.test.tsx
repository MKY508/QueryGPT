import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import { SourceDirectory } from "@/components/chat/SourceDirectory";
import type { PreflightReport, ProjectDataSource } from "@/lib/types/api";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";

function source(index: number, extra: Partial<ProjectDataSource> = {}): ProjectDataSource {
  return { id: `source-${index}`, project_id: "directory-project", kind: "file", name: `门店-${index}.csv`,
    format: "csv", status: "ready", profile_data: {}, created_at: "2026-09-06T00:00:00Z", updated_at: "2026-09-06T00:00:00Z", ...extra };
}
afterEach(cleanup);

function directory(sources: ProjectDataSource[], locale = "zh", project = "directory-project", reports: PreflightReport[] = []) {
  return <NextIntlClientProvider locale={locale} messages={locale === "zh" ? zh : en}>
    <SourceDirectory key={project} sources={sources} reports={reports}>{(item) => <p>Details: {item.name}</p>}</SourceDirectory>
  </NextIntlClientProvider>;
}

function row(name: string, locale = "zh") {
  return screen.getByRole("button", { name: (locale === "zh" ? zh : en).sourceDirectory.openSource.replace("{name}", name) });
}
function details(name: string, locale = "zh") {
  return screen.getByRole("region", { name: (locale === "zh" ? zh : en).sourceDirectory.sourceDetails.replace("{name}", name) });
}
describe("source directory", () => {
  it("browses desktop rows by keyboard and mounts only the selected source details", () => {
    const sources = Array.from({ length: 25 }, (_, index) => source(index));
    render(directory(sources));
    expect(screen.queryByText(/^Details:/)).not.toBeInTheDocument();
    const input = screen.getByRole("searchbox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(row("门店-0.csv")).toHaveFocus();
    fireEvent.keyDown(row("门店-0.csv"), { key: "ArrowDown" });
    expect(row("门店-1.csv")).toHaveFocus();
    expect(screen.queryByText(/^Details:/)).not.toBeInTheDocument();
    fireEvent.keyDown(row("门店-1.csv"), { key: "End" });
    expect(row("门店-19.csv")).toHaveFocus();
    fireEvent.click(row("门店-19.csv"));
    expect(details("门店-19.csv")).toHaveFocus();
    fireEvent.keyDown(details("门店-19.csv"), { key: "Escape", keyCode: 229 });
    expect(details("门店-19.csv")).toHaveFocus();
    expect(screen.getAllByText(/^Details:/)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: zh.sourceDirectory.nextSource }));
    expect(details("门店-20.csv")).toHaveFocus();
    expect(screen.queryByText("Details: 门店-19.csv")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("显示 25 / 25 项");
    fireEvent.change(input, { target: { value: "门店" } });
    expect(screen.getByRole("status")).toHaveTextContent("显示 20 / 25 项");
    fireEvent.keyDown(details("门店-20.csv"), { key: "Escape" });
    expect(row("门店-20.csv")).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("显示 25 / 25 项");
    expect(screen.queryByText(/^Details:/)).not.toBeInTheDocument();
    fireEvent.keyDown(row("门店-20.csv"), { key: "Home" });
    fireEvent.keyDown(row("门店-0.csv"), { key: "ArrowUp" });
    expect(input).toHaveFocus();
  });

  it("keeps an active detail across filters and status updates, but not across source removal", () => {
    const sources = [source(1, { status: "error" }), source(2, { status: "error" }), source(3)];
    const { rerender } = render(directory(sources));
    fireEvent.click(screen.getByRole("button", { name: "待处理2" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "门店" } });
    fireEvent.click(row("门店-2.csv"));
    rerender(directory([sources[0], { ...sources[1], status: "ready" }, sources[2]]));
    expect(details("门店-2.csv")).toBeInTheDocument();
    expect(screen.getByText(zh.sourceDirectory.outsideFilter)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: zh.sourceDirectory.nextSource })).toBeDisabled();
    expect(screen.getByRole("button", { name: zh.sourceDirectory.previousSource })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: zh.sourceDirectory.locateSource }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(row("门店-2.csv")).toHaveAttribute("aria-current", "true");
    fireEvent.click(screen.getByRole("button", { name: zh.sourceDirectory.backToList }));
    expect(row("门店-2.csv")).toHaveFocus();
    fireEvent.click(row("门店-2.csv"));
    rerender(directory([sources[0], sources[2]]));
    expect(screen.queryByText(/^Details:/)).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveFocus();
    rerender(directory(sources));
    expect(screen.queryByText(/^Details:/)).not.toBeInTheDocument();
    fireEvent.click(row("门店-1.csv"));
    rerender(directory([]));
    expect(screen.getByRole("heading", { name: zh.dataWorkspace.projectSourcesTitle })).toHaveFocus();
  });

  it("preserves browsing and selection on locale changes, never consumes an editor Escape, and resets by project", () => {
    const sources = [source(1), source(2)];
    const view = (locale: "en" | "zh", project: string) => <NextIntlClientProvider locale={locale} messages={locale === "zh" ? zh : en}>
      <SourceDirectory key={project} sources={sources} reports={[]}>{(item) => <input aria-label={item.name} defaultValue="draft" />}</SourceDirectory>
    </NextIntlClientProvider>;
    const { rerender } = render(view("zh", "first"));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "门店-2" } });
    fireEvent.click(row("门店-2.csv"));
    const editor = within(details("门店-2.csv")).getByRole("textbox");
    editor.focus();
    fireEvent.keyDown(editor, { key: "Escape" });
    expect(editor).toHaveFocus();
    expect(details("门店-2.csv")).toBeInTheDocument();
    rerender(view("en", "first"));
    expect(details("门店-2.csv", "en")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: en.sourceDirectory.backToList }));
    expect(screen.getByRole("searchbox")).toHaveValue("门店-2");
    expect(row("门店-2.csv", "en")).toHaveFocus();
    rerender(view("en", "second"));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

});
