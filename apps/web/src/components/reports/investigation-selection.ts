import type { AnalysisArtifactSummary, AnalysisHistoryItem } from "@/lib/types/api";

export type InvestigationSelectionItem =
  | { kind: "summary"; run: AnalysisHistoryItem }
  | { kind: "artifact"; run: AnalysisHistoryItem; artifact: AnalysisArtifactSummary };
export type InvestigationSelection = ReadonlyMap<string, InvestigationSelectionItem>;

export function investigationSelectionKey(run: AnalysisHistoryItem, artifactId?: string): string {
  return JSON.stringify([run.project_id, run.id, artifactId === undefined ? "summary" : "artifact", artifactId]);
}

type SelectionAction =
  | { type: "moveItem" | "moveGroup"; key: string; direction: -1 | 1 }
  | { type: "toggleArtifact"; run: AnalysisHistoryItem; artifact: AnalysisArtifactSummary }
  | { type: "summary"; run: AnalysisHistoryItem; selected: boolean }
  | { type: "selectNew"; run: AnalysisHistoryItem; artifacts: AnalysisArtifactSummary[]; existingIds: ReadonlySet<string> }
  | { type: "clearRun"; run: AnalysisHistoryItem }
  | { type: "remove"; key: string }
  | { type: "clear" };

// Selection is independent of whichever page/source is currently loaded, as in
// controlled collection selection. Keep the exact chosen values until removed.
export function investigationSelectionReducer(
  current: InvestigationSelection, action: SelectionAction,
): InvestigationSelection {
  if (action.type === "clear") return new Map();
  if (action.type === "moveItem" || action.type === "moveGroup") {
    const groups = groupInvestigationSelection(current);
    const items = action.type === "moveGroup" ? groups
      : groups.find((group) => group.items.some((item) => item.key === action.key))?.items;
    const index = items?.findIndex((item) => item.key === action.key) ?? -1;
    const target = index + action.direction;
    if (!items || index < 0 || target < 0 || target >= items.length) return current;
    [items[index], items[target]] = [items[target], items[index]];
    return new Map(groups.flatMap((group) => group.items.map(({ key, item }) => [key, item] as const)));
  }
  const next = new Map(current);
  const putSummary = (run: AnalysisHistoryItem) => {
    const key = investigationSelectionKey(run);
    if (next.has(key)) return;
    // Newly chosen summaries start their source group. Existing summaries keep
    // any deliberate review ordering, including when selecting all new content.
    const entries = [...next];
    const index = entries.findIndex(([, item]) => item.run.project_id === run.project_id && item.run.id === run.id);
    entries.splice(index < 0 ? entries.length : index, 0, [key, { kind: "summary", run }]);
    next.clear();
    for (const [entryKey, item] of entries) next.set(entryKey, item);
  };
  const putArtifact = (run: AnalysisHistoryItem, artifact: AnalysisArtifactSummary) => {
    if (artifact.project_id !== run.project_id || artifact.analysis_run_id !== run.id || artifact.kind === "report") return;
    const key = investigationSelectionKey(run, artifact.id);
    if (!next.has(key)) next.set(key, { kind: "artifact", run, artifact });
  };
  switch (action.type) {
    case "remove": next.delete(action.key); break;
    case "clearRun":
      for (const [key, item] of next) {
        if (item.run.project_id === action.run.project_id && item.run.id === action.run.id) next.delete(key);
      }
      break;
    case "summary":
      if (action.selected) putSummary(action.run);
      else next.delete(investigationSelectionKey(action.run));
      break;
    case "toggleArtifact": {
      const key = investigationSelectionKey(action.run, action.artifact.id);
      if (next.has(key)) next.delete(key); else putArtifact(action.run, action.artifact);
      break;
    }
    case "selectNew":
      putSummary(action.run);
      for (const artifact of action.artifacts) {
        if (!action.existingIds.has(artifact.id)) putArtifact(action.run, artifact);
      }
      break;
  }
  return next;
}

export function groupInvestigationSelection(selection: InvestigationSelection) {
  const groups = new Map<string, {
    key: string; run: AnalysisHistoryItem; items: { key: string; item: InvestigationSelectionItem }[];
  }>();
  for (const [key, item] of selection) {
    const groupKey = investigationSelectionKey(item.run);
    let group = groups.get(groupKey);
    if (!group) {
      group = { key: groupKey, run: item.run, items: [] };
      groups.set(groupKey, group);
    }
    group.items.push({ key, item });
  }
  // Map order is the chosen order. Review and import share this grouping, and
  // movement changes order only, never source bindings or chosen snapshots.
  return [...groups.values()];
}
