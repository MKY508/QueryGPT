"use client";

import { useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eraser,
  Loader2,
  Plus,
  Redo2,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

import type {
  ProjectDataSource,
  TextValueReplacement,
  VisualCleaningOperation,
} from "@/lib/types/api";
import { useProjectStore } from "@/lib/stores/project";
import { getUserFacingErrorMessage } from "@/lib/types/api";
import { activeCleaningOperations, cleaningOperationKey as operationKey, cleaningEditHistoryReducer, createCleaningEditHistory, hasCleaningEdits } from "@/lib/cleaning-edit-history";
import { cleaningColumnLabels, isCleaningFieldName } from "@/lib/cleaning-field-names";
import { editableSavedOperation, inspectSavedVisualCleaningOperations, rawOperationKey } from "@/lib/cleaning-saved-state";
export { parseSavedVisualCleaningOperations } from "@/lib/cleaning-saved-state";
import { CleaningImpactProfiles, cleaningChangedCells } from "./CleaningImpactProfiles";
import { CleaningSamples } from "./CleaningSamples";
import { CleaningColumnSelect } from "./CleaningColumnSelect";
import { MAX_RECIPE_TEXT_REPLACEMENTS } from "@/lib/text-value-replacements";
import { TextReplacementSummary, TextValueReplacementEditor, type TextValueReplacementEditorHandle } from "./TextValueReplacementEditor";
import { CleaningDiscardDialog } from "./CleaningDiscardDialog";

export type VisualCleaningAction =
  | "trim_text"
  | "fill_missing"
  | "normalize_datetime"
  | "normalize_currency"
  | "drop_exact_duplicates";

type VisualCleaningTranslator = ReturnType<
  typeof useTranslations<"visualCleaning">
>;

export function buildVisualCleaningOperation(
  action: VisualCleaningAction,
  column?: string,
): VisualCleaningOperation | null {
  if (action === "drop_exact_duplicates") {
    return { operation: "drop_exact_duplicates" };
  }
  if (!isCleaningFieldName(column)) return null;
  if (action === "fill_missing") {
    return { operation: "fill_missing", column, value: 0 };
  }
  return { operation: action, column };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

interface ReadonlyCleaningOperation {
  key: string;
  label: string;
  replacements?: TextValueReplacement[];
}

function operationLabel(
  operation: VisualCleaningOperation,
  t: VisualCleaningTranslator,
  fieldLabel: (column: string) => string = (column) => column,
): string {
  const column = "column" in operation ? `“${fieldLabel(operation.column)}”` : "";
  switch (operation.operation) {
    case "trim_text":
      return t("trimLabel", { column });
    case "fill_missing":
      return t("fillZeroLabel", { column });
    case "normalize_datetime":
      return t("unifyDatesLabel", { column });
    case "normalize_currency":
      return t("unifyAmountsLabel", { column });
    case "replace_text_values":
      return t("replaceTextLabel", { column, count: operation.replacements.length });
    case "drop_exact_duplicates":
      return t("removeDuplicatesLabel");
  }
}

function readonlyOperationLabel(
  value: Record<string, unknown>,
  t: VisualCleaningTranslator,
  fieldLabel: (column: string) => string,
): string {
  const editable = editableSavedOperation(value);
  if (editable) return operationLabel(editable, t, fieldLabel);
  const operation = value.operation;
  if (operation === "fill_missing" && typeof value.column === "string") {
    return t("fillNullLabel", { column: `“${fieldLabel(value.column)}”` });
  }
  if (operation === "select_sheet" && typeof value.sheet === "string") {
    return t("selectSheetLabel", { sheet: value.sheet });
  }
  if (operation === "select_header" && typeof value.row === "number") {
    return t("headerRowLabel", { row: value.row });
  }
  if (operation === "normalize_column_names") return t("cleanHeadersLabel");
  if (operation === "use_generated_headers") return t("generatedHeadersLabel");
  if (operation === "read_csv") return t("csvOptionsLabel");
  if (operation === "drop_empty") return t("removeEmptyLabel");
  if (operation === "exclude_summary_rows") return t("removeSummaryLabel");
  return t("otherStepLabel");
}

function readonlyRecipeOperations(
  recipeOperations: Record<string, unknown>[],
  manualOperationKeys: Set<string>,
  t: VisualCleaningTranslator,
  fieldLabel: (column: string) => string,
): ReadonlyCleaningOperation[] {
  const seen = new Set<string>();
  return recipeOperations.flatMap((operation) => {
    const key = rawOperationKey(operation);
    if (!key || manualOperationKeys.has(key) || seen.has(key)) return [];
    seen.add(key);
    const editable = editableSavedOperation(operation);
    return [{ key, label: readonlyOperationLabel(operation, t, fieldLabel),
      replacements: editable?.operation === "replace_text_values" ? editable.replacements : undefined }];
  });
}

interface VisualCleaningEditorProps {
  source: ProjectDataSource;
  columns: string[];
  initialColumn?: string;
  recipeOperations?: Record<string, unknown>[];
  onClose: () => void;
}

const NO_RECIPE_OPERATIONS: Record<string, unknown>[] = [];

export function VisualCleaningEditor({
  ...props
}: VisualCleaningEditorProps) {
  return <VisualCleaningSession key={`${props.source.project_id}:${props.source.id}`} {...props} />;
}

function VisualCleaningSession({
  source,
  columns,
  initialColumn,
  recipeOperations = NO_RECIPE_OPERATIONS,
  onClose,
}: VisualCleaningEditorProps) {
  const locale = useLocale();
  const t = useTranslations("visualCleaning");
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const stepsHeadingRef = useRef<HTMLHeadingElement>(null);
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(false);
  const requestRef = useRef(0);

  const COLUMN_ACTIONS: Array<{
    value: Exclude<VisualCleaningAction, "drop_exact_duplicates">;
    label: string;
    description: string;
  }> = [
    {
      value: "trim_text",
      label: t("trimWhitespace"),
      description: t("trimWhitespaceDesc"),
    },
    {
      value: "fill_missing",
      label: t("fillZero"),
      description: t("fillZeroDesc"),
    },
    {
      value: "normalize_datetime",
      label: t("unifyDates"),
      description: t("unifyDatesDesc"),
    },
    {
      value: "normalize_currency",
      label: t("unifyAmounts"),
      description: t("unifyAmountsDesc"),
    },
  ];

  const firstColumn = columns[0] || "";
  // A routine workspace refresh must not erase an unfinished local edit.
  // A different source mounts a new session; applying still requires a preview.
  const currentSavedState = useMemo(() => inspectSavedVisualCleaningOperations(source.profile_data.visual_cleaning), [source.profile_data.visual_cleaning]);
  const [savedState] = useState(currentSavedState);
  const savedOperations = savedState.operations;
  const uneditableState = currentSavedState.hasUnsupportedOperations ? currentSavedState : savedState;
  const blockedSteps = uneditableState.blockedOperations.slice(0, 8);
  const moreBlockedSteps = uneditableState.blockedOperations.length - blockedSteps.length + uneditableState.omittedOperations;
  const columnLabels = useMemo(() => cleaningColumnLabels([
    ...columns,
    ...savedOperations.flatMap(operation => "column" in operation ? [operation.column] : []),
    ...uneditableState.blockedOperations.flatMap(operation => isRecord(operation) && isCleaningFieldName(operation.column) ? [operation.column] : []),
    ...recipeOperations.flatMap(operation => isCleaningFieldName(operation.column) ? [operation.column] : []),
  ]), [columns, savedOperations, recipeOperations, uneditableState.blockedOperations]);
  const columnNames = useMemo(() => [...columnLabels.keys()], [columnLabels]);
  const fieldLabel = (column: string) => columnLabels.get(column) ?? column;
  const stepLabel = (operation: VisualCleaningOperation) => operationLabel(operation, t, fieldLabel);
  const readonlyOperations = readonlyRecipeOperations(
    recipeOperations,
    savedState.operationKeys,
    t,
    fieldLabel,
  );
  const readonlyOperationKeys = new Set(
    readonlyOperations.map((operation) => operation.key),
  );
  const hasUnsupportedSavedOperations = savedState.hasUnsupportedOperations
    || currentSavedState.hasUnsupportedOperations;
  const [selectedColumn, setSelectedColumn] = useState(() =>
    initialColumn !== undefined && columns.includes(initialColumn) ? initialColumn : firstColumn);
  const [columnSearch, setColumnSearch] = useState("");
  const currentColumn = columns.includes(selectedColumn) ? selectedColumn : firstColumn;
  const [replacementColumn, setReplacementColumn] = useState<string | null>(null);
  const replacementEditorRef = useRef<TextValueReplacementEditorHandle>(null);
  const replacementWasOpen = useRef(false);
  const [exitRequest, setExitRequest] = useState<"editor" | "replacement" | null>(null);
  const [history, dispatchHistory] = useReducer(cleaningEditHistoryReducer, savedOperations, createCleaningEditHistory);
  const operations = history.present.operations;
  const draftChanged = useMemo(() => hasCleaningEdits(history.present, savedOperations), [history.present, savedOperations]);
  const activeOperations = useMemo(() => activeCleaningOperations(history.present), [history.present]);
  const skippedOperationKeys = useMemo(() => new Set(history.present.skippedKeys), [history.present.skippedKeys]);
  const skippedOperations = operations.filter((operation) => skippedOperationKeys.has(operationKey(operation)));
  const [historyAnnouncement, setHistoryAnnouncement] = useState<"undo" | "redo" | null>(null);
  const initialHadOperations = savedState.hasSavedOperations;
  const [feedback, setFeedback] = useState<string | null>(null);
  const preview = useProjectStore(
    (state) => state.cleaningPreviewBySource[source.id],
  );
  const cleaningAction = useProjectStore((state) => state.cleaningAction);
  const previewSourceCleaning = useProjectStore(
    (state) => state.previewSourceCleaning,
  );
  const clearSourceCleaningPreview = useProjectStore(
    (state) => state.clearSourceCleaningPreview,
  );
  const applySourceCleaning = useProjectStore(
    (state) => state.applySourceCleaning,
  );
  const busy = cleaningAction !== null;
  const applying = cleaningAction?.sourceId === source.id && cleaningAction.kind === "apply";
  const changedCells = useMemo(
    () => preview ? cleaningChangedCells(preview) : null,
    [preview],
  );

  useEffect(() => {
    const closed = replacementWasOpen.current && replacementColumn === null;
    replacementWasOpen.current = replacementColumn !== null;
    if (closed) {
      stepsHeadingRef.current?.focus({ preventScroll: true });
      stepsHeadingRef.current?.scrollIntoView?.({ block: "nearest" });
    }
  }, [replacementColumn]);

  useEffect(() => {
    if (hasUnsupportedSavedOperations) {
      requestRef.current += 1;
      clearSourceCleaningPreview(source.id);
    }
  }, [hasUnsupportedSavedOperations, clearSourceCleaningPreview, source.id]);

  useEffect(() => {
    activeRef.current = true;
    clearSourceCleaningPreview(source.id);
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    headingRef.current?.focus();
    return () => {
      activeRef.current = false;
      requestRef.current += 1;
      clearSourceCleaningPreview(source.id);
      if (dialog?.open && typeof dialog.close === "function") dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, [clearSourceCleaningPreview, source.id]);

  useEffect(() => {
    if (preview) {
      bodyRef.current?.scrollTo?.({ top: 0 });
      if (!dialogRef.current?.querySelector('dialog[open]')) reviewHeadingRef.current?.focus();
    }
  }, [preview]);

  const changeOperations = (next: VisualCleaningOperation[]) => {
    dispatchHistory({ type: "record", operations: next });
    setHistoryAnnouncement(null);
    setFeedback(null);
    requestRef.current += 1;
    clearSourceCleaningPreview(source.id);
  };

  const historyDisabled = busy || Boolean(preview) || hasUnsupportedSavedOperations || replacementColumn !== null;
  const toggleOperation = (operation: VisualCleaningOperation) => {
    if (historyDisabled || useProjectStore.getState().cleaningAction) return;
    dispatchHistory({ type: "toggle", key: operationKey(operation) });
    setHistoryAnnouncement(null);
    setFeedback(null);
    requestRef.current += 1;
    clearSourceCleaningPreview(source.id);
  };
  const navigateHistory = (direction: "undo" | "redo") => {
    if (historyDisabled || useProjectStore.getState().cleaningAction) return;
    if (!(direction === "undo" ? history.past : history.future).length) return;
    dispatchHistory({ type: direction });
    setHistoryAnnouncement(direction);
    setFeedback(null);
    requestRef.current += 1;
    clearSourceCleaningPreview(source.id);
    stepsHeadingRef.current?.focus({ preventScroll: true });
  };

  const closeEditor = () => {
    const action = useProjectStore.getState().cleaningAction;
    if (applying || (action?.sourceId === source.id && action.kind === "apply")) return;
    activeRef.current = false;
    requestRef.current += 1;
    clearSourceCleaningPreview(source.id);
    onClose();
  };

  const requestExit = (scope: "editor" | "replacement") => {
    const action = useProjectStore.getState().cleaningAction;
    if (applying || (action?.sourceId === source.id && action.kind === "apply")) return;
    if ((scope === "editor" && draftChanged) || replacementEditorRef.current?.hasChanges()) {
      setExitRequest(scope);
    } else if (scope === "editor") closeEditor();
    else setReplacementColumn(null);
  };

  const addOperation = (action: VisualCleaningAction) => {
    if (hasUnsupportedSavedOperations) {
      setFeedback(t("lockedHint"));
      return;
    }
    const operation = buildVisualCleaningOperation(action, currentColumn);
    if (!operation) {
      setFeedback(t("pickColumn"));
      return;
    }
    if (operations.some((item) => operationKey(item) === operationKey(operation))) {
      setFeedback(t("stepAlreadyAdded"));
      return;
    }
    if (readonlyOperationKeys.has(operationKey(operation))) {
      setFeedback(t("stepDoneAtImport"));
      return;
    }
    if (operations.length >= 100) {
      setFeedback(t("replacementStepLimit"));
      return;
    }
    changeOperations([...operations, operation]);
  };

  const handlePreview = async () => {
    if (busy || replacementColumn !== null || (activeOperations.length === 0 && !initialHadOperations)) return;
    if (hasUnsupportedSavedOperations) {
      setFeedback(t("lockedHint"));
      return;
    }
    setFeedback(null);
    const request = ++requestRef.current;
    try {
      await previewSourceCleaning(source.id, activeOperations);
    } catch (error) {
      if (activeRef.current && request === requestRef.current) {
        setFeedback(getUserFacingErrorMessage(error, t("previewFailed")));
      }
    }
  };

  const canPreview =
    !hasUnsupportedSavedOperations &&
    replacementColumn === null &&
    (activeOperations.length > 0 || initialHadOperations);

  const handleApply = async () => {
    if (busy || !preview?.can_apply || replacementColumn !== null) return;
    if (hasUnsupportedSavedOperations) {
      setFeedback(t("lockedHint"));
      return;
    }
    setFeedback(null);
    try {
      await applySourceCleaning(source.id, activeOperations);
      if (activeRef.current) onClose();
    } catch {
      if (activeRef.current) setFeedback(useProjectStore.getState().error || t("applyFailed"));
    }
  };

  const returnToEditing = () => {
    if (busy) return;
    requestRef.current += 1;
    setFeedback(null);
    clearSourceCleaningPreview(source.id);
    bodyRef.current?.scrollTo?.({ top: 0 });
    headingRef.current?.focus();
  };

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 m-auto h-[min(900px,94dvh)] max-h-none w-[min(1180px,96vw)] max-w-none overflow-hidden rounded-xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/40"
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); requestExit("editor"); }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.defaultPrevented) return;
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
          if (event.key === "Escape") event.preventDefault();
          return;
        }
        const key = event.key.toLowerCase();
        const direction = !event.altKey && (event.metaKey || event.ctrlKey)
          ? key === "z" ? event.shiftKey ? "redo" : "undo"
            : key === "y" && event.ctrlKey && !event.metaKey && !event.shiftKey ? "redo" : null
          : null;
        if (direction) {
          // Text edits belong to the focused field; step checkboxes use draft history.
          if (event.target instanceof HTMLElement && (event.target.isContentEditable
            || event.target.closest("input:not([type='checkbox']),textarea,select,[contenteditable]:not([contenteditable='false'])"))) return;
          event.preventDefault();
          navigateHistory(direction);
          return;
        }
        if (event.key !== "Tab") return;
        // Native modality makes the page inert; explicitly wrap its boundary
        // controls so Tab does not leave for the browser chrome (APG dialog).
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
          "button:not(:disabled),select:not(:disabled),input:not(:disabled),textarea:not(:disabled),summary,a[href],[tabindex='0']",
        )).filter((control) => control.getClientRects().length > 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === headingRef.current)) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-7 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold text-primary">
              <Eraser size={15} />
              {t("sectionTitle")}
            </div>
            <h2 ref={headingRef} tabIndex={-1} id={titleId} className="mt-1 truncate text-lg font-semibold text-foreground outline-none">
              {source.name}
            </h2>
          </div>
          <Button variant="ghost" size="icon"
            onClick={() => requestExit("editor")}
            disabled={applying}
            aria-label={t("closeEditorAria")}
          >
            <X size={19} />
          </Button>
        </header>
        <ol aria-label={t("flowAria")} className="flex shrink-0 gap-6 border-b border-border bg-muted/30 px-7">
          {[t("editStage"), t("reviewStage")].map((label, index) => (
            <li key={label} aria-current={Boolean(preview) === Boolean(index) ? "step" : undefined}
              className={`flex items-center gap-2 border-b-2 py-3 text-xs font-semibold ${Boolean(preview) === Boolean(index) ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}>
              <span className="font-mono text-[10px]">0{index + 1}</span>{label}
            </li>
          ))}
        </ol>

        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {!preview && <div className="grid min-h-full grid-cols-[320px_minmax(0,1fr)]">
          <section className="border-r border-border bg-muted/20 p-7">
            <h3 className="text-sm font-semibold text-foreground">{t("addStep")}</h3>
            <div className="mt-4 grid gap-4">
              <CleaningColumnSelect columns={columns} labels={columnLabels} value={currentColumn}
                onChange={setSelectedColumn} query={columnSearch} onQueryChange={setColumnSearch}
                label={t("selectColumn")} ariaLabel={t("selectColumnAria")} searchLabel={t("searchCleaningColumns")}
                disabled={busy || replacementColumn !== null} />
              {columns.some(column => fieldLabel(column) !== column) && <p className="text-xs text-muted-foreground">{t("columnNameWhitespaceHint")}</p>}
              <div className="grid grid-cols-1 gap-2">
                {COLUMN_ACTIONS.map((action) => (
                  <Button variant="outline"
                    key={action.value}
                    disabled={!columns.length || busy || hasUnsupportedSavedOperations || replacementColumn !== null}
                    onClick={() => addOperation(action.value)}
                    className="h-auto flex-col items-start gap-0 px-3 py-2.5 text-left"
                  >
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                      <Plus size={13} />
                      {action.label}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                      {action.description}
                    </span>
                  </Button>
                ))}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" size="sm"
              disabled={busy || hasUnsupportedSavedOperations || replacementColumn !== null}
              onClick={() => addOperation("drop_exact_duplicates")}
              className="h-8"
            >
              <Plus size={13} />
              {t("removeDuplicatesButton")}
            </Button>
            <Button variant="outline" size="sm"
              disabled={!currentColumn || busy || hasUnsupportedSavedOperations || replacementColumn !== null
                || readonlyOperationKeys.has(`replace_text_values:${currentColumn}`)}
              onClick={() => { clearSourceCleaningPreview(source.id); setReplacementColumn(currentColumn); }}
              className="h-8"
            >
              <Plus size={13} />{t("replaceTextButton")}
            </Button>
            </div>
          </section>
          <div className="min-w-0 p-7">
            {replacementColumn !== null && (
              <TextValueReplacementEditor
                ref={replacementEditorRef}
                key={`${source.id}:${replacementColumn}`}
                column={replacementColumn}
                columnLabel={fieldLabel(replacementColumn)}
                initial={operations.flatMap((operation) => operation.operation === "replace_text_values" && operation.column === replacementColumn ? operation.replacements : [])}
                suggestions={Array.isArray(source.profile_data.sample)
                  ? source.profile_data.sample.slice(0, 8).flatMap((row) => isRecord(row) && Object.hasOwn(row, replacementColumn) && typeof row[replacementColumn] === "string" ? [row[replacementColumn] as string] : []) : []}
                available={MAX_RECIPE_TEXT_REPLACEMENTS - operations.reduce((count, operation) => count + (operation.operation === "replace_text_values" && operation.column !== replacementColumn ? operation.replacements.length : 0), 0)
                  - readonlyOperations.reduce((count, operation) => count + (operation.replacements?.length ?? 0), 0)}
                disabled={busy || hasUnsupportedSavedOperations}
                onSave={(replacements) => {
                  const next = operations.filter((operation) => !(operation.operation === "replace_text_values" && operation.column === replacementColumn));
                  if (next.length >= 100) { setFeedback(t("replacementStepLimit")); return; }
                  changeOperations([...next, { operation: "replace_text_values", column: replacementColumn, replacements }]);
                  setReplacementColumn(null);
                }}
                onCancel={() => requestExit("replacement")}
              />
            )}

          {hasUnsupportedSavedOperations && (
            <div
              role="alert"
              className="rounded-md mt-4 border border-warning/30 bg-warning/[0.06] px-3 py-2 text-xs text-warning"
            >
              {t("readonlyNotice")}
            </div>
          )}

          {blockedSteps.length > 0 && <section aria-label={t("blockedStepsTitle")} className="my-4 border-y border-border py-3">
            <h3 className="text-xs font-semibold text-muted-foreground">{t("blockedStepsTitle")}</h3>
            <ul className="mt-2 space-y-2 text-sm text-foreground">
              {blockedSteps.map((operation, index) => <li key={index} className="flex items-start justify-between gap-3">
                <span className="min-w-0 break-words">{isRecord(operation) && isCleaningFieldName(operation.column)
                  ? t("blockedColumnStep", { column: fieldLabel(operation.column) }) : t("blockedStep")}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{t("blockedStepBadge")}</span>
              </li>)}
            </ul>
            {moreBlockedSteps > 0 && <p className="mt-2 text-xs text-muted-foreground">{t("moreBlockedSteps", { count: moreBlockedSteps })}</p>}
          </section>}

          <section className={replacementColumn !== null ? "mt-6" : ""} aria-label={t("stepsSectionTitle")}>
            <div className="flex items-center justify-between gap-3">
              <h3 ref={stepsHeadingRef} tabIndex={-1} className="text-sm font-semibold text-foreground outline-none">
                {t("stepsSectionTitle")}
                {!hasUnsupportedSavedOperations && operations.length + readonlyOperations.length
                  ? ` · ${t("stepsSectionCount", { count: operations.length + readonlyOperations.length })}`
                  : ""}
              </h3>
              <div role="group" aria-label={t("historyControls")} className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" size="sm" aria-label={t("undoStepEdit")} title={t("undoStepEdit")} aria-keyshortcuts="Control+Z Meta+Z"
                  disabled={historyDisabled || history.past.length === 0} onClick={() => navigateHistory("undo")}
                  className="h-8">
                  <Undo2 size={14} />{t("undoLabel")}
                </Button>
                <Button variant="ghost" size="sm" aria-label={t("redoStepEdit")} title={t("redoStepEdit")} aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
                  disabled={historyDisabled || history.future.length === 0} onClick={() => navigateHistory("redo")}
                  className="h-8">
                  <Redo2 size={14} />{t("redoLabel")}
                </Button>
              </div>
            </div>
            <span role="status" className="sr-only">{historyAnnouncement && t(historyAnnouncement === "undo" ? "historyUndone" : "historyRedone", {
              count: operations.length + readonlyOperations.length,
            })}{historyAnnouncement && ` ${t("stepSelectionCount", { active: activeOperations.length, skipped: skippedOperations.length })}`}</span>
            {skippedOperations.length > 0 && <p role="status" className="mt-2 text-xs text-muted-foreground">
              {t("stepSelectionCount", { active: activeOperations.length, skipped: skippedOperations.length })}
            </p>}
            {operations.length || readonlyOperations.length ? (
              <ol className="rounded-md mt-3 divide-y divide-border border-y border-border">
                {operations.map((operation, index) => (
                  <li key={operationKey(operation)} className="flex items-center gap-2 py-2.5">
                    <label className="flex size-7 shrink-0 cursor-pointer items-center justify-center">
                      <input type="checkbox" checked={!skippedOperationKeys.has(operationKey(operation))}
                        disabled={historyDisabled} onChange={() => toggleOperation(operation)}
                        aria-label={t("useStepAria", { step: stepLabel(operation) })}
                        className="size-4 accent-primary disabled:cursor-not-allowed" />
                    </label>
                    <span className="w-5 shrink-0 font-mono text-xs text-primary">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className={`min-w-0 flex-1 break-words text-sm ${skippedOperationKeys.has(operationKey(operation)) ? "text-muted-foreground" : "text-foreground"}`}>
                      {stepLabel(operation)}
                      {skippedOperationKeys.has(operationKey(operation)) && <span className="rounded-md ml-2 inline-block border border-border px-1.5 py-0.5 text-[10px]">{t("stepSkipped")}</span>}
                      {operation.operation === "replace_text_values" && <TextReplacementSummary replacements={operation.replacements} />}
                    </div>
                    {operation.operation === "replace_text_values" && (
                      <Button variant="ghost" size="sm" disabled={busy || hasUnsupportedSavedOperations || replacementColumn !== null}
                        onClick={() => { clearSourceCleaningPreview(source.id); setReplacementColumn(operation.column); }}
                        aria-label={t("replacementEditAria", { column: fieldLabel(operation.column) })}
                        >{t("replacementEdit")}</Button>
                    )}
                    <Button variant="ghost" size="icon"
                      disabled={busy || hasUnsupportedSavedOperations || replacementColumn !== null}
                      onClick={() =>
                        changeOperations(
                          operations.filter((_, operationIndex) => operationIndex !== index),
                        )
                      }
                      className="size-8 hover:text-destructive"
                      aria-label={t("removeStepAria", { step: stepLabel(operation) })}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </li>
                ))}
                {readonlyOperations.map((operation, index) => (
                  <li key={operation.key} className="flex items-center gap-3 py-2.5">
                    <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center text-muted-foreground"><Check size={14} /></span>
                    <span className="w-5 shrink-0 font-mono text-xs text-muted-foreground">
                      {String(operations.length + index + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0 flex-1 break-words text-sm text-foreground">
                      {operation.label}
                      {operation.replacements && <TextReplacementSummary replacements={operation.replacements} />}
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {t("importedNote")}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">
                {hasUnsupportedSavedOperations
                  ? t("stepsKept")
                  : initialHadOperations
                  ? t("stepsCleared")
                  : t("stepsPlaceholder")}
              </p>
            )}
          </section>
          {replacementColumn === null && Array.isArray(source.profile_data.sample) && source.profile_data.sample.length > 0 && (
            <div className="mt-8">
              <CleaningSamples title={t("sourceSample")} columnNames={columnNames} preferredColumns={[currentColumn]} before={{
                rows: source.profile_data.sample.length, columns: columns.length, sample: source.profile_data.sample,
              }} />
            </div>
          )}
          </div>
          </div>}

          {preview && (
            <section className="p-7" aria-label={t("previewAria")}>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 ref={reviewHeadingRef} tabIndex={-1} className="text-lg font-semibold text-foreground outline-none">{t("previewTitle")}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {changedCells === null ? t("previewCellCountUnavailable") : t("previewChangedCells", {
                      count: changedCells.toLocaleString(locale),
                    })}
                    {preview.before.rows !== preview.after.rows
                      ? t("previewRowsChange", {
                          before: preview.before.rows.toLocaleString(locale),
                          after: preview.after.rows.toLocaleString(locale),
                        })
                      : t("previewRowsUnchanged")}
                    {preview.before.columns !== preview.after.columns
                      ? t("previewColumnsChange", {
                          before: preview.before.columns,
                          after: preview.after.columns,
                        })
                      : t("previewColumnsUnchanged")}
                  </p>
                </div>
              </div>
              {skippedOperations.length > 0 && <p className="mt-4 text-sm text-muted-foreground">
                {t("skippedApplyNotice", { count: skippedOperations.length })}
              </p>}
              <details className="mt-4 border-y border-border py-3">
                <summary className="cursor-pointer text-xs font-semibold text-foreground">
                  {t("includedSteps")} · {t("stepsSectionCount", { count: activeOperations.length + readonlyOperations.length })}
                </summary>
                <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
                  {activeOperations.map((operation) => <li key={operationKey(operation)} className="break-words">
                    {stepLabel(operation)}
                    {operation.operation === "replace_text_values" && <TextReplacementSummary replacements={operation.replacements} />}
                  </li>)}
                  {readonlyOperations.map((operation) => <li key={operation.key} className="break-words">
                    {operation.label}<span className="ml-2 text-xs text-muted-foreground">{t("importedNote")}</span>
                    {operation.replacements && <TextReplacementSummary replacements={operation.replacements} />}
                  </li>)}
                </ol>
                {activeOperations.length === 0 && <p className="mt-3 text-xs text-muted-foreground">{t("noManualSteps")}</p>}
              </details>
              {skippedOperations.length > 0 && <details className="border-b border-border py-3">
                <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
                  {t("stepSkipped")} · {t("stepsSectionCount", { count: skippedOperations.length })}
                </summary>
                <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                  {skippedOperations.map((operation) => <li key={operationKey(operation)} className="break-words">
                    {stepLabel(operation)}
                    {operation.operation === "replace_text_values" && <TextReplacementSummary replacements={operation.replacements} />}
                  </li>)}
                </ul>
              </details>}
              {changedCells !== null && preview.changes.some((change) => change.changed_count > 0) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {preview.changes.filter((change) => change.changed_count > 0).map((change) => (
                    <span
                      key={change.column}
                      className="bg-success/[0.06] px-2.5 py-1 text-xs text-success"
                    >
                      {t("columnChangeLabel", {
                        column: fieldLabel(change.column),
                        count: change.changed_count.toLocaleString(locale),
                      })}
                    </span>
                  ))}
                </div>
              )}
              <CleaningImpactProfiles preview={preview} columnNames={columnNames} />
              <div className="mt-5">
                <CleaningSamples before={preview.before} after={preview.after} columnNames={columnNames} preferredColumns={[
                  ...preview.changes.filter((change) => change.changed_count > 0).map((change) => change.column),
                  ...activeOperations.flatMap((operation) => "column" in operation ? [operation.column] : []),
                ]} />
              </div>
            </section>
          )}
        </div>
        <footer className="shrink-0 border-t border-border bg-card px-7 py-4">
          {feedback && (
            <div role="alert" className="rounded-md mb-3 border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-xs text-destructive">
              {feedback}
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" onClick={preview ? returnToEditing : () => requestExit("editor")} disabled={preview ? busy : applying}>
              {preview && <ArrowLeft size={15} />}{t(preview ? "backToEditing" : "cancelButton")}
            </Button>
            <div className="flex min-w-0 items-center gap-3">
              {replacementColumn !== null && <p className="text-xs text-muted-foreground">{t("finishReplacement")}</p>}
              {!preview && !initialHadOperations && operations.length > 0 && activeOperations.length === 0 && replacementColumn === null
                && <p role="status" className="text-xs text-muted-foreground">{t("selectStepsToPreview")}</p>}
              {preview && !preview.can_apply && <p role="status" className="text-xs text-muted-foreground">{t("cannotApply")}</p>}
              {(!preview && canPreview) || (preview?.can_apply && !hasUnsupportedSavedOperations) ? (
                <Button disabled={busy || replacementColumn !== null}
                  onClick={() => void (preview ? handleApply() : handlePreview())}
                  className="px-5">
                  {busy ? <Loader2 size={15} className="animate-spin" /> : preview ? <Check size={15} /> : <ArrowRight size={15} />}
                  {t(preview ? "applyButton" : "previewChanges")}
                </Button>
              ) : null}
            </div>
          </div>
        </footer>
      </div>
      {exitRequest && <CleaningDiscardDialog scope={exitRequest} applying={applying} fallbackFocus={headingRef}
        onContinue={() => setExitRequest(null)} onDiscard={() => {
          const action = useProjectStore.getState().cleaningAction;
          if (applying || (action?.sourceId === source.id && action.kind === "apply")) return;
          setExitRequest(null);
          if (exitRequest === "editor") closeEditor();
          else setReplacementColumn(null);
        }} />}
    </dialog>
  );
}
