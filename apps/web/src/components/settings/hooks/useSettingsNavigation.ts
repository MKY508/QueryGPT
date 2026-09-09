"use client";

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { useSearchParams } from "next/navigation";
import { getSettingsDestination, resolveSettingsSection, settingsSectionHref, type SettingsPanel, type SettingsPreference, type SettingsSection } from "@/lib/settings/navigation";

/** URL owns selection; this mounted workspace owns visited forms and reading position. */
export function useSettingsNavigation() {
  const search = useSearchParams();
  const destination = getSettingsDestination(search.get("tab"));
  const { id: active, panel } = destination;
  const [session, setSession] = useState<{ visited: SettingsPanel[]; preference: SettingsPreference }>(() => ({
    visited: [panel], preference: destination.panel === "preferences" ? destination.preference : "appearance",
  }));
  const preference = destination.panel === "preferences" ? destination.preference : session.preference;
  if (!session.visited.includes(panel) || preference !== session.preference) {
    setSession({ visited: session.visited.includes(panel) ? session.visited : [...session.visited, panel], preference });
  }

  const heading = useRef<HTMLHeadingElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<SettingsSection, number>());
  const lastSection = useRef(active);
  const focusFrame = useRef<number | null>(null);
  useEffect(() => () => { if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current); }, []);
  useLayoutEffect(() => {
    if (scroll.current) scroll.current.scrollTop = positions.current.get(active) ?? 0;
    if (lastSection.current !== active) heading.current?.focus({ preventScroll: true });
    lastSection.current = active;
  }, [active]);

  const navigate = (section: SettingsSection, event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    // Read immediate history, not a render snapshot: the latest click wins.
    const current = resolveSettingsSection(new URLSearchParams(window.location.search).get("tab"));
    if (section !== current) window.history.pushState(null, "", settingsSectionHref(section, window.location.search) + window.location.hash);
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() => {
      focusFrame.current = null;
      heading.current?.focus({ preventScroll: true });
    });
  };

  return { destination, panel, preference, visited: session.visited, heading, scroll,
    recordScroll: (position: number) => positions.current.set(active, position),
    directory: { active, search: search.toString(), onNavigate: navigate } };
}
