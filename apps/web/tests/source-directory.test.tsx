import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SourceDirectory } from "@/components/chat/SourceDirectory";
import { DataWorkspacePanel } from "@/components/chat/DataWorkspacePanel";
import { currentSourceVersionLinks, sourceAwaitsReplacement, sourceDirectoryGroup, sourceDirectoryMatches, sourceDisplayState } from "@/lib/source-directory";
import { fileSourceBlockers, sourceIsCurrent } from "@/lib/source-activation";
import { useProjectStore } from "@/lib/stores/project";
import type { PreflightReport, ProjectDataSource } from "@/lib/types/api";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";

function source(index: number, extra: Partial<ProjectDataSource> = {}): ProjectDataSource {
  return { id: `source-${index}`, project_id: "directory-project", kind: "file", name: `门店-${index}.csv`,
    format: "csv", status: "ready", profile_data: {}, created_at: "2026-09-06T00:00:00Z", updated_at: "2026-09-06T00:00:00Z", ...extra };
}
const originalStore = useProjectStore.getState();
afterEach(() => { cleanup(); useProjectStore.setState(originalStore, true); vi.restoreAllMocks(); });

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
function openDetails(name: string) {
  const back = screen.queryByRole("button", { name: zh.sourceDirectory.backToList });
  if (back) fireEvent.click(back);
  fireEvent.click(row(name));
  return details(name);
}

