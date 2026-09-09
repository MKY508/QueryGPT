"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Copy } from "lucide-react";
import { createTsv } from "@/lib/csv";
import type { TabularRow } from "@/lib/tabular-data";
import { useDataClipboard } from "./useDataClipboard";

export function DataSelectionCopy({ rows, columns }: { rows: readonly TabularRow[]; columns: string[] }) {
  const t = useTranslations("dataView");
  const generation = useRef(0);
  const { copying, write } = useDataClipboard();
  const [feedback, setFeedback] = useState<{ rows: readonly TabularRow[]; columns: string[]; failed: boolean } | null>(null);
  useEffect(() => () => { generation.current += 1; }, []);
  const copy = async () => {
    if (copying || !rows.length || !columns.length) return;
    const request = generation.current;
    setFeedback(null);
    try {
      const written = await write(() => createTsv(rows, columns));
      if (written && request === generation.current) setFeedback({ rows, columns, failed: false });
    } catch {
      if (request === generation.current) setFeedback({ rows, columns, failed: true });
    }
  };
  const current = feedback?.rows === rows && feedback.columns === columns ? feedback : null;
  return <>
    <button type="button" disabled={!rows.length || !columns.length || copying} aria-busy={copying}
      onClick={() => void copy()} className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-primary/10 disabled:opacity-40">
      <Copy size={13} />{t("selection.copy", { count: rows.length })}
    </button>
    {current && <span role={current.failed ? "alert" : "status"} className={`px-2 text-xs ${current.failed ? "text-destructive" : "text-muted-foreground"}`}>
      {t(current.failed ? "copyError" : "copied")}
    </span>}
  </>;
}
