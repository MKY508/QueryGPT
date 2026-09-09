"use client";

import type { RefObject } from "react";
import { useTranslations } from "next-intl";
import { DiscardChangesDialog } from "@/components/ui/DiscardChangesDialog";

export function CleaningDiscardDialog({ scope, applying, fallbackFocus, onContinue, onDiscard }: {
  scope: "editor" | "replacement"; applying: boolean; fallbackFocus: RefObject<HTMLHeadingElement | null>;
  onContinue: () => void; onDiscard: () => void;
}) {
  const t = useTranslations("visualCleaning");
  return <DiscardChangesDialog
    title={t(scope === "editor" ? "discardEditorTitle" : "discardReplacementTitle")}
    description={t(scope === "editor" ? "discardEditorDescription" : "discardReplacementDescription")}
    continueLabel={t("continueEditing")} discardLabel={t(scope === "editor" ? "discardAndClose" : "discardReplacement")}
    disabled={applying} fallbackFocus={fallbackFocus} onContinue={onContinue} onDiscard={onDiscard} />;
}
