/** Only report-owned text fields participate in document history. */
export function reportHistoryField(target: EventTarget | null): HTMLElement | null {
  return target instanceof HTMLElement && target.matches("input:not([type]), input[type=text], input[type=number], textarea")
    && target.closest("[data-report-history]") ? target : null;
}
