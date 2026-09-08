"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, ExternalLink, X } from "lucide-react";
import type { AnalysisArtifact } from "@/lib/types/api";
import {
  artifactToReportBlock,
  createReportBlocksCopy,
} from "@/lib/report-blocks";
import { ReportBlockCard } from "@/components/reports/ReportBlockCard";

interface SavedAnalysisArtifactsProps {
  artifacts: AnalysisArtifact[];
  open: boolean;
  onClose: () => void;
}

function artifactSpan(artifact: AnalysisArtifact): string {
  return artifact.kind === "metric" ? "md:col-span-1" : "md:col-span-2";
}

function artifactFileUrl(artifact: AnalysisArtifact): string | null {
  if (typeof artifact.payload.relative_path !== "string") return null;
  return `/api/v1/projects/${artifact.project_id}/analysis-runs/${artifact.analysis_run_id}/artifacts/${artifact.id}/file`;
}

export function SavedAnalysisArtifacts({
  artifacts,
  open,
  onClose,
}: SavedAnalysisArtifactsProps) {
  const t = useTranslations("savedArtifacts");
  const tBlocks = useTranslations("reportBlocks");
  const locale = useLocale();
  const blocksCopy = useMemo(
    () => createReportBlocksCopy((key, values) => tBlocks(key, values)),
    [tBlocks]
  );
  const blocks = useMemo(
    () =>
      artifacts.map((artifact) => artifactToReportBlock(artifact, blocksCopy, locale)),
    [artifacts, blocksCopy, locale],
  );
  const first = artifacts[0];

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open || !first) return null;

  return (
    <div
      className="fixed inset-0 z-[80] bg-slate-950/25"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="saved-analysis-title"
        className="ml-auto flex h-full w-full max-w-[1120px] flex-col bg-background shadow-2xl"
      >
        <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border px-5 md:px-8">
          <div className="min-w-0">
            <h2
              id="saved-analysis-title"
              className="truncate text-sm font-semibold text-foreground"
            >
              {t("dialogTitle")}
            </h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {t("itemsCount", { count: artifacts.length })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/projects/${first.project_id}/reports?fromRun=${encodeURIComponent(first.analysis_run_id)}`}
              className="inline-flex h-9 items-center gap-2 bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
            >
              {t("compileToReport")}
              <ArrowRight size={14} />
            </Link>
            <button
              type="button"
              aria-label={t("closeAria")}
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X size={17} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-8 md:py-8">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {artifacts.map((artifact, artifactIndex) => {
              const fileUrl = artifactFileUrl(artifact);
              return (
                <div
                  key={artifact.id}
                  className={`min-h-0 ${artifactSpan(artifact)}`}
                >
                  <ReportBlockCard
                    block={blocks[artifactIndex]}
                    editing={false}
                    selected={false}
                    onSelect={() => undefined}
                    onMove={() => undefined}
                    onResize={() => undefined}
                    onDuplicate={() => undefined}
                    onDelete={() => undefined}
                  />
                  {fileUrl && artifact.kind === "file" && (
                    <a
                      href={fileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                    >
                      {t("openFile")}
                      <ExternalLink size={12} />
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </aside>
    </div>
  );
}
