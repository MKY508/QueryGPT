"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { runtimeMessage } from "@/i18n/runtime";
import { FILE_UPLOAD_ACCEPT } from "@/lib/file-formats";
import type { UploadSnapshot } from "@/lib/upload-state";
import styles from "./UploadQueueView.module.css";

export interface UploadQueueActions {
  resumeUploads: () => void | Promise<void>;
  pauseUploads: () => void;
  retryUpload: (id: string) => void | Promise<void>;
  checkUpload: (id: string) => void | Promise<void>;
  reselectUpload: (id: string, file: File) => void | Promise<void>;
  cancelQueuedUpload: (id: string) => void;
  cancelQueuedUploads: () => void;
  clearUploads: () => void;
}

function ReselectFile({ onReselect, id, name, busy, paused }: { onReselect: UploadQueueActions["reselectUpload"]; id: string; name: string; busy: boolean; paused: boolean }) {
  const t = useTranslations("dataWorkspace.uploadQueue");
  const input = useRef<HTMLInputElement>(null);
  return <>
    <input ref={input} type="file" accept={FILE_UPLOAD_ACCEPT} className="hidden" aria-label={t(paused ? "reselectPausedFile" : "reselectFile", { name })}
      onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (file) void onReselect(id, file);
      }} />
    <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={() => input.current?.click()} aria-label={t(paused ? "reselectPausedFile" : "reselectFile", { name })}
      className="mt-1 text-primary h-auto min-h-7 whitespace-normal">{t(paused ? "reselectPaused" : "reselect")}</Button>
  </>;
}

