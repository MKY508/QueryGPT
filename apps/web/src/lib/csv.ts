import Papa from "papaparse";
import { dataCellText, dataCellValue, dataColumns, type TabularRow } from "./tabular-data";
export { dataColumns } from "./tabular-data";

// Papa supports a custom formula matcher. Literal decimal refunds need their
// exact spelling, while expressions/links (including after spaces) stay text.
const FORMULA_TEXT = /^\s*[\t\r\n=+@＝＋－＠]|^\s*-(?!(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$)/;

export function createCsv(rows: readonly TabularRow[], columns = dataColumns(rows)): string {
  return "\uFEFF" + Papa.unparse(
    { fields: columns, data: rows.map((row) => columns.map((column) => dataCellText(dataCellValue(row, column)))) },
    { newline: "\r\n", escapeFormulae: FORMULA_TEXT },
  );
}

/** Clipboard tables share CSV's literal/formula policy, without a file BOM. */
export function createTsv(rows: readonly TabularRow[], columns = dataColumns(rows)): string {
  return Papa.unparse(
    { fields: columns, data: rows.map((row) => columns.map((column) => dataCellText(dataCellValue(row, column)))) },
    { delimiter: "\t", newline: "\r\n", escapeFormulae: FORMULA_TEXT },
  );
}

export function downloadCsv(rows: readonly TabularRow[], filename: string, columns?: string[]): void {
  const blob = new Blob([createCsv(rows, columns)], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  try {
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    // Release on failures too; allow successful clicks time to read the Blob.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
