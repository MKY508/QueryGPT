"use client";

import { Suspense, useEffect } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { SettingsExitProvider, SettingsExitLink as Link } from "@/components/settings/SettingsExitGuard";
import { useRouter } from "next/navigation";
import { ArrowLeft, Info, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { ModelSettings } from "@/components/settings/ModelSettings";
import { SettingsDirectory } from "@/components/settings/SettingsDirectory";
import styles from "@/components/settings/SettingsWorkspace.module.css";
import { useSettingsNavigation } from "@/components/settings/hooks/useSettingsNavigation";
import { RECEIPTBI_BRAND_ICON_SRC } from "@/lib/brand";

function SettingsPanelPending() {
  const t = useTranslations("settings");
  return <div role="status" aria-label={t("openingAria")} className="flex min-h-40 items-center justify-center text-muted-foreground"><Loader2 size={16} className="animate-spin" /></div>;
}
const loadConnectionSettings = () => import("@/components/settings/ConnectionSettings").then(module => module.ConnectionSettings);
const loadPreferencesSettings = () => import("@/components/settings/PreferencesSettings").then(module => module.PreferencesSettings);
const ConnectionSettings = dynamic(loadConnectionSettings, { loading: SettingsPanelPending });
const PreferencesSettings = dynamic(loadPreferencesSettings, { loading: SettingsPanelPending });
function SettingsWorkspace() {
  const router = useRouter();
  const t = useTranslations("settings");
  const { destination: item, panel, preference, visited, heading, scroll, recordScroll, directory } = useSettingsNavigation();
  useEffect(() => {
    router.prefetch("/about");
    const warm = () => { void Promise.allSettled([loadConnectionSettings(), loadPreferencesSettings()]); };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(warm, { timeout: 1200 }); return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(warm, 250); return () => window.clearTimeout(id);
  }, [router]);

  return <div className={styles.workspace}>
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <Image src={RECEIPTBI_BRAND_ICON_SRC} alt="" width={30} height={30} unoptimized className="rounded-md bg-white p-1" />
        <span>ReceiptBI</span>
      </div>
      <SettingsDirectory {...directory} />
      <div className={styles.footer}><Link href="/about" prefetch className={styles.link}><Info size={16} />{t("about")}</Link></div>
    </aside>
    <section className={styles.content}>
      <header className={styles.header}>
        <h1 ref={heading} tabIndex={-1}>{t(item.label)}</h1>
        <Link href="/" className={styles.link}><ArrowLeft size={16} />{t("backToProject")}</Link>
      </header>
      <div ref={scroll} data-testid="settings-scroll" onScroll={event => recordScroll(event.currentTarget.scrollTop)} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <main className={styles.main}>
          <p className="mb-6 text-sm leading-6 text-muted-foreground">{t(item.description)}</p>
          {visited.includes("models") && <section hidden={panel !== "models"} inert={panel !== "models"} data-settings-panel="models"><ModelSettings active={panel === "models"} /></section>}
          {visited.includes("connections") && <section hidden={panel !== "connections"} inert={panel !== "connections"} data-settings-panel="connections"><ConnectionSettings active={panel === "connections"} /></section>}
          {visited.includes("preferences") && <section hidden={panel !== "preferences"} inert={panel !== "preferences"} data-settings-panel="preferences"><PreferencesSettings section={preference} active={panel === "preferences"} /></section>}
        </main>
      </div>
    </section>
  </div>;
}

export default function SettingsPage() {
  return <Suspense fallback={<SettingsPanelPending />}><SettingsExitProvider><SettingsWorkspace /></SettingsExitProvider></Suspense>;
}
