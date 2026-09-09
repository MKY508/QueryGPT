"use client";

import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import fieldStyles from "@/components/ui/FieldControl.module.css";
import { cn } from "@/lib/utils";

/** Navigation is independent of report mutation locks and owns no document state. */
export function ReportPageNavigator({ pages, activePageId, editing, mutationDisabled, onSelectPage, onAddPage }: {
  pages: readonly { id: string; title: string }[];
  activePageId: string;
  editing: boolean;
  mutationDisabled: boolean;
  onSelectPage: (pageId: string) => void;
  onAddPage?: () => void;
}) {
  const t = useTranslations("reportWorkspace");
  const currentIndex = Math.max(0, pages.findIndex(page => page.id === activePageId));
  const previousPage = pages[currentIndex - 1];
  const nextPage = pages[currentIndex + 1];
  return <div className={cn("sticky top-0 z-20 border-b border-border/80 px-3 py-2 backdrop-blur", editing ? "bg-background/95" : "bg-muted/95")}>
    <nav aria-label={t("pageNavigation")} className="mx-auto flex max-w-[1120px] flex-wrap items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span aria-live="polite" className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {t("pagePosition", { current: pages.length ? currentIndex + 1 : 0, total: pages.length })}
        </span>
        <select aria-label={t("selectPage")} value={pages[currentIndex]?.id ?? ""} disabled={!pages.length}
          onChange={event => onSelectPage(event.target.value)} className={cn(fieldStyles.control, "flex-1 text-xs")}>
          {pages.map((page, index) => <option key={page.id} value={page.id}>{String(index + 1).padStart(2, "0")} · {page.title}</option>)}
        </select>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" disabled={!previousPage}
          aria-label={previousPage ? t("previousPageNamed", { title: previousPage.title }) : t("previousPage")}
          onClick={() => previousPage && onSelectPage(previousPage.id)}>
          <ChevronLeft size={13} /><span>{t("previousPage")}</span>
        </Button>
        <Button variant="ghost" size="sm" disabled={!nextPage}
          aria-label={nextPage ? t("nextPageNamed", { title: nextPage.title }) : t("nextPage")}
          onClick={() => nextPage && onSelectPage(nextPage.id)}>
          <span>{t("nextPage")}</span><ChevronRight size={13} />
        </Button>
        {editing && onAddPage && <Button variant="outline" size="sm" disabled={mutationDisabled} onClick={onAddPage} aria-label={t("addPage")}>
          <Plus size={13} /><span>{t("addPage")}</span>
        </Button>}
      </div>
    </nav>
  </div>;
}
