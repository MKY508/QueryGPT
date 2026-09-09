"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ArrowUp, Database, Loader2, Maximize2, Paperclip, Square } from "lucide-react";
import type { ModelSummary } from "@/lib/types/api";
import { cn } from "@/lib/utils";
import { FILE_UPLOAD_ACCEPT } from "@/lib/file-formats";
import { Button } from "@/components/ui/button";
import { AnalysisServiceSelector } from "./AnalysisServiceSelector";
import { QuestionEditorDialog, questionCursor, type QuestionCursor } from "./QuestionEditorDialog";

interface InputBarProps {
  onSubmit: (query: string) => Promise<boolean | void>;
  onStop: () => void;
  onOpenData: () => void;
  onUploadFile: (file: File) => void;
  onUploadFiles?: (files: File[]) => void;
  uploadStatus?: ReactNode;
  isLoading: boolean;
  isStopping?: boolean;
  isUploading: boolean;
  projectName?: string;
  contextKey?: string;
  onRevealComposer?: () => void;
  dataReady: boolean;
  sourceCount: number;
  input: string;
  onInputChange: (value: string) => void;
  onAccepted?: () => void;
  disabled?: boolean;
  draftUnretained?: boolean;
  draftUnreadable?: boolean;
  onRetryDraftRetention?: () => void;
  placement?: "dock" | "surface";
  analysisServices?: ModelSummary[];
  selectedAnalysisServiceId?: string | null;
  onSelectAnalysisService?: (modelId: string) => void | Promise<void>;
  onManageAnalysisServices?: () => void;
  analysisServiceLocked?: boolean;
  analysisServiceSaving?: boolean;
  analysisServiceError?: string | null;
  analysisServiceSelectorOpen?: boolean;
  onAnalysisServiceSelectorOpenChange?: (open: boolean) => void;
}

export function InputBar(props: InputBarProps) {
  return <InputBarSession key={props.contextKey ?? "composer"} {...props} />;
}

