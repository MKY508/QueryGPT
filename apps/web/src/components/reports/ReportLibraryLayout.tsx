import type { ReactNode } from "react";

/** Shared desktop primary/detail structure; selection and requests belong to the task. */
export function ReportLibraryLayout({ directoryLabel, directory, children }: {
  directoryLabel: string; directory: ReactNode; children: ReactNode;
}) {
  return <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)]">
    <section aria-label={directoryLabel} className="flex min-h-0 flex-col overflow-y-auto border-r border-border p-4">
      {directory}
    </section>
    <div className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-muted/20">{children}</div>
  </div>;
}
