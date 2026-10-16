import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataWorkspacePanel } from "@/components/chat/DataWorkspacePanel";
import { CleaningSamples } from "@/components/chat/CleaningSamples";
import { VisualCleaningEditor } from "@/components/chat/VisualCleaningEditor";
import { sourceCleaningColumns, cleaningColumnLabels } from "@/lib/cleaning-field-names";
import type { ProjectDataSource, VisualCleaningPreview } from "@/lib/types/api";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";

const http = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ api: http }));
import { useProjectStore } from "@/lib/stores/project";

const fields = [...Array.from({ length: 42 }, (_, index) => `amount_${index + 1}`), "amount", " amount "];
const target = " amount ", labels = cleaningColumnLabels(fields);
const source: ProjectDataSource = { id: "handoff-source", project_id: "handoff-project", kind: "file", name: "门店经营.csv", status: "ready",
  profile_data: { schema: { rows: 120, columns: fields.map(name => ({ name, dtype: "str" })) },
    sample: [Object.fromEntries(fields.map(name => [name, ` ${name} `]))] }, created_at: "2026-09-06", updated_at: "2026-09-06" };
const preview: VisualCleaningPreview = { source_id: source.id, operations_hash: "a".repeat(64), source_fingerprint: "b".repeat(64),
  preview_output_fingerprint: "c".repeat(64), can_apply: true, before: { rows: 120, columns: fields.length, sample: [{ [target]: " 直营 " }] },
  after: { rows: 120, columns: fields.length, sample: [{ [target]: "直营" }] }, changes: [{ column: target, changed_count: 10 }], comparison_basis: "position" };
const original = useProjectStore.getState();
const response = (data: unknown) => ({ data: { data } });
const panel = (english = false) => <NextIntlClientProvider locale={english ? "en" : "zh"} messages={english ? en : zh}>
  <DataWorkspacePanel open embedded connections={[]} onClose={vi.fn()} onConfigureConnection={vi.fn()} />
</NextIntlClientProvider>;
const columnAction = (name: string, english = false) => (english ? en : zh).visualCleaning.cleanColumnAria.replace("{column}", name);
beforeEach(() => {
  http.post.mockReset(); http.get.mockReset(); document.documentElement.lang = "zh";
  useProjectStore.setState({ currentProjectId: source.project_id, sources: [source], recipes: [], recipeTemplates: [], preflightReports: [], knowledge: [],
    sourceAction: null, cleaningAction: null, cleaningPreviewBySource: {}, error: null, refreshCurrent: vi.fn().mockResolvedValue(undefined) });
});
afterEach(() => { cleanup(); useProjectStore.setState(original, true); vi.restoreAllMocks(); });

