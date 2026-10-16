export type ReportImageErrorCode = "too_large" | "image_unavailable" | "clipboard_unavailable";

export class ReportImageError extends Error {
  constructor(readonly code: ReportImageErrorCode) {
    super(code);
    this.name = "ReportImageError";
  }
}

const MAX_PIXELS = 16_000_000;
const MAX_DIMENSION = 16_384;

export function reportImageSize(width: number, height: number) {
  width = Math.ceil(width);
  height = Math.ceil(height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new ReportImageError("image_unavailable");
  }
  const pixelRatio = Math.min(2, Math.sqrt(MAX_PIXELS / (width * height)), MAX_DIMENSION / width, MAX_DIMENSION / height);
  if (pixelRatio < 1) throw new ReportImageError("too_large");
  return { width, height, pixelRatio };
}

function withTimeout<T>(promise: Promise<T>, milliseconds = 15_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new ReportImageError("image_unavailable")), milliseconds);
    promise.then(resolve, reject).finally(() => window.clearTimeout(timer));
  });
}

// Both PDF and PNG must wait for the same fonts/images, with bounded waits.
// A broken chart is an export error, not a successful document with missing data.
export async function waitForReportAssets(node: HTMLElement): Promise<void> {
  await withTimeout(Promise.resolve(document.fonts?.ready));
  await withTimeout(new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  if (!node.isConnected) throw new ReportImageError("image_unavailable");
  const images = Array.from(node.querySelectorAll("img"));
  await withTimeout(Promise.all(images.map(async (image) => {
    image.loading = "eager";
    // Export must fail visibly instead of silently omitting an unavailable chart.
    if (typeof image.decode === "function") await image.decode();
    if (!image.complete || !image.naturalWidth) throw new ReportImageError("image_unavailable");
  })));
  if (!node.isConnected) throw new ReportImageError("image_unavailable");
}

export async function renderReportImage(node: HTMLElement): Promise<Blob> {
  // Load only when requested; ordinary report reading does not pay for capture.
  const { toBlob } = await withTimeout(import("html-to-image"));
  await waitForReportAssets(node);
  if (node.querySelectorAll("*").length > 20_000) throw new ReportImageError("too_large");
  const size = reportImageSize(node.scrollWidth, node.scrollHeight);
  const blob = await withTimeout(toBlob(node, {
    ...size,
    backgroundColor: "#fafaf9",
    preferredFontFormat: "woff2",
    includeQueryParams: true,
    style: { position: "static", left: "auto", top: "auto", visibility: "visible", margin: "0" },
  }));
  if (!node.isConnected || !blob || !blob.size) throw new ReportImageError("image_unavailable");
  return blob;
}

export function canCopyReportImage(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.clipboard?.write === "function"
    && typeof ClipboardItem !== "undefined"
    && (typeof ClipboardItem.supports !== "function" || ClipboardItem.supports("image/png"));
}

export function copyReportImage(image: Promise<Blob>): Promise<void> {
  // Passing the promise preserves the click's user activation while rendering
  // (including Safari), instead of requesting clipboard access after an await.
  void image.catch(() => undefined);
  if (!canCopyReportImage()) return Promise.reject(new ReportImageError("clipboard_unavailable"));
  return navigator.clipboard.write([new ClipboardItem({ "image/png": image })]);
}

export function reportImageFilename(title: string, page: string, fallback: string): string {
  const name = [title.trim(), page.trim()].filter(Boolean).join(" - ") || fallback;
  return `${name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").slice(0, 180).replace(/[. ]+$/, "") || fallback}.png`;
}
