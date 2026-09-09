"use client";

import { useId, useRef, useState, useTransition } from "react";
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { setLocale } from "@/lib/actions/locale";
import { useThemeStore, THEMES, type ThemeId } from "@/lib/stores/theme";
import { cn } from "@/lib/utils";

/** Immediate display preferences are independent from persisted execution drafts. */
export function AppearancePreferences() {
  const t = useTranslations("preferences");
  const themeCopy = useTranslations("theme");
  const locale = useLocale();
  const router = useRouter();
  const { theme, setTheme } = useThemeStore();
  const groupId = useId();
  const pendingRef = useRef(false);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function changeLocale(next: string) {
    if (next === locale || pendingRef.current) return;
    pendingRef.current = true;
    setFailed(false);
    startTransition(async () => {
      try {
        await setLocale(next);
        router.refresh();
      } catch {
        setFailed(true);
      } finally {
        pendingRef.current = false;
      }
    });
  }

  return <div className="max-w-[840px] space-y-8" data-appearance-preferences>
    <fieldset className="min-w-0">
      <legend className="mb-3 text-sm font-semibold">{t("language")}</legend>
      <div className="flex w-fit gap-1 rounded-lg border border-border bg-muted/40 p-1" aria-busy={pending}>
        {([{ id: "zh", label: t("languageChinese") }, { id: "en", label: t("languageEnglish") }]).map(option =>
          <Button key={option.id} variant={locale === option.id ? "outline" : "ghost"}
            aria-pressed={locale === option.id} disabled={pending} className="min-w-28"
            onClick={() => changeLocale(option.id)}>
            {locale === option.id && <Check size={14} aria-hidden="true" />}{option.label}
          </Button>
        )}
      </div>
      {failed && <p role="alert" className="mt-2 text-sm text-destructive">{t("languageChangeFailed")}</p>}
    </fieldset>
    <fieldset className="min-w-0">
      <legend className="mb-3 text-sm font-semibold">{t("uiTheme")}</legend>
      <div className="grid grid-cols-2 gap-4">
        {(Object.keys(THEMES) as ThemeId[]).map(id => <label key={id}
          className={cn("relative cursor-pointer overflow-hidden rounded-xl border bg-card transition-colors focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 focus-within:ring-offset-background",
            theme === id ? "border-primary" : "border-border hover:border-primary/50")}>
          <div aria-hidden="true" data-theme={id} className="appearance-theme-preview border-b border-border bg-background p-5">
            <div className="flex h-28 overflow-hidden rounded-lg border border-border bg-card">
              <div className="w-1/4 space-y-2 border-r border-border bg-muted/50 p-3">
                <div className="mb-4 h-2 w-5 rounded-sm bg-primary" />
                <div className="h-1.5 rounded-sm bg-primary/30" />
                <div className="h-1.5 w-4/5 rounded-sm bg-foreground/15" />
                <div className="h-1.5 w-3/5 rounded-sm bg-foreground/15" />
              </div>
              <div className="flex-1 space-y-3 p-4">
                <div className="h-2 w-1/2 rounded-sm bg-foreground/70" />
                <div className="h-1.5 w-3/4 rounded-sm bg-foreground/15" />
                <div className="flex gap-2">
                  <div className="h-9 flex-1 rounded-md border border-border bg-muted/40" />
                  <div className="h-9 flex-1 rounded-md border border-border bg-muted/40" />
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3 p-4">
            <input type="radio" name={groupId} value={id} checked={theme === id}
              onChange={() => setTheme(id)} aria-labelledby={groupId + id + "-name"}
              aria-describedby={groupId + id + "-description"} className="mt-0.5 h-4 w-4 shrink-0 accent-primary" />
            <div>
              <div id={groupId + id + "-name"} className="text-sm font-medium">{themeCopy(id + ".name")}</div>
              <p id={groupId + id + "-description"} className="mt-1 text-xs leading-5 text-muted-foreground">{themeCopy(id + ".description")}</p>
            </div>
          </div>
        </label>)}
      </div>
    </fieldset>
  </div>;
}
