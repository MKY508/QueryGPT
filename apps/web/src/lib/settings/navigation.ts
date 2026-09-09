export const SETTINGS_CATALOG = [
  { id: "models", label: "analysisService", description: "analysisServiceDesc", panel: "models" },
  { id: "connections", label: "dataConnections", description: "dataConnectionsDesc", panel: "connections" },
  { id: "execution", label: "execution", description: "executionDesc", panel: "preferences", preference: "execution" },
  { id: "appearance", label: "appearance", description: "appearanceDesc", panel: "preferences", preference: "appearance" },
  { id: "advanced", label: "diagnostics", description: "diagnosticsDesc", panel: "preferences", preference: "diagnostics" },
] as const;
export type SettingsDestination = typeof SETTINGS_CATALOG[number];
export type SettingsSection = SettingsDestination["id"];
export type SettingsPanel = SettingsDestination["panel"];
export type SettingsPreference = Extract<SettingsDestination, { panel: "preferences" }>["preference"];

export function getSettingsDestination(value: string | null): SettingsDestination {
  return SETTINGS_CATALOG.find(item => item.id === value) ?? SETTINGS_CATALOG[0];
}

export function resolveSettingsSection(value: string | null): SettingsSection {
  return getSettingsDestination(value).id;
}

export function settingsSectionHref(section: SettingsSection, search: string): string {
  const params = new URLSearchParams(search);
  params.set("tab", section);
  return `/settings?${params.toString()}`;
}

export function matchesSettingsSection(query: string, label: string, description: string): boolean {
  const normalize = (value: string) => value.normalize("NFKC").toLowerCase();
  const text = normalize(`${label} ${description}`);
  return normalize(query).trim().split(/\s+/u).every(term => text.includes(term));
}
