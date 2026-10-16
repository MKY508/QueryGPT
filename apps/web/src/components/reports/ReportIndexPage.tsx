"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  BarChart3,
  BookOpenText,
  CircleAlert,
  ChevronLeft,
  ChevronRight,
  FilePlus2,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { ReportSerializationCopy } from "@/lib/reports";
import { useProjectConversationId } from "@/lib/hooks/useProjectConversationId";
import { useArmedAction } from "@/lib/hooks/useArmedAction";
import { useReportIndexResource } from "./useReportIndexResource";
import { ReportLibraryControls } from "./ReportLibraryControls";
import { ReportDirectoryList } from "./ReportDirectoryList";
import { Button } from "@/components/ui/button";
import { ReportTrashDialog } from "./ReportTrashDialog";
import { ReportCopyDialog } from "./ReportCopyDialog";
import { ReportCopyRecoveryNotice } from "./ReportCopyRecoveryNotice";
import type { PendingReportCopy } from "@/lib/report-copy-journal";
import { readReportLibraryView, writeReportLibraryView, type ReportLibraryView } from "@/lib/report-library";

function reportContextQuery(
  fromRun: string,
  fromConversation: string | null,
  view: ReportLibraryView
): string {
  const params = new URLSearchParams();
  if (fromRun) params.set("fromRun", fromRun);
  if (fromConversation) params.set("fromConversation", fromConversation);
  writeReportLibraryView(params, view);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function ReportIndexPage({ projectId }: { projectId: string }) {
  return <ReportIndexSession key={projectId} projectId={projectId} />;
}

function ReportIndexSession({ projectId }: { projectId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("reportIndex");
  const tBlocks = useTranslations("reportBlocks");
  const [trashOpen, setTrashOpen] = useState(false);
  const [copyTarget, setCopyTarget] = useState<{ id: string; title: string; version: number; pending?: PendingReportCopy } | null>(null);
  const fromRun = searchParams.get("fromRun")?.trim() || "";
  const sourceConversationId = useProjectConversationId(projectId, searchParams.get("fromConversation"));
  const { search, sort, status, page } = readReportLibraryView(searchParams);
  const { library, hasList, loading, loadFailed, refreshing, creating, deletingId,
    busy, writeDisabled, mutationError, refresh, create, remove } = useReportIndexResource(projectId, { search, sort, status, page });
  const { armedId: armedDeleteId, request: requestDelete, disarm } = useArmedAction();
  const view = { search, sort, status, page: hasList ? library.page : page };
  const changeView = (next: ReportLibraryView) => {
    disarm();
    const params = new URLSearchParams(window.location.search);
    writeReportLibraryView(params, next);
    const query = params.toString();
    const href = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    if (href !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.pushState(null, "", href);
    }
  };
  const unavailable = loadFailed && (!hasList || (library.count > 0 && library.items.length === 0));
  const bannerError = mutationError ? t(mutationError) : hasList && loadFailed && !unavailable ? t("refreshError") : null;
  const serializationCopy = useMemo<ReportSerializationCopy>(
    () => ({
      unnamedBlock: tBlocks("unnamedBlock"),
      textBlock: tBlocks("labelText"),
      unnamedPage: tBlocks("unnamedPage"),
      unnamedReport: tBlocks("unnamedReport"),
    }),
    [tBlocks]
  );
  const contextQuery = reportContextQuery(fromRun, sourceConversationId, view);
  const projectHref = sourceConversationId
    ? `/?conversation=${encodeURIComponent(sourceConversationId)}`
    : "/";

  const handleRefresh = () => { disarm(); void refresh(); };
  const handleCreate = () => {
    if (writeDisabled) return;
    disarm();
    create(
      {
        title: t("newReportTitle"),
        pages: [
          {
            id: `local-page-${Date.now()}`,
            title: t("overviewPage"),
            order_index: 0,
            config: {},
            blocks: [],
          },
        ],
      },
      serializationCopy,
      (report) => {
        router.push(`/projects/${projectId}/reports/${report.id}${contextQuery}`);
      }
    );
  };

  return (
    <main className="min-h-screen min-w-[1180px] bg-background text-foreground">
      <header className="h-[60px] border-b border-border bg-card">
        <div className="mx-auto flex h-full max-w-[1440px] items-center justify-between gap-5 px-8">
          <div className="flex min-w-0 items-center gap-4">
            <Link
              href={projectHref}
              aria-label={t("backToProject")}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft size={17} />
            </Link>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold tracking-[-0.02em]">{t("title")}</h1>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{t("subtitle")}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="md" type="button" disabled={busy} onClick={() => { disarm(); setTrashOpen(true); }}
              className="inline-flex h-9 items-center gap-2 px-3 text-xs text-muted-foreground hover:text-foreground">
              <Trash2 size={15} />{t("trash")}
            </Button>
            <Button variant="ghost" size="md" type="button" onClick={handleRefresh} disabled={refreshing || busy}
              aria-label={t("refreshList")} title={t("refreshList")}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground">
              <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
            </Button>
            <Link
              href={`/projects/${projectId}/understanding`}
              className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <BookOpenText size={15} />
              {t("projectUnderstanding")}
            </Link>
            <Button variant="primary" size="md"
              type="button"
              onClick={handleCreate}
              disabled={writeDisabled}
              className="inline-flex h-9 items-center gap-2 px-4 text-xs transition-opacity hover:opacity-90"
            >
              {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
              {t("newReport")}
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1440px] px-8 py-8">
        {fromRun && (
          <div className="mb-6 flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/[0.045] px-4 py-3 text-xs text-foreground">
            <FilePlus2 size={15} className="shrink-0 text-primary" />
            <span>{t("selectReportHint")}</span>
          </div>
        )}
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-primary">
              <BarChart3 size={15} />
              {t("workspaceLabel")}
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">
              {t("workspaceTitle")}
            </h2>
          </div>
          {!loading && library.total > 0 && (
            <span role="status" className="text-xs tabular-nums text-muted-foreground">{library.count === library.total
              ? t("reportCount", { count: library.total }) : t("filteredCount", { count: library.count, total: library.total })}</span>
          )}
        </div>

        <ReportLibraryControls view={view} onChange={changeView} />
        <ReportCopyRecoveryNotice projectId={projectId} disabled={busy || !!copyTarget || trashOpen}
          onResume={(pending) => { disarm(); setCopyTarget({ id: pending.sourceReportId, title: pending.sourceTitle, version: pending.request.expected_version, pending }); }} />

        {bannerError && (
          <div role="alert" className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <span>{bannerError}</span>
            <Button variant="ghost" size="md" type="button" onClick={handleRefresh} disabled={refreshing || busy} className="inline-flex shrink-0 items-center gap-1.5 font-medium">
              <RefreshCw size={13} />
              {t("refreshList")}
            </Button>
          </div>
        )}

        {loading ? (
          <div className="flex min-h-72 items-center justify-center text-sm text-muted-foreground">
            <Loader2 size={18} className="mr-2 animate-spin" />
            {t("loading")}
          </div>
        ) : unavailable ? (
          <section
            role="alert"
            className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-destructive/25 bg-card px-6 text-center"
          >
            <CircleAlert size={28} strokeWidth={1.5} className="text-destructive" />
            <h3 className="mt-5 text-lg font-semibold">{t("unavailableTitle")}</h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{t("loadError")}</p>
            <Button variant="outline" size="md"
              type="button"
              onClick={handleRefresh}
              disabled={refreshing || busy}
              className="mt-6 inline-flex h-10 items-center gap-2 border border-border px-5 text-sm text-foreground transition-colors"
            >
              <RefreshCw size={14} />
              {t("retry")}
            </Button>
          </section>
        ) : library.total === 0 && !search && status === "all" ? (
          <section className="flex min-h-[420px] flex-col items-center justify-center rounded-xl border border-border bg-card px-6 text-center">
            <FilePlus2 size={28} strokeWidth={1.5} className="text-primary" />
            <h3 className="mt-5 text-lg font-semibold">{t("emptyTitle")}</h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              {t("emptyDescription")}
            </p>
            <Button variant="primary" size="md"
              type="button"
              onClick={handleCreate}
              disabled={writeDisabled}
              className="mt-6 inline-flex h-10 items-center gap-2 px-5 text-sm"
            >
              {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
              {t("newReport")}
            </Button>
          </section>
        ) : library.count === 0 ? (
          <section className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-border bg-card px-6 text-center">
            <Search size={26} className="text-muted-foreground" />
            <h3 className="mt-4 text-lg font-semibold">{t("noMatchesTitle")}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{t("noMatchesDescription")}</p>
            <Button variant="outline" size="md" type="button" onClick={() => changeView({ ...view, search: "", status: "all", page: 1 })}
              className="mt-5 border border-border px-4 py-2 text-sm">{t("clearFilters")}</Button>
          </section>
        ) : (
          <ReportDirectoryList reports={library.items} href={report => `/projects/${projectId}/reports/${report.id}${contextQuery}`}
            writeDisabled={writeDisabled} armedDeleteId={armedDeleteId} deletingId={deletingId}
            onCopy={report => { if (!writeDisabled) { disarm(); setCopyTarget({ id: report.id, title: report.title, version: report.version }); } }}
            onDelete={report => { if (!writeDisabled) requestDelete(report.id, () => remove(report.id, report.version)); }} />
        )}
        {!loading && !unavailable && library.page_count > 1 && <nav aria-label={t("pagination")} className="mt-6 flex items-center justify-center gap-4">
          <Button variant="outline" size="md" type="button" aria-label={t("previousPage")} disabled={library.page === 1}
            onClick={() => changeView({ ...view, page: library.page - 1 })}
            className="inline-flex h-9 w-9 items-center justify-center border border-border"><ChevronLeft size={16} /></Button>
          <span aria-live="polite" className="text-xs tabular-nums text-muted-foreground">{t("pageNumber", { page: library.page, total: library.page_count })}</span>
          <Button variant="outline" size="md" type="button" aria-label={t("nextPage")} disabled={library.page === library.page_count}
            onClick={() => changeView({ ...view, page: library.page + 1 })}
            className="inline-flex h-9 w-9 items-center justify-center border border-border"><ChevronRight size={16} /></Button>
        </nav>}
      </div>
      {trashOpen && <ReportTrashDialog projectId={projectId} copy={serializationCopy}
        onChanged={handleRefresh} onClose={() => { setTrashOpen(false); handleRefresh(); }} />}
      {copyTarget && <ReportCopyDialog key={copyTarget.id} projectId={projectId} reportId={copyTarget.id} title={copyTarget.title} version={copyTarget.version} pending={copyTarget.pending}
        onClose={() => { setCopyTarget(null); handleRefresh(); }}
        onReload={() => { setCopyTarget(null); handleRefresh(); }}
        onCreated={(id) => { setCopyTarget(null); handleRefresh(); router.push(`/projects/${projectId}/reports/${id}${contextQuery}`); }} />}
    </main>
  );
}
