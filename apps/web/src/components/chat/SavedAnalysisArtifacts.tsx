"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, ExternalLink } from "lucide-react";
import type { AnalysisArtifact } from "@/lib/types/api";
import { artifactToReportBlock, createReportBlocksCopy } from "@/lib/report-blocks";
import { useModalFocus } from "@/lib/use-modal-focus";
import { ReportBlockCard } from "@/components/reports/ReportBlockCard";
import { TaskDialog } from "@/components/ui/TaskDialog";

interface SavedAnalysisArtifactsProps {
  artifacts: AnalysisArtifact[];
  open: boolean;
  onClose: () => void;
}

export function SavedAnalysisArtifacts({ artifacts, open, onClose }: SavedAnalysisArtifactsProps) {
  const first = artifacts[0];
  if (!open || !first) return null;
  return <ArtifactSession key={JSON.stringify([first.project_id, first.analysis_run_id])} artifacts={artifacts} onClose={onClose} />;
}

function ArtifactSession({ artifacts, onClose }: Omit<SavedAnalysisArtifactsProps, "open">) {
  const t = useTranslations("savedArtifacts"), tBlocks = useTranslations("reportBlocks"), locale = useLocale();
  const dialog = useRef<HTMLDialogElement>(null), viewer = useRef<HTMLDivElement>(null);
  const writing = useRef(false), active = useRef(false);
  const blocksCopy = useMemo(() => createReportBlocksCopy((key, values) => tBlocks(key, values)), [tBlocks]);
  const blocks = useMemo(() => artifacts.map(artifact => artifactToReportBlock(artifact, blocksCopy, locale)), [artifacts, blocksCopy, locale]);
  useModalFocus({ active: true, containerRef: dialog, initialFocusRef: viewer, onClose });
  useEffect(() => {
    const node = dialog.current;
    active.current = true;
    if (node && !node.open) node.showModal();
    return () => { active.current = false; if (node?.open) node.close(); };
  }, []);
  const first = artifacts[0];
  return createPortal(<TaskDialog dialogRef={dialog} writingRef={writing} activeRef={active} busy={false} autoFocusClose={false}
    title={t("dialogTitle")} name={t("itemsCount", { count: artifacts.length })} closeLabel={t("closeAria")} onClose={onClose} onEscape={onClose}
    actions={<Link href={`/projects/${first.project_id}/reports?fromRun=${encodeURIComponent(first.analysis_run_id)}`}
      className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      {t("compileToReport")}<ArrowRight size={14} />
    </Link>}>
    <div ref={viewer} tabIndex={0} role="region" aria-label={t("dialogTitle")}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-background p-6 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40">
      <div className="grid grid-cols-2 gap-4">
        {artifacts.map((artifact, index) => <div key={artifact.id} className={`min-h-0 min-w-0 ${artifact.kind === "metric" ? "col-span-1" : "col-span-2"}`}>
          <ReportBlockCard block={blocks[index]} editing={false} selected={false} onSelect={() => undefined} onMove={() => undefined}
            onResize={() => undefined} onDuplicate={() => undefined} onDelete={() => undefined} />
          {artifact.kind === "file" && typeof artifact.payload.relative_path === "string" && <a
            href={`/api/v1/projects/${artifact.project_id}/analysis-runs/${artifact.analysis_run_id}/artifacts/${artifact.id}/file`}
            target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            {t("openFile")}<ExternalLink size={12} />
          </a>}
        </div>)}
      </div>
    </div>
  </TaskDialog>, document.body);
}
