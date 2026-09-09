import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleaningColumnChoices } from "@/lib/cleaning-column-search";
import { cleaningColumnLabels } from "@/lib/cleaning-field-names";
import { CleaningColumnSelect } from "@/components/chat/CleaningColumnSelect";
import { CleaningImpactProfiles } from "@/components/chat/CleaningImpactProfiles";
import { VisualCleaningEditor } from "@/components/chat/VisualCleaningEditor";
import type { ProjectDataSource, VisualCleaningColumnProfile, VisualCleaningPreview } from "@/lib/types/api";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";

const http = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ api: http }));
import { useProjectStore } from "@/lib/stores/project";

const columns = [...Array.from({ length: 300 }, (_, index) => `amount_${index + 1}`), "amount", " amount ", "·amount·", "amount\u00a0"];
const labels = cleaningColumnLabels(columns);
const source: ProjectDataSource = { id: "search-source", project_id: "search-project", name: "宽表.csv", kind: "file", status: "ready", profile_data: { sample: [Object.fromEntries(columns.map(column => [column, ` ${column} `]))] }, created_at: "2026-09-06", updated_at: "2026-09-06" };
const preview: VisualCleaningPreview = { source_id: source.id, operations_hash: "a".repeat(64), source_fingerprint: "b".repeat(64), preview_output_fingerprint: "c".repeat(64), can_apply: true, before: { rows: 1, columns: columns.length, sample: [] }, after: { rows: 1, columns: columns.length, sample: [] }, changes: [] };
const original = useProjectStore.getState();
const wrap = (element: ReactNode, english = false) => <NextIntlClientProvider locale={english ? "en" : "zh"} messages={english ? en : zh}>{element}</NextIntlClientProvider>;
const response = (data: unknown) => ({ data: { data } });
const change = (element: HTMLElement, value: string) => fireEvent.change(element, { target: { value } });

beforeEach(() => {
  http.post.mockReset();
  useProjectStore.setState({ currentProjectId: source.project_id, cleaningAction: null, cleaningPreviewBySource: {}, error: null, refreshCurrent: vi.fn().mockResolvedValue(undefined) });
});
afterEach(() => { cleanup(); useProjectStore.setState({ currentProjectId: null, cleaningAction: null, cleaningPreviewBySource: {}, refreshCurrent: original.refreshCurrent }); });