/** Presentation only: queue ownership and I/O belong to the caller. */
export function UploadQueueView({ queue, actions, label }: { queue: UploadSnapshot; actions: UploadQueueActions; label?: string }) {
  const t = useTranslations("dataWorkspace.uploadQueue");
  const [clearConfirmation, setClearConfirmation] = useState<string | null>(null);
  const {
    resumeUploads,
    pauseUploads,
    retryUpload,
    checkUpload,
    cancelQueuedUpload,
    cancelQueuedUploads,
    clearUploads,
  } = actions;
  const pending = queue.items.some((item) => item.status === "queued");
  const added = queue.items.filter((item) => item.status === "added").length;
  const uncertainKey = JSON.stringify(queue.items.filter((item) => item.status === "uncertain").map((item) => item.id));
  const uncertain = queue.items.some((item) => item.status === "uncertain");
  if (clearConfirmation && clearConfirmation !== uncertainKey) setClearConfirmation(null);
  if (!queue.items.length && !queue.notice) return null;
  return (
    <section
      aria-label={label ?? t("title")}
      className="my-3 overflow-hidden rounded-xl border border-border bg-card text-xs"
    >
      <div className="flex items-center justify-between gap-4 border-b border-border bg-muted/20 px-4 py-3">
        <p role="status" className="font-medium">
          {queue.items.length
            ? t("summary", { added, total: queue.items.length })
            : t("title")}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {pending && queue.busy && !queue.paused && <Button variant="ghost" size="sm" type="button" onClick={() => pauseUploads()}
            className="text-primary underline-offset-2 h-auto min-h-7 whitespace-normal">{t("pause")}</Button>}
          {pending && (
            <Button variant="ghost" size="sm"
              type="button"
              className="text-muted-foreground hover:text-foreground h-auto min-h-7 whitespace-normal"
              onClick={() => cancelQueuedUploads()}
            >
              {t("cancelAll")}
            </Button>
          )}
          {pending && !queue.busy && (
            <Button variant="ghost" size="sm"
              type="button"
              className="text-primary underline-offset-2 h-auto min-h-7 whitespace-normal"
              onClick={() => void resumeUploads()}
            >
              {t("continue")}
            </Button>
          )}
          {!queue.busy && !pending && (
            <Button variant="ghost" size="sm"
              type="button"
              className="text-muted-foreground hover:text-foreground h-auto min-h-7 whitespace-normal"
              onClick={() => {
                if (uncertain && clearConfirmation !== uncertainKey) setClearConfirmation(uncertainKey);
                else { clearUploads(); setClearConfirmation(null); }
              }}
            >
              {t(uncertain && clearConfirmation === uncertainKey ? "confirmClear" : "clear")}
            </Button>
          )}
        </div>
      </div>
      {pending && queue.paused && <p role="status" className="mx-4 mt-3 leading-5 text-muted-foreground">{t(queue.busy ? "pausePending" : "paused")}</p>}
      {uncertain && clearConfirmation === uncertainKey && <p role="status" className="mx-4 mt-3 leading-5 text-muted-foreground">{t("clearUncertainHint")}</p>}
      {queue.notice && (
        <p role="alert" className="mx-4 my-3 text-destructive">
          {runtimeMessage(queue.notice)}
        </p>
      )}
      <ul tabIndex={0} aria-label={label ?? t("title")} className="max-h-[360px] divide-y divide-border overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40">
        {queue.items.map((item) => (
          <li key={item.id} className="min-w-0 px-4 py-3">
            <div className="grid grid-cols-[minmax(0,1fr)_140px] items-start gap-4">
              <span className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">{item.name}</span>
              <span className={`text-right ${item.status === "added" ? "text-success" : item.status === "failed" || item.status === "uncertain" ? "text-warning" : "text-muted-foreground"}`}>
                {t(item.checking ? "checking" : item.verifying ? "verifying" : item.status)}
              </span>
            </div>
            {(item.status === "preparing" || item.verifying || item.status === "uploading" || item.status === "saving") && (
              <progress
                aria-label={t(item.status === "preparing" || item.verifying ? "readProgress" : "progress", { name: item.name })}
                max={100}
                value={item.progress ?? undefined}
                className={styles.progress}
              />
            )}
            {item.errorKey && (
              <p className="mt-1 leading-5 text-destructive">
                {runtimeMessage(item.errorKey)}
              </p>
            )}
            {item.status === "queued" && (
              <Button variant="ghost" size="sm"
                type="button"
                onClick={() => cancelQueuedUpload(item.id)}
                className="mt-1 text-muted-foreground hover:text-foreground h-auto min-h-7 whitespace-normal"
                aria-label={t("cancelFile", { name: item.name })}
              >
                {t("cancel")}
              </Button>
            )}
            {(item.status === "preparing" || item.verifying) && <Button variant="ghost" size="sm" type="button"
              onClick={() => cancelQueuedUpload(item.id)} aria-label={t("cancelReadFile", { name: item.name })}
              className="mt-1 text-muted-foreground hover:text-foreground h-auto min-h-7 whitespace-normal">{t("cancelRead")}</Button>}
            {item.recovered && item.status === "uncertain" && !item.errorKey && (
              <p className="mt-1 leading-5 text-muted-foreground">{t("recoveredHint")}</p>
            )}
            {item.status === "uncertain" && <Button variant="ghost" size="sm" type="button" disabled={queue.busy}
              onClick={() => void checkUpload(item.id)} aria-label={t("checkFile", { name: item.name })}
              className="mr-3 mt-1 text-primary h-auto min-h-7 whitespace-normal">
              {t(item.checking ? "checking" : "check")}
            </Button>}
            {item.reselectable && item.status === "uncertain" && !item.verifying &&
              <ReselectFile onReselect={actions.reselectUpload} id={item.id} name={item.name} busy={queue.busy} paused={Boolean(queue.paused)} />}
            {item.retryable && !queue.busy && (
              <Button variant="ghost" size="sm"
                type="button"
                onClick={() => void retryUpload(item.id)}
                className="mt-1 text-primary h-auto min-h-7 whitespace-normal"
                aria-label={t("retryFile", { name: item.name })}
              >
                {t(pending ? "retryContinue" : "retry")}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
