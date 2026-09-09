"use client";

import { useId, useState, type MouseEvent } from "react";
import { Database, FileSearch, Layers3, Palette, Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { SearchField } from "@/components/ui/SearchField";
import { cn } from "@/lib/utils";
import { SETTINGS_CATALOG, matchesSettingsSection, settingsSectionHref, type SettingsSection } from "@/lib/settings/navigation";

const icons = { models: Layers3, connections: Database, execution: Play, appearance: Palette, advanced: FileSearch } satisfies Record<SettingsSection, typeof Layers3>;

interface DirectoryProps {
  active: SettingsSection; search: string;
  onNavigate: (section: SettingsSection, event: MouseEvent<HTMLAnchorElement>) => void;
}

export function SettingsDirectory({ active, search, onNavigate }: DirectoryProps) {
  const t = useTranslations("settings");
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const directoryId = useId();
  const items = SETTINGS_CATALOG.filter(item => matchesSettingsSection(query, t(item.label), t(item.description)));
  return <div className="flex min-h-0 flex-1 flex-col">
    <SearchField value={input} onChange={setInput} onQueryChange={setQuery} controls={directoryId}
      label={t("searchSections")} clearLabel={t("clearSectionSearch")}
      className="mx-3 mb-4 mt-2 shrink-0 bg-muted/40" />
    <nav id={directoryId} aria-label={t("directory")} className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
      <ul className="space-y-1">{items.map(item => {
        const Icon = icons[item.id];
        return <li key={item.id}>
        <a href={settingsSectionHref(item.id, search)} onClick={event => onNavigate(item.id, event)}
          data-testid={`settings-tab-${item.id}`} aria-label={t(item.label)} aria-current={active === item.id ? "page" : undefined}
          className={cn("group flex items-center gap-3 rounded-md px-3 py-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary",
            active === item.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
          <Icon size={18} aria-hidden="true" className="shrink-0" /><span className="min-w-0 text-sm font-medium">{t(item.label)}</span>
        </a>
      </li>; })}</ul>
      {!items.length && <p role="status" className="px-3 py-6 text-sm leading-6 text-muted-foreground">{t("noMatchingSections")}</p>}
    </nav>
  </div>;
}
