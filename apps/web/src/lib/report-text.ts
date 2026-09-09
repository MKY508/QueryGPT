import type { ReportBlock } from "./reports";

export function isReportTextBlock(block: ReportBlock): boolean {
  return block.block_type === "text" || block.block_type === "evidence";
}

/** Read editable text without altering punctuation, spacing, or legacy content. */
export function reportBlockText(block: ReportBlock): string {
  const keys = block.block_type === "metric" ? ["value"] : ["text", "summary", "description", "value"];
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(block.content, key)) continue;
    const value = block.content[key];
    if (typeof value === "string" || typeof value === "number") return String(value);
  }
  return "";
}
