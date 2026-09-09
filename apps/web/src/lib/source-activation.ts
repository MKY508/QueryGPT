import type { ProjectDataSource } from "@/lib/types/api";

type ActivationSource = Pick<ProjectDataSource, "kind" | "status" | "profile_data">;
type FileBlocker = "activation_pending" | "recipe_replay_drift" | "recipe_input_changed";

function profileRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/** Mirrors the API's activation boundary, not readiness or business decisions. */
export function fileSourceBlockers(source: ActivationSource): Set<FileBlocker> {
  const blockers = new Set<FileBlocker>();
  if (source.kind !== "file") return blockers;
  const profile = profileRecord(source.profile_data);
  if (profile.activation_state === "pending_confirmation") blockers.add("activation_pending");
  if (Array.isArray(profile.issues)) for (const issue of profile.issues) {
    const code = profileRecord(issue).code;
    if (code === "recipe_replay_drift" || code === "recipe_input_changed") blockers.add(code);
  }
  return blockers;
}

export function sourceIsCurrent(source: ActivationSource): boolean {
  return source.status !== "superseded" && profileRecord(source.profile_data).is_current !== false &&
    fileSourceBlockers(source).size === 0;
}
