"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { getErrorMessage, type ConfirmationRequest } from "@/lib/types/api";
import { Button } from "@/components/ui/button";

type Submission =
  | { status: "idle" | "pending" }
  | { status: "failed"; error: string }
  | { status: "accepted"; option: string };

interface BusinessConfirmationProps {
  request: ConfirmationRequest;
  projectId?: string;
  analysisRunId?: string;
  resolvedOption?: string;
  question: string;
  reason: string;
  optionLabel: (option: string) => string;
  onConfirm: (analysisRunId: string, key: string, option: string) => Promise<void>;
}

export function BusinessConfirmation(props: BusinessConfirmationProps) {
  // A changed question is a new decision. Never carry its draft or a late
  // response into another run, even when React reuses the message card.
  const identity = JSON.stringify([
    props.projectId, props.analysisRunId, props.request,
  ]);
  return <ConfirmationForm key={identity} {...props} />;
}

function ConfirmationForm({ request, analysisRunId, resolvedOption, question, reason, optionLabel, onConfirm }: BusinessConfirmationProps) {
  const t = useTranslations("businessConfirmation");
  const tMessage = useTranslations("assistantMessage");
  const id = useId();
  const [selection, setSelection] = useState<string | null>(null);
  const [submission, setSubmission] = useState<Submission>({ status: "idle" });
  const pending = submission.status === "pending";
  const error = submission.status === "failed" ? submission.error : null;
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const ownsFocus = useRef(false);
  const receipt = useRef<HTMLDivElement>(null);
  const confirmed = resolvedOption ?? (submission.status === "accepted" ? submission.option : null);
  const options = Array.from(new Set(request.options));

  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useLayoutEffect(() => {
    if (confirmed !== null && ownsFocus.current) receipt.current?.focus();
  }, [confirmed]);

  const submit = async () => {
    if (inFlight.current || confirmed !== null || selection === null || !options.includes(selection)) return;
    if (!analysisRunId) {
      setSubmission({ status: "failed", error: tMessage("resumeMissing") });
      return;
    }
    inFlight.current = true;
    setSubmission({ status: "pending" });
    try {
      await onConfirm(analysisRunId, request.key, selection);
      if (mounted.current) setSubmission({ status: "accepted", option: selection });
    } catch (failure) {
      if (mounted.current) setSubmission({ status: "failed", error: getErrorMessage(failure) });
    } finally {
      inFlight.current = false;
    }
  };

  return <section
    className="business-confirmation mt-7 min-w-0 overflow-hidden rounded-xl border border-border bg-card"
    aria-labelledby={`${id}-question`}
    data-testid="business-confirmation"
    onFocusCapture={() => { ownsFocus.current = true; }}
    onBlurCapture={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) ownsFocus.current = false;
    }}
  >
    {confirmed !== null ? <div ref={receipt} tabIndex={-1} className="px-6 py-5 focus:outline-none">
      <div className="flex items-center gap-2 text-xs font-semibold text-primary"><Check size={15} aria-hidden="true" />{t("confirmed")}</div>
      <h3 id={`${id}-question`} className="mt-3 break-words text-sm font-medium leading-6">{question}</h3>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{optionLabel(confirmed)}</p>
    </div> : <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={pending} aria-describedby={`${reason ? `${id}-reason ` : ""}${id}-hint${error ? ` ${id}-error` : ""}`} className="min-w-0 px-6 py-5">
        <legend className="sr-only">{question}</legend>
        <p className="text-[11px] font-semibold text-primary">{t("title")}</p>
        <h3 id={`${id}-question`} className="mt-3 whitespace-pre-wrap break-words text-lg font-semibold leading-7 tracking-tight">{question}</h3>
        {reason && <p id={`${id}-reason`} className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{reason}</p>}
        <p id={`${id}-hint`} className="mb-3 mt-5 text-xs text-muted-foreground">{t("chooseOne")}</p>
        <div className="space-y-2">
          {options.map((option) => <label key={option} className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-md border px-3 py-2 text-sm leading-6 transition-colors motion-reduce:transition-none focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 ${selection === option ? "border-primary bg-primary/[0.05]" : "border-border hover:border-primary/50 hover:bg-muted/40"} ${pending ? "cursor-wait" : ""}`}>
            <input type="radio" name={`${id}-option`} value={option} checked={selection === option}
              onChange={() => { if (!inFlight.current) { setSelection(option); setSubmission({ status: "idle" }); } }}
              className="mt-1 size-4 shrink-0 accent-primary" />
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{optionLabel(option)}</span>
          </label>)}
        </div>
      </fieldset>
      <div className="border-t border-border px-6 py-4">
        {error && <p id={`${id}-error`} role="alert" className="mb-3 break-words text-sm leading-6 text-destructive">{error}</p>}
        <Button type="submit" disabled={selection === null} aria-disabled={pending} aria-busy={pending}
          className="aria-disabled:cursor-wait">
          {pending ? t("submitting") : t("submit")}
          {pending ? <Loader2 size={16} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <ArrowRight size={16} aria-hidden="true" />}
        </Button>
      </div>
    </form>}
  </section>;
}
