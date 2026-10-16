import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canCopyReportImage, copyReportImage, reportImageFilename, reportImageSize, waitForReportAssets,
} from "@/lib/report-image";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("report export assets", () => {
  function nodeWith(images: object[]) {
    return { isConnected: true, querySelectorAll: () => images } as unknown as HTMLElement;
  }

  it("makes lazy images eager and rejects an unavailable chart", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 0; });
    const image = { loading: "lazy", complete: true, naturalWidth: 0, decode: vi.fn().mockResolvedValue(undefined) };
    await expect(waitForReportAssets(nodeWith([image]))).rejects.toThrow("image_unavailable");
    expect(image.loading).toBe("eager");
    expect(image.decode).toHaveBeenCalledOnce();
    image.naturalWidth = 100;
    await expect(waitForReportAssets(nodeWith([image]))).resolves.toBeUndefined();
  });

  it.each(["fonts", "images"])("bounds a stalled %s wait", async (stage) => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 0; });
    const stalled = new Promise<void>(() => undefined);
    vi.stubGlobal("document", { fonts: { ready: stage === "fonts" ? stalled : Promise.resolve() } });
    const images = stage === "images" ? [{ decode: () => stalled }] : [];
    const result = expect(waitForReportAssets(nodeWith(images))).rejects.toThrow("image_unavailable");
    await vi.advanceTimersByTimeAsync(15_000);
    await result;
  });
});

describe("report image export", () => {
  it("keeps short pages crisp and large pages within the canvas budget", () => {
    expect(reportImageSize(1120, 720)).toEqual({ width: 1120, height: 720, pixelRatio: 2 });
    const large = reportImageSize(1120, 7000);
    expect(large.pixelRatio).toBeGreaterThanOrEqual(1);
    expect(large.width * large.height * large.pixelRatio ** 2).toBeLessThanOrEqual(16_000_001);
    expect(() => reportImageSize(1120, 20_000)).toThrow("too_large");
    expect(() => reportImageSize(0, 720)).toThrow("image_unavailable");
  });

  it("uses both report and page names without illegal filename characters", () => {
    expect(reportImageFilename(" 销售/复盘 ", " 华东:概览 ", "报告")).toBe("销售-复盘 - 华东-概览.png");
    expect(reportImageFilename("", "", "报告")).toBe("报告.png");
  });

  it("requests clipboard writing before the image promise settles", async () => {
    let finish!: (blob: Blob) => void;
    const pending = new Promise<Blob>((resolve) => { finish = resolve; });
    const write = vi.fn().mockResolvedValue(undefined);
    const item = vi.fn(function (this: { items: unknown }, items) { this.items = items; });
    vi.stubGlobal("navigator", { clipboard: { write } });
    vi.stubGlobal("ClipboardItem", item);
    const copying = copyReportImage(pending);
    expect(write).toHaveBeenCalledOnce();
    expect(item).toHaveBeenCalledExactlyOnceWith({ "image/png": pending });
    finish(new Blob(["png"], { type: "image/png" }));
    await copying;
  });

  it("reports unsupported clipboard access without an unhandled image rejection", async () => {
    vi.stubGlobal("navigator", {});
    expect(canCopyReportImage()).toBe(false);
    await expect(copyReportImage(Promise.reject(new Error("render failed")))).rejects.toThrow("clipboard_unavailable");
  });
});
