import { gt, prerelease, valid } from "semver";

export const RELEASES_URL = "https://github.com/MoonMao42/ReceiptBI/releases/latest";
const LATEST_RELEASE_API = "https://api.github.com/repos/MoonMao42/ReceiptBI/releases/latest";

export interface ReleaseUpdate {
  version: string;
  available: boolean;
  url: string;
}

export function parseRelease(payload: unknown, currentVersion: string): ReleaseUpdate {
  if (!payload || typeof payload !== "object") throw new Error("Invalid release");
  const release = payload as Record<string, unknown>;
  const tag = typeof release.tag_name === "string" ? release.tag_name : "";
  const version = valid(tag.replace(/^desktop-v|^v/, ""));
  if (!version || !valid(currentVersion) || release.draft !== false ||
      release.prerelease !== false || prerelease(version)) {
    throw new Error("Invalid stable release");
  }
  return {
    version,
    available: gt(version, currentVersion),
    // Only open this project's release page, regardless of remote URL fields.
    url: `https://github.com/MoonMao42/ReceiptBI/releases/tag/${encodeURIComponent(tag)}`,
  };
}

export async function checkForUpdate(currentVersion: string, signal?: AbortSignal): Promise<ReleaseUpdate> {
  const timeout = AbortSignal.timeout(10_000);
  const response = await fetch(LATEST_RELEASE_API, {
    headers: { Accept: "application/vnd.github+json" },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    credentials: "omit",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Release check failed: ${response.status}`);
  return parseRelease(await response.json(), currentVersion);
}
