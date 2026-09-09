import { afterEach, describe, expect, it, vi } from "vitest";
import { checkForUpdate, parseRelease } from "@/lib/releases";

const release = (tag_name: string) => ({ tag_name, draft: false, prerelease: false });

afterEach(() => vi.unstubAllGlobals());

describe("release updates", () => {
  it("compares versions numerically and understands both release tag formats", () => {
    expect(parseRelease(release("desktop-v1.10.0"), "1.9.0").available).toBe(true);
    expect(parseRelease(release("v1.0.0"), "1.0.0").available).toBe(false);
    expect(parseRelease(release("v1.0.0"), "1.1.0").available).toBe(false);
  });

  it("rejects malformed or preview releases and uses only this project's release links", () => {
    for (const payload of [null, release("vNext"), release("v2.0.0-beta.1"), { ...release("v2.0.0"), draft: true }]) {
      expect(() => parseRelease(payload, "1.0.0")).toThrow();
    }
    expect(parseRelease({ ...release("v2.0.0"), html_url: "https://example.com" }, "1.0.0").url)
      .toBe("https://github.com/MoonMao42/ReceiptBI/releases/tag/v2.0.0");
  });

  it("reports a failed release check instead of claiming the app is up to date", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    await expect(checkForUpdate("1.0.0")).rejects.toThrow("403");
  });
});