describe("source field to cleaning handoff", () => {
  it("uses the source schema before a stale report, retaining exact schema-only and legacy field names", () => {
    const stale = { columns: [{ name: "old_column" }] };
    const profile = { sample: [{ amount: "0012" }], schema: { columns: [{ name: "amount" }, { name: " amount " }, { name: "schema_only" }] } };
    expect(sourceCleaningColumns(profile, stale)).toEqual(["amount", " amount ", "schema_only"]);
    expect(sourceCleaningColumns({ ...profile, schema: null }, stale)).toEqual(["amount"]);
    expect(sourceCleaningColumns({ sample: profile.sample }, stale)).toEqual(["amount", "old_column"]);
    expect(sourceCleaningColumns({ schema: profile.schema })).toEqual(["amount", " amount ", "schema_only"]);
    expect(sourceCleaningColumns(null, stale)).toEqual([]);
  });

  it("opens a searched exact field, retains its browsing position and uses the existing preview/apply contract", async () => {
    http.post.mockResolvedValueOnce(response(preview)).mockResolvedValueOnce(response({ recipe: {}, revision: {}, preflight: {} }));
    render(panel());
    const data = screen.getByRole("region", { name: zh.sourcePreview.title });
    fireEvent.click(within(data).getByRole("tab", { name: "字段44" }));
    const search = within(data).getByRole("searchbox", { name: zh.sourcePreview.searchFields });
    fireEvent.change(search, { target: { value: labels.get(target)! } });
    const opener = within(data).getByRole("button", { name: columnAction(labels.get(target)!) });
    opener.focus(); fireEvent.click(opener);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("combobox", { name: zh.visualCleaning.selectColumnAria })).toHaveValue(target);
    expect(within(dialog).getByRole("combobox", { name: zh.visualCleaning.sampleLocateColumn })).toHaveValue(target);
    expect(within(dialog).queryByRole("button", { name: zh.visualCleaning.previewChanges })).not.toBeInTheDocument();
    expect(http.post).not.toHaveBeenCalled(); expect(http.get).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: /^去除首尾空格/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: zh.visualCleaning.previewChanges }));
    fireEvent.click(await within(dialog).findByRole("button", { name: zh.visualCleaning.applyButton }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(http.post.mock.calls[0][1]).toEqual({ operations: [{ operation: "trim_text", column: target }] });
    expect(http.post.mock.calls[1][1]).toEqual({ operations: [{ operation: "trim_text", column: target }],
      expected_operations_hash: preview.operations_hash, expected_source_fingerprint: preview.source_fingerprint,
      expected_preview_output_fingerprint: preview.preview_output_fingerprint, expected_current_working_fingerprint: null,
      expected_current_recipe_active_revision_id: null });
    expect(search).toHaveValue(labels.get(target)); expect(opener).toHaveFocus();
  });

  it("hands off the sample's actual selected column, survives locale changes and does not leak it into general entry", () => {
    const { rerender } = render(panel());
    const locator = screen.getByRole("combobox", { name: zh.visualCleaning.sampleLocateColumn });
    fireEvent.change(locator, { target: { value: target } });
    rerender(panel(true));
    fireEvent.click(screen.getByRole("button", { name: columnAction(labels.get(target)!, true) }));
    expect(within(screen.getByRole("dialog")).getByRole("combobox", { name: en.visualCleaning.selectColumnAria })).toHaveValue(target);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: en.visualCleaning.closeEditorAria }));
    expect(locator).toHaveValue(target);
    fireEvent.click(screen.getByRole("button", { name: en.dataWorkspace.sourceCleanButton }));
    expect(within(screen.getByRole("dialog")).getByRole("combobox", { name: en.visualCleaning.selectColumnAria })).toHaveValue(fields[0]);
    expect(http.post).not.toHaveBeenCalled(); expect(http.get).not.toHaveBeenCalled();
  });

  it("opens schema-only fields without adding stale report columns and clears its target across project round trips", () => {
    const item = { ...source, profile_data: { schema: { rows: 0, columns: [{ name: "new_field", dtype: "str" }] }, sample: [] } };
    useProjectStore.setState({ sources: [item], preflightReports: [{ id: "older-report", project_id: source.project_id, data_source_id: source.id,
      status: "ready", summary: "", issues: [], ambiguities: [], inferred_schema: { columns: [{ name: "old_column" }] }, created_at: "2026-09-06" }] });
    render(panel());
    fireEvent.click(screen.getByRole("button", { name: columnAction("new_field") }));
    const picker = within(screen.getByRole("dialog")).getByRole("combobox", { name: zh.visualCleaning.selectColumnAria });
    expect(picker).toHaveValue("new_field");
    expect(within(picker).getAllByRole("option")).toHaveLength(1);
    act(() => useProjectStore.setState({ currentProjectId: "other-project", sources: [{ ...item, project_id: "other-project" }] }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => useProjectStore.setState({ currentProjectId: source.project_id, sources: [item] }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(http.post).not.toHaveBeenCalled(); expect(http.get).not.toHaveBeenCalled();
  });

  it("only enables sample actions when supplied and follows column-window navigation", () => {
    const onClean = vi.fn();
    const before = { rows: 1, columns: fields.length, sample: source.profile_data.sample! };
    const view = (enabled: boolean) => <NextIntlClientProvider locale="zh" messages={zh}>
      <CleaningSamples before={before} onCleanColumn={enabled ? onClean : undefined} />
    </NextIntlClientProvider>;
    const { rerender } = render(view(false));
    expect(screen.queryByRole("button", { name: /^整理列：/ })).not.toBeInTheDocument();
    rerender(view(true));
    fireEvent.click(screen.getByRole("button", { name: zh.visualCleaning.sampleNextColumns }));
    fireEvent.click(screen.getByRole("button", { name: columnAction(labels.get(fields[8])!) }));
    expect(onClean).toHaveBeenCalledExactlyOnceWith(fields[8]);
  });

  it("treats initial column as an entry hint without resetting in-progress edits on parent refresh", () => {
    const view = (initialColumn: string) => <NextIntlClientProvider locale="zh" messages={zh}>
      <VisualCleaningEditor source={source} columns={fields} initialColumn={initialColumn} onClose={vi.fn()} />
    </NextIntlClientProvider>;
    const { rerender } = render(view(target));
    fireEvent.click(screen.getByRole("button", { name: /^去除首尾空格/ }));
    rerender(view(fields[0]));
    expect(screen.getByRole("combobox", { name: zh.visualCleaning.selectColumnAria })).toHaveValue(target);
    expect(screen.getByRole("checkbox", { name: /本次使用步骤/ })).toBeChecked();
    expect(http.post).not.toHaveBeenCalled();
  });

  it("locates the initial sample column after layout and cancels pending positioning on unmount", () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(callback => { frames.set(++nextFrame, callback); return nextFrame; });
    const cancel = vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(id => { frames.delete(id); });
    const view = (sample: NonNullable<ProjectDataSource["profile_data"]["sample"]>) => <NextIntlClientProvider locale="zh" messages={zh}>
      <CleaningSamples preferredColumns={[target]} before={{ rows: 1, columns: fields.length, sample }} />
    </NextIntlClientProvider>;
    const { rerender, unmount } = render(view(source.profile_data.sample!));
    const header = screen.getByRole("columnheader", { name: labels.get(target)! });
    const scroller = screen.getByRole("table").parentElement!;
    vi.spyOn(header, "getBoundingClientRect").mockReturnValue({ left: 1100 } as DOMRect);
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({ left: 20 } as DOMRect);
    expect(scroller.scrollLeft).toBe(0);
    const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0));
    expect(scroller.scrollLeft).toBe(1040);
    rerender(view([...source.profile_data.sample!]));
    const queued = [...frames.keys()]; expect(queued).toHaveLength(1);
    unmount();
    expect(cancel).toHaveBeenCalledWith(queued[0]); expect(frames.size).toBe(0);
  });
});
