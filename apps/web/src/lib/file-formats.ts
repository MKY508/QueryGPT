/** Keep the picker and upload queue on one admission list. */
export const FILE_UPLOAD_EXTENSIONS = [
  ".csv",
  ".xls",
  ".xlsx",
  ".parquet",
  ".json",
  ".jsonl",
  ".ndjson",
] as const;

export const FILE_UPLOAD_ACCEPT = FILE_UPLOAD_EXTENSIONS.join(",");
const extensions: ReadonlySet<string> = new Set(FILE_UPLOAD_EXTENSIONS);

export function isSupportedUploadFile(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot >= 0 && extensions.has(name.slice(dot).toLowerCase());
}
