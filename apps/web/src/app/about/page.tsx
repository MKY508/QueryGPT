"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ExternalLink,
  Github,
  MessageCircleQuestion,
  Scale,
} from "lucide-react";
import { formatDesktopPlatform, readDesktopAppInfo } from "@/lib/desktop-app-info";
import { RECEIPTBI_BRAND_ICON_SRC } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import styles from "./page.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const REPOSITORY_URL = "https://github.com/MoonMao42/ReceiptBI";
const LICENSE_URL = `${REPOSITORY_URL}/blob/main/LICENSE`;
const ISSUES_URL = `${REPOSITORY_URL}/issues`;

interface RuntimeInfo {
  version: string;
  isPackaged: boolean;
  platform?: string;
}

function formatDisplayVersion(version: string) {
  return version.replace(/^(\d+\.\d+)\.0$/, "$1");
}

type WindowWithExternalBridge = Window & {
  electronAPI?: {
    openExternal?: (url: string) => Promise<void>;
  };
};

async function openFixedExternalUrl(url: string) {
  const bridge = (window as WindowWithExternalBridge).electronAPI?.openExternal;
  if (bridge) {
    try {
      await bridge(url);
      return;
    } catch {
      // Browser fallback keeps the links useful while the desktop bridge starts.
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export default function AboutPage() {
  const router = useRouter();
  const t = useTranslations("about");
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null);
  useEffect(() => {
    let active = true;

    const loadRuntimeInfo = async () => {
      try {
        const desktopInfo = await readDesktopAppInfo();
        if (desktopInfo) {
          if (active) {
            setRuntimeInfo({
              version: desktopInfo.version,
              isPackaged: desktopInfo.isPackaged,
              platform: desktopInfo.platform,
            });
          }
          return;
        }
      } catch {
        // Fall back to the local service when an older desktop bridge is still starting.
      }

      try {
        const response = await fetch(`${API_URL}/health`, {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) return;
        const payload = (await response.json()) as { version?: string };
        if (active && payload.version) {
          setRuntimeInfo({ version: payload.version, isPackaged: false });
        }
      } catch {
        // Basic product links remain available while the local service starts.
      }
    };

    void loadRuntimeInfo();
    return () => {
      active = false;
    };
  }, []);

  const runtimeLabel = runtimeInfo
    ? `${runtimeInfo.isPackaged ? t("desktop") : t("preview")} · v${formatDisplayVersion(runtimeInfo.version)}`
    : t("preview");
  const links = [
    {
      label: "GitHub",
      description: t("repositoryDescription"),
      url: REPOSITORY_URL,
      icon: Github,
    },
    {
      label: "MIT License",
      description: t("licenseDescription"),
      url: LICENSE_URL,
      icon: Scale,
    },
    {
      label: t("issues"),
      description: t("issuesDescription"),
      url: ISSUES_URL,
      icon: MessageCircleQuestion,
    },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.surface}>
      <header className={styles.header}>
          <Button variant="ghost"
            onClick={() => router.push("/")}
          >
            <ArrowLeft size={17} />
            {t("backToWorkspace")}
          </Button>
          <div className="flex items-center gap-2.5">
            <Image
              src={RECEIPTBI_BRAND_ICON_SRC}
              alt=""
              width={32}
              height={32}
              unoptimized
              className="h-8 w-8 object-contain"
              aria-hidden="true"
            />
            <span className="text-sm font-semibold tracking-wide">ReceiptBI</span>
          </div>
      </header>

      <main className={styles.main}>
        <section className={styles.identity}>
          <div className={styles.product}>
            <Image src={RECEIPTBI_BRAND_ICON_SRC} alt="" width={72} height={72} unoptimized aria-hidden="true" />
            <h1>ReceiptBI</h1>
          </div>

          <div className={styles.version}>
            <div className="text-xs font-medium text-muted-foreground">
              {t("version")}
            </div>
            <div className="mt-2 text-sm font-medium tabular-nums">{runtimeLabel}</div>
            {runtimeInfo?.platform && (
              <div className="mt-1 text-xs text-muted-foreground">
                {formatDesktopPlatform(runtimeInfo.platform)}
              </div>
            )}

          </div>
        </section>

        <section className={styles.links}>
          {links.map(({ label, description, url, icon: Icon }) => (
            <button
              key={url}
              type="button"
              onClick={() => void openFixedExternalUrl(url)}
              className={styles.resource}
            >
              <span className={styles.resourceIcon}><Icon size={18} aria-hidden="true" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  {label}
                  <ExternalLink
                    size={13}
                    className="ml-auto shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </span>
                <span className="mt-2 block text-xs leading-5 text-muted-foreground">
                  {description}
                </span>
              </span>
            </button>
          ))}
        </section>
      </main>
      </div>
    </div>
  );
}