describe("source directory", () => {
  it("browses compact rows by keyboard and mounts only the selected source details", () => {
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

  it("matches the shared backend activation examples and keeps blocking states actionable", () => {
    const examples = JSON.parse(readFileSync(resolve(process.cwd(), "../api/tests/fixtures/source-activation.json"), "utf8")) as {
      name: string; source: ProjectDataSource; current: boolean; blockers: string[]; display: string;
    }[];
    for (const example of examples) {
      expect(sourceIsCurrent(example.source), example.name).toBe(example.current);
      expect([...fileSourceBlockers(example.source)].sort(), example.name).toEqual(example.blockers);
      expect(sourceDisplayState(example.source), example.name).toBe(example.display);
      if (["activation_pending", "preparation_review"].includes(example.display)) expect(sourceDirectoryGroup(example.source)).toBe("attention");
    }
  });

  it("shows legacy blockers consistently in source cards and the understanding overview", () => {
    const marked = [source(1, { profile_data: { issues: [{ code: "recipe_input_changed" }] } }),
      source(2, { profile_data: { activation_state: "pending_confirmation", is_current: false } }),
      source(3, { status: "needs_confirmation" }), source(4, { status: "superseded" }), source(5), source(6)];
    const reports: PreflightReport[] = [{ id: "preflight-5", project_id: "directory-project", data_source_id: "source-5",
      status: "needs_confirmation", summary: "Replacement pending", issues: [], ambiguities: [], created_at: "2026-09-01T00:00:00Z",
      source_snapshot: { replacement: { status: "pending_confirmation", active_source_id: "source-6" } } }];
    const recipes = marked.map((item) => ({ id: `recipe-${item.id}`, project_id: item.project_id, data_source_id: item.id,
      name: item.name, status: "applied", operations: [], created_at: item.created_at, updated_at: item.updated_at }));
    const profileSource = vi.fn(), reorganizeSource = vi.fn(), acceptReplacement = vi.fn();
    useProjectStore.setState({ currentProjectId: "directory-project", sources: marked, preflightReports: reports, recipes, recipeTemplates: [], knowledge: [],
      profileSource, reorganizeSource, acceptReplacement, sourceAction: null, error: null });
    const panel = (view: "sources" | "understanding") => <NextIntlClientProvider locale="zh" messages={zh}>
      <DataWorkspacePanel open embedded view={view} onClose={vi.fn()} onConfigureConnection={vi.fn()} connections={[]} />
    </NextIntlClientProvider>;
    const { rerender } = render(panel("sources"));
    expect(screen.getByRole("button", { name: "待处理4" })).toBeInTheDocument();
    const changed = openDetails("门店-1.csv");
    expect(changed).toHaveTextContent(zh.dataWorkspace.statusPreparationReview);
    expect(changed).toHaveTextContent(zh.dataWorkspace.preflightSourceChanged);
    expect(within(changed).getByRole("button", { name: zh.dataWorkspace.sourceRetryButton })).toBeInTheDocument();
    const pending = openDetails("门店-2.csv");
    expect(pending).toHaveTextContent(zh.dataWorkspace.sourceStatusWaiting);
    expect(pending).toHaveTextContent(zh.dataWorkspace.preflightReplacementWaiting);
    expect(within(pending).queryByRole("button", { name: zh.dataWorkspace.sourceAcceptButton })).not.toBeInTheDocument();
    expect(screen.getByLabelText("门店-3.csv")).toHaveTextContent(zh.dataWorkspace.statusNeedsReview);
    expect(screen.getByLabelText("门店-4.csv")).toHaveTextContent(zh.dataWorkspace.statusHistorical);
    expect(screen.getByLabelText("门店-5.csv")).toHaveTextContent(zh.dataWorkspace.sourceStatusWaiting);
    expect(within(openDetails("门店-5.csv")).getByRole("button", { name: zh.dataWorkspace.sourceAcceptButton })).toBeInTheDocument();
    expect(screen.getByLabelText("门店-6.csv")).toHaveTextContent(zh.dataWorkspace.statusReady);
    for (const index of [1, 2, 4, 5]) expect(within(openDetails(`门店-${index}.csv`)).queryByRole("button", { name: zh.dataWorkspace.sourceUpdateFile })).not.toBeInTheDocument();
    for (const index of [3, 6]) expect(within(openDetails(`门店-${index}.csv`)).getByRole("button", { name: zh.dataWorkspace.sourceUpdateFile })).toBeInTheDocument();
    rerender(panel("understanding"));
    const map = screen.getByLabelText(zh.dataWorkspace.understandingMapAria);
    expect(map.querySelector('[data-source-overview-node="source-1"]')).toHaveTextContent(zh.dataWorkspace.statusPreparationReview);
    expect(map.querySelector('[data-source-overview-node="source-2"]')).toHaveTextContent(zh.dataWorkspace.sourceStatusWaiting);
    expect(map.querySelector('[data-source-overview-node="source-3"]')).toHaveTextContent(zh.dataWorkspace.statusNeedsReview);
    expect(map.querySelector('[data-source-overview-node="source-4"]')).toHaveTextContent(zh.dataWorkspace.statusHistorical);
    expect(map.querySelector('[data-source-overview-node="source-5"]')).toHaveTextContent(zh.dataWorkspace.sourceStatusWaiting);
    expect(map.querySelector('[data-source-overview-node="source-6"]')).toHaveTextContent(zh.dataWorkspace.statusReady);
    expect(profileSource).not.toHaveBeenCalled(); expect(reorganizeSource).not.toHaveBeenCalled(); expect(acceptReplacement).not.toHaveBeenCalled();
  });

  it("follows recorded version chains without guessing from names or timestamps", () => {
    const first = source(1, { status: "superseded", profile_data: { superseded_by: "source-2" } });
    const middle = source(2, { status: "superseded", profile_data: { superseded_by: "source-3" } });
    const current = source(3, { status: "needs_confirmation" });
    const unrelated = source(4, { name: current.name, updated_at: "2099-01-01T00:00:00Z" });
    const sources = [first, middle, current, unrelated];
    const before = structuredClone(sources);
    const links = currentSourceVersionLinks(sources, []);
    expect(links.get(first.id)).toBe(current);
    expect(links.get(middle.id)).toBe(current);
    expect(links.has(current.id)).toBe(false);
    expect(sources).toEqual(before);
  });

  it("omits broken, cyclic, cross-project, duplicated and not-yet-active version targets", () => {
    const old = source(0, { status: "superseded", profile_data: { superseded_by: "source-1" } });
    const targets = [
      source(1, { project_id: "different-project" }),
      source(1, { kind: "connection" }),
      source(1, { profile_data: { is_current: false } }),
      source(1, { profile_data: { activation_state: "pending_confirmation" } }),
      source(1, { profile_data: { issues: [{ code: "recipe_replay_drift" }] } }),
      source(1, { profile_data: { issues: [{ code: "recipe_input_changed" }] } }),
      source(1, { status: "superseded", profile_data: { superseded_by: old.id } }),
    ];
    for (const target of targets) expect(currentSourceVersionLinks([old, target], []).size).toBe(0);
    expect(currentSourceVersionLinks([old], []).size).toBe(0);
    expect(currentSourceVersionLinks([old, source(1), source(1)], []).size).toBe(0);
    const report = { data_source_id: "source-1", source_snapshot: { replacement: { status: "pending_confirmation", active_source_id: old.id } } } as PreflightReport;
    expect(currentSourceVersionLinks([old, source(1)], [report]).size).toBe(0);
  });

  it("jumps beyond the source window then restores search, status and the historical card focus", () => {
    const sources = Array.from({ length: 45 }, (_, index) => source(index));
    sources[0] = source(0, { status: "superseded", profile_data: { superseded_by: "source-44" } });
    render(directory(sources));
    fireEvent.click(screen.getByRole("button", { name: "历史版本1" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "门店-0" } });
    fireEvent.click(row("门店-0.csv"));
    fireEvent.click(screen.getByRole("button", { name: "查看当前版本：门店-44.csv" }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByRole("button", { name: "全部45" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("显示 45 / 45 项");
    expect(details("门店-44.csv")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: zh.sourceDirectory.backToVersion }));
    expect(screen.getByRole("searchbox")).toHaveValue("门店-0");
    expect(screen.getByRole("button", { name: "历史版本1" })).toHaveAttribute("aria-pressed", "true");
    expect(details("门店-0.csv")).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("显示 1 / 1 项");
  });

  it("refocuses an already visible target and handles a renamed or removed return source", () => {
    const old = source(0, { status: "superseded", profile_data: { superseded_by: "source-1" } });
    const current = source(1);
    const { rerender } = render(directory([old, current], "en"));
    fireEvent.click(row("门店-0.csv", "en"));
    fireEvent.click(screen.getByRole("button", { name: "View current version: 门店-1.csv" }));
    expect(details("门店-1.csv", "en")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: en.sourceDirectory.backToVersion }));
    expect(details("门店-0.csv", "en")).toHaveFocus();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "门店-0" } });
    fireEvent.click(screen.getByRole("button", { name: "View current version: 门店-1.csv" }));
    rerender(directory([{ ...old, name: "已改名.csv" }, current], "en"));
    fireEvent.click(screen.getByRole("button", { name: en.sourceDirectory.backToVersion }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(details("已改名.csv", "en")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "View current version: 门店-1.csv" }));
    rerender(directory([current], "en"));
    expect(screen.queryByRole("button", { name: en.sourceDirectory.backToVersion })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /View current version/ })).not.toBeInTheDocument();
  });

  it("separates pending replacements from history and only searches literal names", () => {
    const pending = source(1, { status: "needs_confirmation", profile_data: { is_current: false, activation_state: "pending_confirmation", replacement_of: "source-0" } });
    expect(sourceDirectoryGroup(pending)).toBe("attention");
    const report = { data_source_id: "source-1", source_snapshot: { replacement: { status: "pending_confirmation", active_source_id: "source-0" } } } as PreflightReport;
    expect(sourceDirectoryGroup(source(1, { profile_data: { is_current: false } }), report)).toBe("attention");
    expect(sourceAwaitsReplacement({ ...pending, status: "superseded" }, report)).toBe(false);
    expect(sourceDirectoryGroup({ ...pending, status: "superseded" }, report)).toBe("history");
    expect(sourceDirectoryGroup(source(2, { status: "error", profile_data: { is_current: false } }))).toBe("history");
    expect(sourceDirectoryGroup(source(3, { status: "attached" }))).toBe("attention");
    expect(sourceDirectoryGroup(source(4, { status: "error" }))).toBe("attention");
    expect(sourceDirectoryGroup(source(5))).toBe("ready");
    const named = source(6, { name: "Orders [a+b].CSV", fingerprint: "secret-hash", profile_data: { get sample(): never { throw new Error("Never search row data"); } } });
    expect(sourceDirectoryMatches(named, "  [A+B]  ")).toBe(true);
    for (const query of [".*", "secret-hash", "source-6"]) expect(sourceDirectoryMatches(named, query)).toBe(false);
  });

  it("renders twenty cards at a time, focuses new rows, and searches past the window", () => {
    const sources = Array.from({ length: 43 }, (_, index) => source(index));
    render(directory(sources));
    expect(screen.getByRole("status")).toHaveTextContent("显示 20 / 43 项");
    expect(screen.queryByText("门店-42.csv")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "再显示 20 项" }));
    expect(row("门店-20.csv")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "再显示 3 项" }));
    expect(row("门店-40.csv")).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("显示 43 / 43 项");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "门店-42" } });
    expect(screen.getByRole("status")).toHaveTextContent("显示 1 / 1 项");
    expect(screen.getByText("门店-42.csv")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: zh.sourceDirectory.clearSearch }));
    expect(screen.getByRole("searchbox")).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("显示 20 / 43 项");
  });

  it("filters live status updates without mutating sources and resets an empty result", () => {
    const sources = [source(1), source(2, { status: "error" }), source(3, { status: "superseded" })];
    const before = structuredClone(sources);
    const { rerender } = render(directory(sources));
    fireEvent.click(screen.getByRole("button", { name: "待处理1" }));
    expect(screen.getByText("门店-2.csv")).toBeInTheDocument();
    expect(screen.queryByText("门店-1.csv")).not.toBeInTheDocument();
    rerender(directory(sources.map((item) => item.id === "source-2" ? { ...item, status: "ready" } : item)));
    expect(screen.getByText(zh.sourceDirectory.noMatches)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: zh.sourceDirectory.reset }));
    expect(screen.getByRole("status")).toHaveTextContent("显示 3 / 3 项");
    expect(sources).toEqual(before);
  });

  it("preserves local search on locale changes, respects IME Escape and resets on project change", () => {
    const sources = [source(1, { name: "Orders [a+b].csv" })];
    const { rerender } = render(directory(sources));
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "[a+b]" } });
    fireEvent.keyDown(input, { key: "Escape", isComposing: true, keyCode: 229 });
    expect(input).toHaveValue("[a+b]");
    rerender(directory(sources, "en"));
    expect(screen.getByRole("searchbox")).toHaveValue("[a+b]");
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 1");
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
    expect(screen.getByRole("searchbox")).toHaveValue("");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "old-project" } });
    rerender(directory([source(2)], "en", "other-project"));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByText("门店-2.csv")).toBeInTheDocument();
  });

  it("keeps actual preparation controls and historical badges scoped to filtered source cards", () => {
    const profileSource = vi.fn();
    const removeSource = vi.fn();
    const acceptReplacement = vi.fn();
    useProjectStore.setState({ currentProjectId: "directory-project", sources: [source(1, { status: "superseded" }), source(2, { status: "attached" })],
      preflightReports: [], recipes: [], recipeTemplates: [], knowledge: [],
      profileSource, removeSource, acceptReplacement, sourceAction: null, error: null });
    const panel = (open: boolean) => <NextIntlClientProvider locale="zh" messages={zh}>
      <DataWorkspacePanel open={open} embedded onClose={vi.fn()} onConfigureConnection={vi.fn()} connections={[]} />
    </NextIntlClientProvider>;
    const { rerender } = render(panel(true));
    const region = screen.getByRole("region", { name: zh.dataWorkspace.projectSourcesTitle });
    expect(within(region).getByLabelText("门店-1.csv")).toHaveTextContent("历史版本");
    expect(openDetails("门店-1.csv")).toHaveTextContent(zh.dataWorkspace.preflightHistorical);
    fireEvent.click(screen.getByRole("button", { name: zh.sourceDirectory.backToList }));
    expect(within(region).queryByText(zh.dataWorkspace.statusSanitizing)).not.toBeInTheDocument();
    fireEvent.click(within(region).getByRole("button", { name: "待处理1" }));
    fireEvent.click(row("门店-2.csv"));
    expect(within(region).getByRole("button", { name: zh.dataWorkspace.sourcePrepareButton })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "门店-2" } });
    rerender(panel(false));
    rerender(panel(true));
    expect(screen.getByRole("searchbox")).toHaveValue("门店-2");
    act(() => useProjectStore.setState({ currentProjectId: "new-project", sources: [source(3, { project_id: "new-project" })] }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(details("门店-3.csv")).toBeInTheDocument();
    expect(profileSource).not.toHaveBeenCalled();
    expect(removeSource).not.toHaveBeenCalled();
    expect(acceptReplacement).not.toHaveBeenCalled();
  });
});
