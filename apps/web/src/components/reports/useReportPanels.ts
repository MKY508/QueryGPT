"use client";

import { useMemo, useState } from "react";

/** Desktop panes are independent choices, never viewport-derived state. */
export function useReportPanels() {
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const actions = useMemo(() => ({
    toggleOutline: () => setOutlineOpen((open) => !open),
    toggleProperties: () => setPropertiesOpen((open) => !open),
    showOutline: () => setOutlineOpen(true),
    showProperties: () => setPropertiesOpen(true),
    closeOutline: () => setOutlineOpen(false),
    closeProperties: () => setPropertiesOpen(false),
  }), []);
  return { outlineOpen, propertiesOpen, ...actions };
}
