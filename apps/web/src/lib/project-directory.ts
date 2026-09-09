import type { Project } from "@/lib/types/api";

export const PROJECT_DIRECTORY_BATCH = 20;
export const PROJECT_NAME_LIMIT = 120;
export class ProjectOperationBusy extends Error {}

export function inspectProject(value: unknown, expected: { id?: string; name?: string } = {}): Project {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Unconfirmed project response");
  const project = value as Project;
  if (typeof project.id !== "string" || !project.id.trim() || typeof project.name !== "string" || !project.name.trim()
    || typeof project.status !== "string" || (project.description != null && typeof project.description !== "string")
    || !project.extra_data || typeof project.extra_data !== "object" || Array.isArray(project.extra_data)
    || typeof project.created_at !== "string" || !Number.isFinite(Date.parse(project.created_at))
    || typeof project.updated_at !== "string" || !Number.isFinite(Date.parse(project.updated_at))
    || (expected.id !== undefined && project.id !== expected.id) || (expected.name !== undefined && project.name !== expected.name)) {
    throw new Error("Unconfirmed project identity or name");
  }
  return project;
}

export function inspectProjectDirectory(value: unknown): Project[] {
  if (!Array.isArray(value)) throw new Error("Invalid project directory");
  const projects = value.map(item => inspectProject(item));
  if (new Set(projects.map(project => project.id)).size !== projects.length) throw new Error("Duplicate project identities");
  return projects;
}

export function searchProjects(projects: Project[], currentId: string | null, search: string, locale: string): Project[] {
  const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase(locale);
  const terms = normalize(search).trim().split(/\s+/).filter(Boolean);
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  return projects.filter(project => {
    const text = normalize(`${project.name}\n${project.description ?? ""}`);
    return terms.every(term => text.includes(term));
  }).sort((left, right) => Number(right.id === currentId) - Number(left.id === currentId)
    || (Date.parse(right.updated_at) || 0) - (Date.parse(left.updated_at) || 0)
    || collator.compare(left.name, right.name) || collator.compare(left.id, right.id));
}
