"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { PreparationDialog } from "@/components/chat/PreparationDialog";

/** Dismissal closes the reader, not the project-owned transfers. */
export function UploadActivityWindow({ projectName, onClose, children }: {
  projectName: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useTranslations("dataWorkspace.uploadQueue");
  const dialog = useRef<HTMLDialogElement>(null);
  const writing = useRef(false);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <PreparationDialog dialogRef={dialog} writingRef={writing} busy={false}
    title={t("title")} name={projectName} closeLabel={t("close")} onClose={onClose}>
    <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
  </PreparationDialog>;
}
