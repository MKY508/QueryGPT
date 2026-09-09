"use client";

import { useState } from "react";
import { Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { SearchField } from "@/components/ui/SearchField";
import { Button } from "@/components/ui/button";
import field from "@/components/ui/FieldControl.module.css";
import { REPORT_LIBRARY_SEARCH_LIMIT, type ReportLibraryView } from "@/lib/report-library";

export function ReportLibraryControls({ view, onChange }: {
  view: ReportLibraryView;
  onChange: (next: ReportLibraryView) => void;
}) {
  const t = useTranslations("reportIndex");
  const [input, setInput] = useState({ committed: view.search, text: view.search });
  if (input.committed !== view.search) setInput({ committed: view.search, text: view.search });
  const search = () => onChange({ ...view, search: input.text.trim(), page: 1 });
  const clear = () => {
    setInput({ committed: "", text: "" });
    onChange({ ...view, search: "", status: "all", page: 1 });
  };

  return <div className="mb-4 flex items-center gap-3">
    <form role="search" aria-label={t("searchReports")} onSubmit={(event) => { event.preventDefault(); search(); }}
      className="flex min-w-56 flex-1 items-center gap-2">
      <SearchField label={t("searchReports")} clearLabel={t("clearSearch")} className="flex-1" maxLength={REPORT_LIBRARY_SEARCH_LIMIT} value={input.text}
        onChange={(text) => {
          setInput((current) => ({ ...current, text }));
          if (!text) onChange({ ...view, search: "", page: 1 });
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault();
        }} />
      <Button variant="outline" size="icon" type="submit" aria-label={t("searchReports")} title={t("searchReports")}><Search size={16} /></Button>
    </form>
    <div className="w-[150px] shrink-0"><select aria-label={t("filterStatus")} value={view.status}
      onChange={(event) => onChange({ ...view, status: event.target.value as ReportLibraryView["status"], page: 1 })}
      className={field.control}>
      <option value="all">{t("statusAll")}</option>
      <option value="draft">{t("statusDraft")}</option>
      <option value="published">{t("statusPublished")}</option>
      <option value="archived">{t("statusArchived")}</option>
    </select></div>
    <div className="w-[170px] shrink-0"><select aria-label={t("sortReports")} value={view.sort}
      onChange={(event) => onChange({ ...view, sort: event.target.value as ReportLibraryView["sort"], page: 1 })}
      className={field.control}>
      <option value="updated">{t("sortUpdated")}</option>
      <option value="created">{t("sortCreated")}</option>
      <option value="title">{t("sortTitle")}</option>
    </select></div>
    {(view.search || view.status !== "all") && <Button variant="ghost" size="sm" onClick={clear}>
      <X size={14} />{t("clearFilters")}
    </Button>}
  </div>;
}
