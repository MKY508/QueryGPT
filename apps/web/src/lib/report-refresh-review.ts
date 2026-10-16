import type { ReportRefreshPlan, ReportRefreshSourceLabel } from "./reports";

export type ReportRefreshSourceGroup = {
  key: string;
  state: "changed" | "unrecorded" | "current";
  previous: ReportRefreshSourceLabel | null;
  next: ReportRefreshSourceLabel;
  blocks: ReportRefreshPlan["blocks"];
};

export function groupReportRefreshSources(plan: ReportRefreshPlan): ReportRefreshSourceGroup[] {
  const groups = new Map<string, ReportRefreshSourceGroup>();
  const sourceKey = (source: ReportRefreshSourceLabel | null) => source
    ? [source.source_id, source.kind, source.data_version, source.name] : null;
  for (const block of plan.blocks) {
    const previous = block.previous_source, next = block.next_source;
    // Include both source identities and their displayed labels: similarly named
    // files, connections and different historical versions are not interchangeable.
    const key = JSON.stringify([sourceKey(previous), sourceKey(next)]);
    let group = groups.get(key);
    if (!group) {
      group = { key, previous, next, blocks: [], state: !previous ? "unrecorded"
        : previous.source_id !== next.source_id || previous.kind !== next.kind || previous.data_version !== next.data_version ? "changed" : "current" };
      groups.set(key, group);
    }
    group.blocks.push(block);
  }
  const priority = { changed: 0, unrecorded: 1, current: 2 };
  // Review priority does not change the approved execution plan or its ordering.
  return [...groups.values()].sort((a, b) => priority[a.state] - priority[b.state]);
}
