import { api } from "./api/client";

export interface WorkbookSelection {
  sheet: string;
  header_row?: number;
  headerless?: boolean;
  input_fingerprint: string;
  source_revision: string;
}

export interface WorkbookPreview {
  source_id: string;
  source_revision: string;
  input_fingerprint: string;
  sheets: { name: string; hidden: boolean | null }[];
  selected_sheet: string | null;
  start_row: number;
  rows: (string | null)[][];
  nonempty_rows: number[];
  has_more_rows: boolean;
  truncated_columns: boolean;
  truncated_cells: boolean;
  missing_formula_results: number;
}

export async function readWorkbook(projectId: string, sourceId: string, sheet: string | null, signal?: AbortSignal, startRow = 1): Promise<WorkbookPreview> {
  if (!Number.isInteger(startRow) || startRow < 1 || startRow > 1_000_000) throw new Error("Invalid preview row");
  const response = await api.get(`/api/v1/projects/${projectId}/sources/${sourceId}/workbook`, {
    params: sheet === null ? undefined : { sheet, ...(startRow === 1 ? {} : { start_row: startRow }) }, signal, timeout: 30000,
  });
  const data = response.data.data as WorkbookPreview;
  if (!data || data.source_id !== sourceId || data.selected_sheet !== sheet
    || data.start_row !== startRow
    || !Array.isArray(data.sheets) || data.sheets.length > 128 || !Array.isArray(data.rows) || data.rows.length > 12
    || ![data.source_revision, data.input_fingerprint].every((value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value))
    || !data.sheets.every((item) => item && typeof item.name === "string")
    || !data.rows.every((row) => Array.isArray(row) && row.length <= 40 && row.every((cell) => cell === null || typeof cell === "string"))
    || !Array.isArray(data.nonempty_rows) || data.nonempty_rows.length > data.rows.length
    || !data.nonempty_rows.every((row) => Number.isInteger(row) && row >= startRow && row < startRow + data.rows.length)) {
    throw new Error("Invalid workbook preview");
  }
  return data;
}

export function workbookColumnName(index: number): string {
  let name = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name;
  return name;
}
