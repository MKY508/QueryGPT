import type { PreflightReport, ProjectDataSource } from "@/lib/types/api";
import { fileSourceBlockers, sourceIsCurrent } from "@/lib/source-activation";

export type SourceDirectoryFilter = "all" | "attention" | "ready" | "history";

export function sourceAwaitsReplacement(source: ProjectDataSource, report?: PreflightReport): boolean {
  if (source.status === "superseded" || source.kind !== "file") return false;
  const replacement = report?.source_snapshot?.replacement;
  return Boolean(
    (source.profile_data?.activation_state === "pending_confirmation" && source.profile_data.replacement_of) ||
    (replacement?.status === "pending_confirmation" && (replacement.replaces_source_id || replacement.active_source_id))
  );
}

export function sourceDisplayState(source: ProjectDataSource, report?: PreflightReport): string {
  if (source.status === "superseded") return "history";
  const blockers = fileSourceBlockers(source);
  if (sourceAwaitsReplacement(source, report) || blockers.has("activation_pending")) return "activation_pending";
  if (blockers.size > 0) return "preparation_review";
  if (source.profile_data?.is_current === false) return "history";
  return source.status;
}

export function sourceDirectoryGroup(
  source: ProjectDataSource,
  report?: PreflightReport,
): Exclude<SourceDirectoryFilter, "all"> | "other" {
  const state = sourceDisplayState(source, report);
  if (state === "history") return "history";
  if (["activation_pending", "preparation_review", "attached", "needs_confirmation", "error"].includes(state)) return "attention";
  if (state === "ready") return "ready";
  return "other";
}

export function sourceDirectoryMatches(source: ProjectDataSource, query: string): boolean {
  // Names only: do not scan samples, fingerprints, paths or connection details.
  return source.name.toLowerCase().includes(query.trim().toLowerCase());
}

/** Follow recorded replacements only; never infer a version from a name/date. */
export function currentSourceVersionLinks(
  sources: ProjectDataSource[], reports: PreflightReport[],
): Map<string, ProjectDataSource> {
  const byId = new Map<string, ProjectDataSource>();
  const duplicates = new Set<string>();
  for (const source of sources) {
    if (byId.has(source.id)) duplicates.add(source.id);
    byId.set(source.id, source);
  }
  const bySource = new Map<string, PreflightReport>();
  for (const report of reports) if (!bySource.has(report.data_source_id)) bySource.set(report.data_source_id, report);
  const resolved = new Map<string, ProjectDataSource | null>();
  const links = new Map<string, ProjectDataSource>();
  for (const source of sources) {
    if (source.kind !== "file" || sourceDirectoryGroup(source, bySource.get(source.id)) !== "history") continue;
    const visited = new Set<string>();
    let cursor: ProjectDataSource | undefined = source;
    let target: ProjectDataSource | null = null;
    while (cursor && cursor.kind === "file" && cursor.project_id === source.project_id && !duplicates.has(cursor.id)) {
      if (visited.has(cursor.id)) break;
      if (resolved.has(cursor.id)) { target = resolved.get(cursor.id) ?? null; break; }
      visited.add(cursor.id);
      const report = bySource.get(cursor.id);
      if (sourceDirectoryGroup(cursor, report) === "history") {
        const next: unknown = cursor.profile_data?.superseded_by;
        cursor = typeof next === "string" ? byId.get(next) : undefined;
        continue;
      }
      if (sourceIsCurrent(cursor) && !sourceAwaitsReplacement(cursor, report)) target = cursor;
      break;
    }
    for (const id of visited) resolved.set(id, target);
    if (target && target.id !== source.id) links.set(source.id, target);
  }
  return links;
}