function InputBarSession({
  onSubmit,
  onStop,
  onOpenData,
  onUploadFile,
  onUploadFiles,
  uploadStatus,
  isLoading,
  isStopping = false,
  isUploading,
  projectName,
  onRevealComposer,
  sourceCount,
  input,
  onInputChange,
  onAccepted,
  disabled = false,
  draftUnretained = false,
  draftUnreadable = false,
  onRetryDraftRetention,
  placement = "dock",
  analysisServices,
  selectedAnalysisServiceId = null,
  onSelectAnalysisService,
  onManageAnalysisServices,
  analysisServiceLocked = false,
  analysisServiceSaving = false,
  analysisServiceError,
  analysisServiceSelectorOpen,
  onAnalysisServiceSelectorOpenChange,
}: InputBarProps) {
  const t = useTranslations("inputBar");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [submitFailed, setSubmitFailed] = useState(false);
  const [editorCursor, setEditorCursor] = useState<QuestionCursor | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const submitting = useRef(false), mounted = useRef(false);
  const currentInput = useRef(input), inputRevision = useRef(0);
  useLayoutEffect(() => { if (currentInput.current !== input) { currentInput.current = input; inputRevision.current++; } }, [input]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const acceptFiles = (files: File[]) => {
    if (!files.length) return;
    if (onUploadFiles) onUploadFiles(files);
    else files.forEach(onUploadFile);
  };
  const changeInput = (value: string) => {
    setSubmitFailed(false); currentInput.current = value; inputRevision.current++; onInputChange(value);
  };
  const closeEditor = () => { setEditorCursor(null); onRevealComposer?.(); };

  const submit = async () => {
    if (disabled) return;
    if (isLoading) {
      if (!isStopping) onStop();
      return;
    }
    if (!input.trim() || submitting.current) return;
    const submittedInput = input, revision = inputRevision.current;
    submitting.current = true;
    setIsSubmitting(true);
    setSubmitFailed(false);
    try {
      const accepted = await onSubmit(submittedInput.trim());
      if (accepted !== false) {
        if (onAccepted) onAccepted();
        else if (mounted.current && currentInput.current === submittedInput && inputRevision.current === revision) onInputChange("");
      }
    } catch {
      if (mounted.current) setSubmitFailed(true);
    } finally {
      submitting.current = false;
      if (mounted.current) setIsSubmitting(false);
    }
  };

  return (
    <div
      className={cn(
        placement === "dock"
          ? "border-t border-border bg-background px-7 pb-5 pt-3"
          : "bg-transparent"
      )}
    >
      <div className={cn(placement === "dock" ? "mx-auto max-w-[1080px]" : "w-full")}>
        {uploadStatus}
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setIsDragging(false);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            acceptFiles(Array.from(event.dataTransfer.files ?? []));
          }}
          className={cn(
            "relative overflow-visible rounded-xl border bg-card transition-[border-color,background-color] focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10",
            isDragging ? "border-primary bg-primary/[0.03]" : "border-border"
          )}
        >
          {isDragging && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-card/95 text-sm font-semibold text-primary">
              {t("dropHint")}
            </div>
          )}
          <textarea ref={inputRef}
            value={input}
            onChange={(event) => changeInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                event.preventDefault();
                void submit();
              }
            }}
            data-testid="chat-input"
            aria-label={t("placeholder")}
            placeholder={t("placeholder")}
            disabled={isLoading || disabled}
            rows={2}
            className={cn(
              "max-h-44 w-full resize-none bg-transparent pb-2 pl-4 pr-12 pt-4 text-[15px] leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60",
              placement === "surface" ? "min-h-[122px]" : "min-h-[76px]"
            )}
          />
          <Button variant="ghost" size="icon" disabled={disabled || isLoading || isSubmitting} aria-haspopup="dialog" aria-label={t("expandEditor")} title={t("expandEditor")}
            onClick={() => { if (!inputRef.current || disabled || isLoading || submitting.current) return; onAnalysisServiceSelectorOpenChange?.(false); setEditorCursor(questionCursor(inputRef.current)); }}
            className="absolute right-1.5 top-1.5 size-8 text-muted-foreground hover:text-primary"><Maximize2 size={14} /></Button>
          <div className="flex flex-wrap items-center justify-between gap-3 px-3 pb-3">
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={FILE_UPLOAD_ACCEPT}
                className="hidden"
                onChange={(event) => {
                  const files = Array.from(event.currentTarget.files ?? []);
                  event.currentTarget.value = "";
                  acceptFiles(files);
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                disabled={isUploading}
                onClick={() => fileInputRef.current?.click()}
                aria-label={isUploading ? t("uploadingFileLabel") : t("addFileLabel")}
                className="gap-1.5 px-2 text-xs"
              >
                {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />}
                <span>{isUploading ? t("uploading") : t("file")}</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onOpenData}
                data-testid="chat-data-source-button"
                className="gap-1.5 px-2 text-xs"
              >
                <Database size={14} />
                <span>
                  {t("dataSourceDesktop")}{sourceCount > 0 ? ` · ${sourceCount}` : ""}
                </span>
              </Button>
              {analysisServices && onSelectAnalysisService && onManageAnalysisServices && (
                <AnalysisServiceSelector
                  models={analysisServices}
                  selectedModelId={selectedAnalysisServiceId}
                  onSelect={onSelectAnalysisService}
                  onManage={onManageAnalysisServices}
                  locked={analysisServiceLocked}
                  saving={analysisServiceSaving}
                  error={analysisServiceError}
                  open={analysisServiceSelectorOpen}
                  onOpenChange={onAnalysisServiceSelectorOpenChange}
                />
              )}
            </div>
            <Button
              variant={isLoading ? "destructive" : "primary"}
              size="icon"
              onClick={() => void submit()}
              disabled={disabled || isStopping || (!input.trim() && !isLoading) || (isSubmitting && !isLoading)}
              data-testid="chat-submit"
              aria-label={
                isStopping
                  ? t("stoppingAnalysisAria")
                  : isLoading
                    ? t("stopAnalysisAria")
                    : isSubmitting ? t("sendingAria")
                    : t("startAnalysisAria")
              }
            >
              {isStopping || (isSubmitting && !isLoading) ? (
                <Loader2 size={15} className="animate-spin" />
              ) : isLoading ? (
                <Square size={15} fill="currentColor" />
              ) : (
                <ArrowUp size={18} />
              )}
            </Button>
          </div>
        </div>
        {(submitFailed || draftUnretained || draftUnreadable) && <div role="alert" className="mt-2 flex flex-wrap items-center justify-between gap-x-3 text-xs leading-5 text-destructive">
          <p>{t(draftUnretained ? "draftUnretained" : draftUnreadable ? "draftUnreadable" : "submitFailed")}</p>
          {(draftUnretained || draftUnreadable) && onRetryDraftRetention && <Button variant="ghost" size="sm" onClick={onRetryDraftRetention}>{t("retryDraftRetention")}</Button>}
        </div>}
      </div>
      {editorCursor && <QuestionEditorDialog value={input} projectName={projectName}
        cursor={editorCursor} origin={inputRef} canReturn={() => mounted.current}
        disabled={disabled || isLoading} onChange={changeInput} onClose={closeEditor}
        warning={draftUnretained ? "draftUnretained" : draftUnreadable ? "draftUnreadable" : null} onRetry={onRetryDraftRetention} />}
    </div>
  );
}
