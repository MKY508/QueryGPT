import { api } from "./api/client";

export const CSV_DELIMITERS = [",", ";", "\t", "|"] as const;
export const CSV_ENCODINGS = ["utf-8-sig", "gb18030"] as const;
export type CsvDelimiter = typeof CSV_DELIMITERS[number];
export type CsvEncoding = typeof CSV_ENCODINGS[number];
export interface CsvSelection {
  kind: "csv";
  delimiter: CsvDelimiter;
  encoding: CsvEncoding;
  header_row?: number;
  headerless?: boolean;
  input_fingerprint: string;
  source_revision: string;
}
export interface CsvPreview {
  source_id: string;
  input_fingerprint: string;
  source_revision: string;
  delimiter: CsvDelimiter;
  encoding: CsvEncoding;
  start_row: number;
  rows: (string | null)[][];
  nonempty_rows: number[];
  has_more_rows: boolean;
  truncated_columns: boolean;
  truncated_cells: boolean;
}

export async function readCsv(projectId: string, sourceId: string, delimiter: CsvDelimiter, encoding: CsvEncoding | null, startRow: number, signal?: AbortSignal): Promise<CsvPreview> {
  if (!CSV_DELIMITERS.includes(delimiter) || (encoding !== null && !CSV_ENCODINGS.includes(encoding))
    || !Number.isInteger(startRow) || startRow < 1 || startRow > 1_000_000) throw new Error("Invalid CSV options");
  const response = await api.get(`/api/v1/projects/${projectId}/sources/${sourceId}/csv`, {
    params: { delimiter, ...(encoding ? { encoding } : {}), start_row: startRow }, signal, timeout: 30000,
  });
  const data = response.data.data as CsvPreview;
  if (!data || data.source_id !== sourceId || data.delimiter !== delimiter || data.start_row !== startRow
    || !CSV_ENCODINGS.includes(data.encoding) || (encoding && data.encoding !== encoding)
    || ![data.input_fingerprint, data.source_revision].every((value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value))
    || !Array.isArray(data.rows) || data.rows.length > 12
    || !data.rows.every((row) => Array.isArray(row) && row.length <= 40 && row.every((cell) => cell === null || typeof cell === "string"))
    || !Array.isArray(data.nonempty_rows) || data.nonempty_rows.length > data.rows.length
    || !data.nonempty_rows.every((row) => Number.isInteger(row) && row >= startRow && row < startRow + data.rows.length)) {
    throw new Error("Invalid CSV preview");
  }
  return data;
}

export function sameCsvInput(selection: CsvSelection, preview: CsvPreview): boolean {
  return selection.delimiter === preview.delimiter && selection.encoding === preview.encoding
    && selection.input_fingerprint === preview.input_fingerprint && selection.source_revision === preview.source_revision;
}
