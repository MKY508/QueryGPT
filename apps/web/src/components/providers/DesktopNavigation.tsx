"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { subscribeToDesktopClose, subscribeToDesktopErrors, subscribeToDesktopNavigation } from "@/lib/desktop-app-info";
import { subscribeToUploadLifecycle } from "@/lib/upload-lifecycle";

export function DesktopNavigation() {
  const router = useRouter();
  const locale = useLocale();

  useEffect(() => subscribeToDesktopNavigation((page) => router.push(page), locale), [router, locale]);
  useEffect(() => subscribeToDesktopErrors(), []);
  useEffect(() => {
    // Install document-lifetime guards before advertising native close readiness.
    const uploads = subscribeToUploadLifecycle();
    const close = subscribeToDesktopClose();
    return () => { close?.(); uploads?.(); };
  }, []);

  return null;
}
