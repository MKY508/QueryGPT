import { describe, expect, it } from "vitest";
import { readReportLibraryView, writeReportLibraryView } from "@/lib/report-library";
const defaults = readReportLibraryView(new URLSearchParams());

describe("report library URL controls", () => {
  it("bounds URL state and carries only valid library controls into a fresh return query", () => {
    const invalid = readReportLibraryView(new URLSearchParams({ q: "x".repeat(500), sort: "unsafe", status: "deleted", page: "1e20", returnTo: "https://example.invalid" }));
    expect(invalid).toEqual({ search: "x".repeat(200), sort: "updated", status: "all", page: 1 });
    const view = readReportLibraryView(new URLSearchParams("q=%E5%8D%8E%E4%B8%9C+100%25&sort=title&status=draft&page=2"));
    const target = new URLSearchParams("fromConversation=conversation-1");
    writeReportLibraryView(target, view);
    expect(readReportLibraryView(target)).toEqual(view);
    expect(target.get("fromConversation")).toBe("conversation-1");
    expect(target.has("returnTo")).toBe(false);
    writeReportLibraryView(target, defaults);
    expect(target.toString()).toBe("fromConversation=conversation-1");
  });
});
