export type DataWorkspaceView = "sources" | "understanding";
export type WorkbenchView = "result" | DataWorkspaceView;

/** The hidden data pane retains its last view without a second active-view flag. */
export type WorkbenchPane =
  | { view: "result"; lastDataView: DataWorkspaceView }
  | { view: DataWorkspaceView };

export const INITIAL_WORKBENCH_PANE: WorkbenchPane = { view: "result", lastDataView: "sources" };

export function selectWorkbenchPane(current: WorkbenchPane, view: WorkbenchView): WorkbenchPane {
  if (view === current.view) return current;
  return view === "result"
    ? { view, lastDataView: current.view === "result" ? current.lastDataView : current.view }
    : { view };
}