describe("shared cleaning column search", () => {
  it("bounds candidates, promotes distant exact matches, and searches labels without rewriting identities", () => {
    const before = [...columns];
    const initial = cleaningColumnChoices(columns, labels, "", "en", "amount");
    expect(initial.matches).toHaveLength(80);
    expect(initial.truncated).toBe(true);
    expect(initial.pinned).toBe("amount");
    const exact = cleaningColumnChoices(columns, labels, "AMOUNT", "en", columns[0]);
    expect(exact.matches[0]).toBe("amount");
    expect(exact.matches).toHaveLength(80);
    expect(exact.truncated).toBe(true);
    for (const column of [" amount ", "·amount·", "amount\u00a0"]) {
      const found = cleaningColumnChoices(columns, labels, labels.get(column)!, "en", columns[0]);
      expect(found.matches).toEqual([column]);
    }
    expect(cleaningColumnChoices(["IŞIK", "İZ"], new Map(), "ışık", "tr", "İZ").matches).toEqual(["IŞIK"]);
    expect(cleaningColumnChoices(["", "__proto__", "a[0]"], new Map(), "[0]", "en", "")).toEqual({ matches: ["a[0]"], pinned: "", truncated: false });
    expect(cleaningColumnChoices(columns, labels, "missing", "en", "removed").pinned).toBeUndefined();
    expect(columns).toEqual(before);
  });

  it("keeps search separate from selection, supports clear and Escape, and disables both controls together", () => {
    const onChange = vi.fn();
    const bubbled = vi.fn();
    function Picker({ disabled = false, names = columns }: { disabled?: boolean; names?: string[] }) {
      const [value, setValue] = useState("amount");
      const [query, setQuery] = useState("");
      return <div onKeyDown={bubbled}><CleaningColumnSelect columns={names} labels={labels} value={value}
        onChange={(column) => { setValue(column); onChange(column); }} query={query} onQueryChange={setQuery}
        label="Column" searchLabel="Search columns" disabled={disabled} /></div>;
    }
    const { rerender } = render(wrap(<Picker />, true));
    const select = screen.getByRole("combobox", { name: "Column" });
    const input = screen.getByRole("searchbox", { name: "Search columns" });
    change(input, "missing");
    expect(select).toHaveValue("amount");
    expect(screen.getByRole("status")).toHaveTextContent("No matching columns");
    expect(within(select).getByRole("group", { name: "Current selection" })).toHaveTextContent(labels.get("amount")!);
    fireEvent.keyDown(input, { key: "Escape", isComposing: true });
    expect(input).toHaveValue("missing");
    bubbled.mockClear();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("");
    expect(bubbled).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    change(input, "299");
    fireEvent.click(screen.getByRole("button", { name: "Clear column search" }));
    expect(input).toHaveFocus();
    expect(select).toHaveValue("amount");
    change(input, labels.get(" amount ")!);
    change(select, " amount ");
    expect(onChange).toHaveBeenCalledExactlyOnceWith(" amount ");
    expect(input).toHaveValue("");
    change(input, "amount");
    rerender(wrap(<Picker disabled />, true));
    expect(input).toBeDisabled(); expect(select).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear column search" })).toBeDisabled();
    rerender(wrap(<Picker names={columns.slice(0, 12)} />, true));
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(within(select).getAllByRole("option")).toHaveLength(12);
    rerender(wrap(<Picker names={[]} />, true));
    expect(select).toBeDisabled();
  });

  it("sends only the explicitly chosen exact column through preview and apply, with search locked while busy", async () => {
    let resolvePreview!: (value: unknown) => void;
    http.post.mockImplementationOnce(() => new Promise(resolve => { resolvePreview = resolve; })).mockResolvedValueOnce(response({ recipe: {}, revision: {}, preflight: {} }));
    const close = vi.fn();
    render(wrap(<VisualCleaningEditor source={source} columns={columns} onClose={close} />));
    const input = screen.getByRole("searchbox", { name: "搜索要整理的列" });
    const select = screen.getByRole("combobox", { name: "选择要整理的列" });
    change(input, "not present");
    expect(select).toHaveValue(columns[0]);
    expect(http.post).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "预览变化" })).not.toBeInTheDocument();
    const target = " amount ";
    change(input, labels.get(target)!);
    change(select, target);
    expect(screen.getByRole("combobox", { name: "定位字段" })).toHaveValue(target);
    fireEvent.click(screen.getByRole("button", { name: "统一取值" }));
    expect(input).toBeDisabled(); expect(select).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "取消编辑" }));
    expect(input).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: zh.visualCleaning.trimWhitespace + zh.visualCleaning.trimWhitespaceDesc }));
    change(input, "amount_299");
    fireEvent.click(screen.getByRole("button", { name: "预览变化" }));
    expect(input).toBeDisabled(); expect(select).toBeDisabled();
    expect(http.post.mock.calls[0][1]).toEqual({ operations: [{ operation: "trim_text", column: target }] });
    await act(async () => resolvePreview(response(preview)));
    fireEvent.click(await screen.findByRole("button", { name: "应用整理" }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(http.post.mock.calls[1][1]).toEqual({ operations: [{ operation: "trim_text", column: target }], expected_operations_hash: preview.operations_hash, expected_source_fingerprint: preview.source_fingerprint, expected_preview_output_fingerprint: preview.preview_output_fingerprint, expected_current_working_fingerprint: null, expected_current_recipe_active_revision_id: null });
  });

  it("retains a search draft on routine refresh but clears it when switching the cleaning source", () => {
    const view = (value: ProjectDataSource) => wrap(<VisualCleaningEditor source={value} columns={columns} onClose={() => {}} />);
    const { rerender } = render(view(source));
    change(screen.getByRole("searchbox", { name: "搜索要整理的列" }), "299");
    rerender(view({ ...source, updated_at: "2026-09-07" }));
    expect(screen.getByRole("searchbox", { name: "搜索要整理的列" })).toHaveValue("299");
    rerender(view({ ...source, id: "another-source" }));
    expect(screen.getByRole("searchbox", { name: "搜索要整理的列" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "选择要整理的列" })).toHaveValue(columns[0]);
    expect(http.post).not.toHaveBeenCalled();
  });

  it("searches distant impact columns without changing the displayed measurements until selection", () => {
    const profile: VisualCleaningColumnProfile = { kind: "text", rows: 1, sample_rows: 1, null_count: 0, blank_count: 0, zero_count: null, non_finite_count: null, minimum: null, maximum: null, top_values: [], omitted_long_values: 0 };
    const value: VisualCleaningPreview = { ...preview, profiles: columns.map((column, index) => ({ column, before: { ...profile, null_count: index }, after: profile })) };
    const view = (data: VisualCleaningPreview) => wrap(<CleaningImpactProfiles preview={data} columnNames={columns} />);
    const { rerender } = render(view(value));
    const select = screen.getByRole("combobox", { name: "字段影响" });
    const input = screen.getByRole("searchbox", { name: "搜索影响字段" });
    change(input, "amount_300");
    expect(select).toHaveValue(columns[0]);
    change(select, "amount_300");
    expect(screen.getByRole("table")).toHaveTextContent("299");
    expect(input).toHaveValue("");
    change(input, "absent");
    expect(select).toHaveValue("amount_300");
    rerender(view({ ...value, profiles: value.profiles?.slice(0, 20) }));
    expect(input).toHaveValue("");
    expect(select).toHaveValue(columns[0]);
    expect(http.post).not.toHaveBeenCalled();
  });
});
