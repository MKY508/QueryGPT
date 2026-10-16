import { describe, expect, it } from "vitest";
import type { AnalysisArtifact, AnalysisHistoryItem } from "@/lib/types/api";
import { groupInvestigationSelection, investigationSelectionKey, investigationSelectionReducer as reduce } from "@/components/reports/investigation-selection";

const run: AnalysisHistoryItem = { id: "run", project_id: "project", conversation_id: null, query: "收入",
  state: "completed", stage: "completed", report: { title: "月报", summary: "摘要" }, created_at: "2026-09-01", updated_at: "2026-09-01" };
const artifact: AnalysisArtifact = { id: "summary", project_id: run.project_id, analysis_run_id: run.id,
  kind: "metric", title: "收入", payload: { value: "9007199254740993.25" }, technical_details: {}, created_at: "2026-09-01", updated_at: "2026-09-01" };

describe("cross-investigation selection state", () => {
  it("reorders whole source groups and their items without changing snapshots or crossing source boundaries", () => {
    const other = { ...run, project_id: "other" };
    let selection = reduce(new Map(), { type: "selectNew", run, artifacts: [artifact], existingIds: new Set() });
    selection = reduce(selection, { type: "selectNew", run: other, artifacts: [{ ...artifact, project_id: "other" }], existingIds: new Set() });
    const original = [...selection], groupKey = investigationSelectionKey(other), key = investigationSelectionKey(run, artifact.id);
    const moved = reduce(selection, { type: "moveGroup", key: groupKey, direction: -1 });
    expect(groupInvestigationSelection(moved).map((group) => group.run.project_id)).toEqual(["other", "project"]);
    const arranged = reduce(moved, { type: "moveItem", key, direction: -1 });
    expect(groupInvestigationSelection(arranged)[1].items.map(({ item }) => item.kind)).toEqual(["artifact", "summary"]);
    expect([...selection]).toEqual(original);
    for (const [itemKey, value] of selection) expect(arranged.get(itemKey)).toBe(value);
    for (const action of [
      { type: "moveGroup", key: groupKey, direction: -1 },
      { type: "moveItem", key, direction: -1 },
      { type: "moveGroup", key: "missing", direction: 1 },
      { type: "moveItem", key: "missing", direction: 1 },
      { type: "moveItem", key: investigationSelectionKey(run), direction: 1 },
    ] as const) expect(reduce(arranged, action)).toBe(arranged);
  });

  it("keeps deliberate summary ordering through bulk selection, new items and scoped removal", () => {
    let selection = reduce(new Map(), { type: "selectNew", run, artifacts: [artifact], existingIds: new Set() });
    selection = reduce(selection, { type: "moveItem", key: investigationSelectionKey(run), direction: 1 });
    const added = { ...artifact, id: "new", title: "New" };
    selection = reduce(selection, { type: "selectNew", run, artifacts: [{ ...artifact, title: "Changed" }, added], existingIds: new Set() });
    const entries = groupInvestigationSelection(selection)[0].items;
    expect(entries.map(({ item }) => item.kind === "artifact" ? item.artifact.id : "summary text")).toEqual(["summary", "summary text", "new"]);
    expect(entries[0].item).toEqual({ kind: "artifact", run, artifact });
    const removed = reduce(selection, { type: "remove", key: investigationSelectionKey(run, artifact.id) });
    expect(groupInvestigationSelection(removed)[0].items.map(({ item }) => item.kind)).toEqual(["summary", "artifact"]);
    expect(reduce(selection, { type: "clearRun", run }).size).toBe(0);
  });

  it("uses scoped identities, rejects foreign payloads, and bulk add never deselects existing explicit choices", () => {
    const empty = new Map();
    const selected = reduce(empty, { type: "toggleArtifact", run, artifact });
    const same = reduce(selected, { type: "selectNew", run, artifacts: [artifact, { ...artifact, id: "foreign", project_id: "other" }], existingIds: new Set([artifact.id]) });
    expect(empty.size).toBe(0);
    expect(selected.size).toBe(1);
    expect(same.size).toBe(2);
    expect(same.get(investigationSelectionKey(run, artifact.id))).toEqual({ kind: "artifact", run, artifact });
    expect(groupInvestigationSelection(same)[0].items.map(({ item }) => item.kind)).toEqual(["summary", "artifact"]);
    const other = { ...run, project_id: "other" };
    const added = reduce(same, { type: "summary", run: other, selected: true });
    const cleared = reduce(added, { type: "clearRun", run });
    expect(cleared.size).toBe(1);
    expect([...cleared.values()][0].run.project_id).toBe("other");
  });

  it("does not silently update picked values on re-selection, while explicit remove and pick can use newer values", () => {
    const original = reduce(new Map(), { type: "selectNew", run, artifacts: [artifact], existingIds: new Set() });
    const changed = { ...artifact, payload: { value: "999" } };
    const retained = reduce(original, { type: "selectNew", run, artifacts: [changed], existingIds: new Set() });
    const picked = retained.get(investigationSelectionKey(run, artifact.id));
    expect(picked).toEqual({ kind: "artifact", run, artifact });
    const removed = reduce(retained, { type: "remove", key: investigationSelectionKey(run, artifact.id) });
    const replaced = reduce(removed, { type: "toggleArtifact", run, artifact: changed });
    expect(replaced.get(investigationSelectionKey(run, artifact.id))).toEqual({ kind: "artifact", run, artifact: changed });
    expect(reduce(replaced, { type: "clear" }).size).toBe(0);
    expect(original.size).toBe(2);
  });
});
