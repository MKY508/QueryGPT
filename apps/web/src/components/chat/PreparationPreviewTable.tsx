"use client";

import { workbookColumnName } from "@/lib/workbook";
import { Button } from "@/components/ui/button";

interface Props {
  preview: { rows: (string | null)[][]; start_row: number; nonempty_rows: number[] };
  headerRow?: number;
  busy: boolean;
  label: string;
  rowLabel: string;
  emptyLabel: string;
  headerLabel: (row: number) => string;
  onSelectHeader: (row: number) => void;
}

export function PreparationPreviewTable({ preview, headerRow, busy, label, rowLabel, emptyLabel, headerLabel, onSelectHeader }: Props) {
  const width = Math.max(0, ...preview.rows.map((row) => row.length));
  return <div tabIndex={0} role="region" aria-label={label} className="min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40">
    {width ? <table className="min-w-full border-collapse text-xs" aria-label={label}>
      <thead className="sticky top-0 bg-muted"><tr><th className="border-b border-r border-border p-2" aria-label={rowLabel} />{Array.from({ length: width }, (_, index) => <th key={index} className="min-w-28 border-b border-r border-border p-2 text-left font-medium">{workbookColumnName(index)}</th>)}</tr></thead>
      <tbody>{preview.rows.map((row, index) => {
        const number = preview.start_row + index;
        const selected = headerRow === number;
        return <tr key={number} className={selected ? "bg-primary/10 font-medium" : headerRow && number < headerRow ? "text-muted-foreground" : ""}>
          <th className="border-b border-r border-border p-2 text-right font-normal">
            <Button variant="ghost" size="sm" aria-label={headerLabel(number)} aria-pressed={selected} disabled={busy || number > 1_000_000 || !preview.nonempty_rows.includes(number)} onClick={() => onSelectHeader(number)} className="text-primary">{number}</Button>
          </th>
          {Array.from({ length: width }, (_, column) => <td key={column} className="max-w-80 break-words whitespace-pre-wrap border-b border-r border-border px-3 py-2">{row[column] ?? ""}</td>)}
        </tr>;
      })}</tbody>
    </table> : <p className="p-5 text-xs text-muted-foreground">{emptyLabel}</p>}
  </div>;
}
