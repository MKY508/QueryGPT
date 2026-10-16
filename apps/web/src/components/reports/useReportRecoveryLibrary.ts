"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { listReportRecoveryDrafts, type ReportRecoveryCursor, type ReportRecoveryPage } from "@/lib/report-recovery";

const empty: ReportRecoveryPage = { items: [], total: 0, next: null };

export function useReportRecoveryLibrary(projectId: string, reportId: string, excludeId: string) {
  const [page, setPage] = useState(empty);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const active = useRef(false);
  const request = useRef(0);
  const inFlight = useRef(false);
  const cursor = useRef<ReportRecoveryCursor | null>(null);

  useLayoutEffect(() => {
    active.current = true;
    return () => { active.current = false; request.current += 1; };
  }, []);

  const read = useCallback(async (append: boolean) => {
    if (!active.current || (append && (inFlight.current || !cursor.current))) return;
    const current = ++request.current;
    const isCurrent = () => active.current && request.current === current;
    inFlight.current = true;
    setLoading(true);
    try {
      const next = await listReportRecoveryDrafts(projectId, reportId, { excludeId, before: append ? cursor.current : null });
      if (!isCurrent()) return;
      cursor.current = next.next;
      setPage((previous) => ({ ...next, items: append
        ? [...new Map([...previous.items, ...next.items].map((item) => [item.id, item])).values()]
        : next.items }));
      setFailed(false);
    } catch { if (isCurrent()) setFailed(true); }
    finally {
      if (isCurrent()) { inFlight.current = false; setLoading(false); }
    }
  }, [projectId, reportId, excludeId]);

  const reload = useCallback(() => read(false), [read]);
  const loadMore = useCallback(() => read(true), [read]);
  return { ...page, failed, loading, reload, loadMore };
}
