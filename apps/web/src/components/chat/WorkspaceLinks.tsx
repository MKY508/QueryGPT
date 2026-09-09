"use client";

import Link from "next/link";
import { Folders, LayoutDashboard, Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export function WorkspaceLinks({ projectId, onOpenProjects }: {
  projectId: string | null;
  onOpenProjects: () => void;
}) {
  const t = useTranslations("workbench");
  return <nav className="workbench-sections" aria-label={t("navigation")}>
    {projectId && <Link href={`/projects/${projectId}/reports`} className="workbench-section"><LayoutDashboard size={16} />{t("reports")}</Link>}
    <Button variant="ghost" onClick={onOpenProjects} className="workbench-section justify-start" aria-haspopup="dialog"><Folders size={16} />{t("projects")}</Button>
    <Link href="/settings" className="workbench-section"><Settings size={16} />{t("settings")}</Link>
  </nav>;
}
