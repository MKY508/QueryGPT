"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  ClipboardCheck,
  FilePlus2,
  FolderCheck,
  LayoutDashboard,
  ExternalLink,
  MessageSquareWarning,
  RefreshCw,
} from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { AnalysisMetrics, AnalysisFindings, AnalysisSuggestions } from "./AnalysisReportHighlights";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import type { ChatMessage } from "@/lib/types/chat";
import type {
  AnalysisArtifact,
  AnalysisCorrection,
  AnalysisCorrectionSelection,
  AnalysisCorrectionTarget,
  AnalysisCorrectionTargetOption,
  CorrectionApplication,
} from "@/lib/types/api";
import { getErrorMessage } from "@/lib/types/api";
import { api } from "@/lib/api/client";
import { normalizeChartSpec } from "@/lib/charts";
import { useProjectStore } from "@/lib/stores/project";
import { getInvestigationErrorRecovery } from "@/lib/stores/chat-helpers";
import { ChartDisplay } from "./ChartDisplay";
import { DataTable } from "./DataTable";
import { SavedAnalysisArtifacts } from "./SavedAnalysisArtifacts";
import { BusinessConfirmation } from "./BusinessConfirmation";

interface AssistantMessageCardProps {
  message: ChatMessage;
  index: number;
  onRetry: (index: number) => void;
  onRerun: (index: number) => void;
  onUsePrompt: (prompt: string) => void;
  onRunPrompt?: (prompt: string, options?: { correctionId?: string }) => void;
  onConfirm: (
    analysisRunId: string,
    key: string,
    selectedOption: string,
  ) => Promise<void>;
  onOpenData: () => void;
  onOpenUnderstanding?: () => void;
  onChangeAnalysisService?: (messageIndex: number) => void;
  onManageAnalysisServices?: (messageIndex: number) => void;
}

interface SavedPlaybookSummary {
  name?: string;
  validation?: {
    numeric_columns?: string[];
  };
}

function getStandingErrorMessage(
  error: unknown,
  t: (key: string) => string,
): string {
  const status = (
    error as { response?: { status?: unknown } } | null | undefined
  )?.response?.status;
  if (status === 409 || status === 422) {
    return t("standingStartFailed");
  }
  return t("standingRetry");
}

type CorrectionState = "idle" | "saving" | "saved" | "deleting";
type CorrectionKind = AnalysisCorrection["correction_type"];

function buildCorrectionKinds(
  t: (key: string) => string,
): Array<{
  value: CorrectionKind;
  label: string;
  description: string;
  placeholder: string;
}> {
  return [
    {
      value: "business_rule",
      label: t("correctionKindBusiness"),
      description: t("correctionKindBusinessDesc"),
      placeholder: t("correctionKindBusinessExample"),
    },
    {
      value: "metric_definition",
      label: t("correctionKindMetric"),
      description: t("correctionKindMetricDesc"),
      placeholder: t("correctionKindMetricExample"),
    },
    {
      value: "filter_rule",
      label: t("correctionKindFilter"),
      description: t("correctionKindFilterDesc"),
      placeholder: t("correctionKindFilterExample"),
    },
    {
      value: "relationship_rule",
      label: t("correctionKindRelation"),
      description: t("correctionKindRelationDesc"),
      placeholder: t("correctionKindRelationExample"),
    },
    {
      value: "interpretation",
      label: t("correctionKindInterpretation"),
      description: t("correctionKindInterpretationDesc"),
      placeholder: t("correctionKindInterpretationExample"),
    },
  ];
}

function correctionKindLabel(
  kind: CorrectionKind | undefined,
  t: (key: string) => string,
): string {
  return (
    buildCorrectionKinds(t).find((item) => item.value === kind)?.label ||
    t("correctionKindBusiness")
  );
}

function ordinaryReceiptText(value?: string | null): string | null {
  if (!value) return null;
  if (/\b(sql|python|schema|json|tool|agent|token|api)\b/i.test(value))
    return null;
  return value;
}

function sameLanguageReceiptText(
  value: string | null | undefined,
  locale: string,
): string | null {
  const ordinary = ordinaryReceiptText(value);
  if (!ordinary) return null;
  const containsCjk = /[\u3400-\u9fff]/u.test(ordinary);
  return locale.toLowerCase().startsWith("en") === containsCjk ? null : ordinary;
}

function correctionReceiptSummary(
  receipt: CorrectionApplication | undefined,
  t: (key: string) => string,
): string | null {
  switch (receipt?.summary_code) {
    case "correction_verified":
      return t("receiptSummaryVerified");
    case "correction_relationship_verified":
      return t("receiptSummaryRelationshipVerified");
    case "correction_definition_only":
      return t("receiptSummaryDefinitionOnly");
    case "correction_failed":
      return t("receiptSummaryFailed");
    default:
      return null;
  }
}

function CorrectionApplicationReceipt({
  receipt,
}: {
  receipt: CorrectionApplication;
}) {
  const t = useTranslations("assistantMessage");
  const locale = useLocale();
  const verified = receipt.status === "verified";
  const failed = receipt.status === "failed";
  const receiptCheckLabels: Record<string, string> = {
    business_definition_recorded: t("receiptLabelDefinitionSaved"),
    current_definition_applied: t("receiptLabelUsingCurrent"),
    application_reaches_final_result: t("receiptLabelCorrectionApplied"),
    final_result_revalidated: t("receiptLabelFinalRechecked"),
    required_metric_used_by_final_aggregate: t("receiptLabelMetricRechecked"),
    current_relationship_definition_tested: t("receiptLabelRelationApplied"),
    relationship_validation_passed: t("receiptLabelRelationValidated"),
    full_relation_reusable_proof: t("receiptLabelRelationReusable"),
    join_reaches_final_result: t("receiptLabelRelationIntegrated"),
    final_result_revalidated_after_join: t("receiptLabelFinalAfterRelation"),
  };
  const ordinaryReceiptCheck = (value: string): string | null => {
    const mapped = receiptCheckLabels[value];
    if (mapped) return mapped;
    return sameLanguageReceiptText(value, locale);
  };
  const title = verified
    ? t("appliedCurrentData")
    : failed
      ? t("notRechecked")
      : t("rememberedNotVerified");
  const fallback = verified
    ? t("appliedVerifiedDesc")
    : failed
      ? t("insufficientEvidence")
      : t("pendingReuseDesc");
  const summary =
    correctionReceiptSummary(receipt, t) ||
    sameLanguageReceiptText(receipt.summary, locale) ||
    fallback;
  const checks = (Array.isArray(receipt.checks) ? receipt.checks : [])
    .map(ordinaryReceiptCheck)
    .filter((item): item is string => Boolean(item));

  return (
    <section
      aria-label={t("correctionReviewAria")}
      role={failed ? "alert" : "status"}
      className={`relative mt-5 border-y px-5 py-4 pl-6 ${
        verified
          ? "border-success/30 bg-success/[0.04]"
          : failed
            ? "border-destructive/30 bg-destructive/[0.05]"
            : "border-warning/30 bg-warning/[0.05]"
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute bottom-3 left-0 top-3 w-[3px] ${
          verified ? "bg-success" : failed ? "bg-destructive" : "bg-warning"
        }`}
      />
      <div className="flex items-start gap-3">
        {verified ? (
          <CheckCircle2
            size={17}
            className="mt-0.5 shrink-0 text-success"
          />
        ) : (
          <AlertCircle
            size={17}
            className={`mt-0.5 shrink-0 ${failed ? "text-destructive" : "text-warning"}`}
          />
        )}
        <div className="min-w-0">
          <h3
            className={`text-sm font-semibold ${
              verified
                ? "text-success"
                : failed
                  ? "text-destructive"
                  : "text-warning"
            }`}
          >
            {title}
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {summary}
          </p>
          {checks.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs leading-5 text-foreground/85">
              {checks.map((check, checkIndex) => (
                <li key={`${check}-${checkIndex}`} className="flex gap-2">
                  <span
                    className={verified ? "text-success" : "text-destructive"}
                  >
                    ·
                  </span>
                  <span>{check}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

export function AssistantMessageCard(props: AssistantMessageCardProps) {
  const { message, index } = props;
  const identity = JSON.stringify([message.projectId ?? null, message.analysisRunId || message.id || index]);
  return <AssistantMessageSession key={identity} {...props} />;
}

function AssistantMessageSession({
  message,
  index,
  onRetry,
  onRerun,
  onUsePrompt,
  onRunPrompt,
  onConfirm,
  onOpenData,
  onOpenUnderstanding,
  onChangeAnalysisService,
  onManageAnalysisServices,
}: AssistantMessageCardProps) {
  const t = useTranslations("assistantMessage");
  const tConfirmation = useTranslations("businessConfirmation");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const refreshProject = useProjectStore((state) => state.refreshCurrent);
  const projectKnowledge = useProjectStore((state) => state.knowledge);
  const [playbookState, setPlaybookState] = useState<
    "idle" | "saving" | "saved"
  >("idle");
  const [playbookError, setPlaybookError] = useState<string | null>(null);
  const [savedPlaybook, setSavedPlaybook] =
    useState<SavedPlaybookSummary | null>(null);
  const [standingState, setStandingState] = useState<
    "idle" | "saving" | "saved"
  >("idle");
  const [standingError, setStandingError] = useState<string | null>(null);
  const [savedArtifactsOpen, setSavedArtifactsOpen] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionText, setCorrectionText] = useState("");
  const [correctionKind, setCorrectionKind] =
    useState<CorrectionKind>("business_rule");
  const [correctionTargetRef, setCorrectionTargetRef] = useState<string | null>(
    null,
  );
  const [correctionSelection, setCorrectionSelection] =
    useState<AnalysisCorrectionSelection | null>(null);
  const [draftReusable, setCorrectionReusable] = useState(false);
  const [correctionMutationState, setCorrectionState] =
    useState<Exclude<CorrectionState, "saved">>("idle");
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const correctionIdentityRef = useRef("");
  const correctionIdentity = `${message.projectId || ""}:${message.analysisRunId || ""}`;
  useLayoutEffect(() => {
    correctionIdentityRef.current = correctionIdentity;
    return () => { correctionIdentityRef.current = ""; };
  }, [correctionIdentity]);
  const report = message.report;
  const localizedPreflightConfirmation = (() => {
    const confirmation = report?.confirmation;
    if (!confirmation) return null;
    const code =
      confirmation.presentation_code ||
      (confirmation.key === "revenue_refund_policy"
        ? "preflight.revenue_refund_policy"
        : confirmation.key === "excel_sheet_selection" ||
            confirmation.key.startsWith("excel_sheet_selection:")
          ? "preflight.excel_sheet_selection"
          : "");
    if (code === "preflight.revenue_refund_policy") {
      const legacyCodes: Record<string, string> = {
        "扣除退款": "exclude_refunds",
        "保留退款订单": "include_refunds",
        "按现有净额字段": "use_existing_net_amount",
      };
      const optionLabel = (option: string) => {
        const optionCode = confirmation.option_codes?.[option] || legacyCodes[option];
        if (optionCode === "exclude_refunds") return t("preflightRefundExcludeOption");
        if (optionCode === "include_refunds") return t("preflightRefundIncludeOption");
        if (optionCode === "use_existing_net_amount") {
          return t("preflightRefundNetAmountOption");
        }
        return option;
      };
      return {
        title: t("preflightConfirmationTitle"),
        question: t("preflightRefundQuestion"),
        reason: t("preflightRefundReason"),
        optionLabel,
      };
    }
    if (code === "preflight.excel_sheet_selection") {
      const selectedSheet = confirmation.presentation_facts?.selected_sheet?.trim();
      return {
        title: t("preflightConfirmationTitle"),
        question: selectedSheet
          ? t("preflightExcelQuestionSelected", { sheet: selectedSheet })
          : t("preflightExcelQuestion"),
        reason: t("preflightExcelReason"),
        optionLabel: (option: string) => option,
      };
    }
    return null;
  })();
  const correctionApplicationFailed =
    message.correctionApplication?.status === "failed";
  const hasError = Boolean(message.hasError || correctionApplicationFailed);
  const errorRecovery = getInvestigationErrorRecovery(
    message.errorCode,
    message.errorCategory,
  );
  const needsAnalysisServiceChange =
    hasError && errorRecovery === "change_analysis_service";
  const analysisServiceFailureReason = (() => {
    switch (message.errorCode) {
      case "MODEL_AUTH_ERROR":
        return t("authExpired");
      case "MODEL_ENDPOINT_ERROR":
        return t("connectionUnavailable");
      case "MODEL_NOT_FOUND":
      case "MODEL_NOT_FOUND_ERROR":
        return t("serviceUnsupported");
      case "MODEL_FORMAT_ERROR":
        return t("serviceResponseInvalid");
      case "MODEL_SELECTION_CONFLICT":
        return t("serviceLocked");
      default:
        return t("serviceBusy");
    }
  })();
  const failureTitle = correctionApplicationFailed
    ? t("stateCorrectionPending")
    : needsAnalysisServiceChange
      ? t("stateServiceUnavailable")
      : message.resumable
        ? t("stateInvestigationPaused")
        : t("stateInvestigationIncomplete");
  const failureReason = (() => {
    if (correctionApplicationFailed) {
      return (
        correctionReceiptSummary(message.correctionApplication, t) ||
        sameLanguageReceiptText(message.correctionApplication?.summary, locale) ||
        t("insufficientRecheck")
      );
    }
    if (needsAnalysisServiceChange) return analysisServiceFailureReason;

    const code = (message.errorCode || "").toUpperCase();
    const category = (message.errorCategory || "").toLowerCase();
    if (code.includes("TIMEOUT") || category === "timeout") {
      return t("serviceNoResponse");
    }
    if (code.includes("RATE_LIMIT") || category === "rate_limited") {
      return t("serviceBusyShort");
    }
    if (code.includes("CONNECTION") || category === "connection") {
      return t("serviceConnectFailed");
    }
    return message.resumable
      ? t("progressKept")
      : t("processingError");
  })();
  const needsData = report?.status === "needs_data";
  const needsDecision = Boolean(report?.confirmation && !message.confirmationResolved);
  const wasStopped =
    message.analysisState === "needs_attention" &&
    !message.hasError &&
    !needsData;
  const canResume =
    wasStopped && Boolean(message.canRetry && message.resumable);
  const nextActions = report?.next_actions || [];
  const canCorrectReport = Boolean(
    message.projectId &&
    message.analysisRunId &&
    !hasError &&
    !needsData &&
    (report?.status === "completed" || message.analysisState === "completed"),
  );
  const {
    data: artifacts = [],
    isError: artifactsFailed,
    refetch: refetchArtifacts,
  } = useQuery<AnalysisArtifact[]>({
    queryKey: ["artifacts", message.projectId, message.analysisRunId],
    queryFn: async () => {
      const response = await api.get(
        `/api/v1/projects/${message.projectId}/analysis-runs/${message.analysisRunId}/artifacts`,
      );
      return response.data.data as AnalysisArtifact[];
    },
    enabled: Boolean(message.projectId && message.analysisRunId),
    staleTime: 30_000,
  });
  const correctionQueryKey = [
    "analysis-corrections",
    message.projectId,
  ] as const;
  const { data: projectCorrections = [], isPending: correctionsPending } =
    useQuery<AnalysisCorrection[]>({
      queryKey: correctionQueryKey,
      queryFn: async () => {
        const response = await api.get(
          `/api/v1/projects/${message.projectId}/corrections`,
        );
        return response.data.data as AnalysisCorrection[];
      },
      enabled: Boolean(message.projectId),
      staleTime: 30_000,
    });
  const {
    data: correctionTargets = [],
    isFetching: correctionTargetsFetching,
    isError: correctionTargetsFailed,
  } = useQuery<AnalysisCorrectionTarget[]>({
    queryKey: [
      "analysis-correction-targets",
      message.projectId,
      message.analysisRunId,
    ],
    queryFn: async () => {
      const response = await api.get(
        `/api/v1/projects/${message.projectId}/analysis-runs/${message.analysisRunId}/correction-targets`,
      );
      return response.data.data as AnalysisCorrectionTarget[];
    },
    enabled: canCorrectReport && correctionOpen,
    retry: false,
    staleTime: 30_000,
  });
  const persistedCorrection = projectCorrections.find(
    (item) => item.analysis_run_id === message.analysisRunId,
  );
  // Saved presentation follows the query; an open editor owns its draft.
  const correctionState: CorrectionState = correctionMutationState !== "idle" ? correctionMutationState
    : !correctionOpen && persistedCorrection ? "saved" : "idle";
  const correctionReusable = !correctionOpen && persistedCorrection ? persistedCorrection.scope === "project" : draftReusable;
  const selectedCorrectionTarget = correctionTargets.find(
    (target) => target.target_ref === correctionTargetRef,
  );
  const ownsPersistedCorrectionTarget = Boolean(
    correctionTargetRef &&
    persistedCorrection?.target_ref === correctionTargetRef,
  );
  const hasBoundCorrectionTarget = Boolean(
    selectedCorrectionTarget || ownsPersistedCorrectionTarget,
  );
  const boundCorrectionType =
    selectedCorrectionTarget?.correction_type ||
    (ownsPersistedCorrectionTarget
      ? persistedCorrection?.correction_type
      : undefined);
  const {
    data: correctionTargetOptions = [],
    isFetching: correctionTargetOptionsFetching,
    isError: correctionTargetOptionsFailed,
  } = useQuery<AnalysisCorrectionTargetOption[]>({
    queryKey: [
      "analysis-correction-target-options",
      message.projectId,
      message.analysisRunId,
      correctionTargetRef,
    ],
    queryFn: async () => {
      const response = await api.get(
        `/api/v1/projects/${message.projectId}/analysis-runs/${message.analysisRunId}/correction-targets/${encodeURIComponent(
          correctionTargetRef || "",
        )}/options`,
      );
      return response.data.data as AnalysisCorrectionTargetOption[];
    },
    enabled: Boolean(
      canCorrectReport &&
      correctionOpen &&
      correctionTargetRef &&
      boundCorrectionType === "metric_definition",
    ),
    retry: false,
    staleTime: 30_000,
  });
  const validMetricSelection: AnalysisCorrectionSelection | null =
    !correctionTargetOptionsFailed &&
    correctionSelection?.kind === "metric_column" &&
    correctionTargetOptions.some(
      (option) => option.field_ref === correctionSelection.field_ref,
    )
      ? correctionSelection
      : null;
  const soleMetricSelection: AnalysisCorrectionSelection | null =
    !correctionTargetOptionsFailed && correctionTargetOptions.length === 1
      ? {
          kind: "metric_column",
          field_ref: correctionTargetOptions[0].field_ref,
        }
      : null;
  const effectiveMetricSelection = validMetricSelection || soleMetricSelection;
  const metricSelectionRequired = Boolean(
    correctionReusable &&
    boundCorrectionType === "metric_definition" &&
    !correctionTargetOptionsFailed &&
    correctionTargetOptions.length > 1 &&
    !effectiveMetricSelection,
  );
  const metricSelectionPending = Boolean(
    correctionReusable &&
    boundCorrectionType === "metric_definition" &&
    correctionTargetOptionsFetching,
  );
  const linkedProjectKnowledge = persistedCorrection?.semantic_entry_id
    ? projectKnowledge.find(
        (entry) => entry.id === persistedCorrection.semantic_entry_id,
      )
    : undefined;
  const currentCorrectionText =
    linkedProjectKnowledge?.value ||
    persistedCorrection?.text ||
    correctionText;
  const correctionPromoted = Boolean(
    persistedCorrection?.state === "promoted" &&
    persistedCorrection.semantic_entry_id,
  );
  const projectCorrectionInactive =
    linkedProjectKnowledge?.validity === "stale";
  const correctionExecutionState =
    linkedProjectKnowledge?.execution_state ||
    (projectCorrectionInactive ? "blocked" : "definition_only");
  const correctionExecutionVerified = correctionExecutionState === "verified";
  const correctionExecutionBlocked = correctionExecutionState === "blocked";

  const savedFiles = artifacts.filter(
    (artifact) => typeof artifact.payload.relative_path === "string",
  );
  const visualization =
    message.visualization || report?.visualization || undefined;
  const pythonImages = (message.pythonImages || []).filter(
    (image) => image.trim().length > 0,
  );
  const structuredVisualization =
    pythonImages.length === 0 ? normalizeChartSpec(visualization) : null;
  const hasValidatedResult = Boolean(
    message.toolHistory?.some((item) => item.kind === "validation"),
  );
  const canSavePlaybook = Boolean(
    !hasError &&
    report?.status === "completed" &&
    message.projectId &&
    message.analysisRunId &&
    hasValidatedResult,
  );
  const partialSummary =
    localizedPreflightConfirmation?.reason ||
    report?.summary ||
    (message.content && message.content !== message.errorMessage
      ? message.content
      : "");
  const summaryDuplicatesConfirmation = Boolean(report?.confirmation &&
    partialSummary === (localizedPreflightConfirmation?.reason || report.confirmation.reason));
  const runPrompt = onRunPrompt || onUsePrompt;
  const correctionKinds = buildCorrectionKinds(t);

  const correctedInvestigationPrompt = () => {
    const originalQuestion =
      message.originalQuery || report?.title || t("previousRunFallback");
    return [
      t("rerunWithCorrection", { question: originalQuestion }),
      t("rerunCorrectionLine", { correction: correctionText.trim() }),
      t("rerunRecheckNote"),
    ].join("\n");
  };

  const handleLatestDataRerun = () => {
    if (canResume) {
      onRetry(index);
      return;
    }

    const reusableCorrection =
      persistedCorrection?.scope === "project" ? persistedCorrection : null;
    const originalQuestion = message.originalQuery?.trim();
    if (reusableCorrection && originalQuestion) {
      runPrompt(originalQuestion, { correctionId: reusableCorrection.id });
      return;
    }

    onRerun(index);
  };

  const handleSavePlaybook = async () => {
    if (
      !message.projectId ||
      !message.analysisRunId ||
      playbookState === "saving"
    )
      return;
    setPlaybookState("saving");
    setPlaybookError(null);
    try {
      const response = await api.post(
        `/api/v1/projects/${message.projectId}/analysis-playbooks`,
        {
          analysis_run_id: message.analysisRunId,
        },
      );
      setSavedPlaybook(response.data.data as SavedPlaybookSummary);
      setPlaybookState("saved");
    } catch (error) {
      setPlaybookState("idle");
      setPlaybookError(getErrorMessage(error));
    }
  };

  const handleCreateStanding = async () => {
    if (
      !message.projectId ||
      !message.analysisRunId ||
      standingState === "saving" ||
      !savedPlaybook
    ) {
      return;
    }
    const numericColumns = (savedPlaybook.validation?.numeric_columns || [])
      .filter((column) => column.trim())
      .slice(0, 10);
    if (!numericColumns.length) {
      setStandingError(t("noComparableStanding"));
      return;
    }

    setStandingState("saving");
    setStandingError(null);
    try {
      await api.post(
        `/api/v1/projects/${message.projectId}/standing-analyses`,
        {
          analysis_run_id: message.analysisRunId,
          name: report?.title || savedPlaybook.name || t("standingDefaultName"),
          overdue_after_seconds: 86400,
          materiality: {
            version: 1,
            match: "any",
            percent_unit: "ratio",
            top_driver_limit: 10,
            rules: numericColumns.map((metric, index) => ({
              id: `rule_metric_${index + 1}`,
              metric,
              scope: "either",
              direction: "any",
              change_kind: "percent",
              threshold: 0.1,
            })),
          },
        },
      );
      setStandingState("saved");
      await queryClient.invalidateQueries({
        queryKey: ["standing-analyses", message.projectId],
      });
    } catch (error) {
      setStandingState("idle");
      setStandingError(getStandingErrorMessage(error, t));
    }
  };

  const handleSaveCorrection = async () => {
    const correction = correctionText.trim();
    const requestProjectId = message.projectId;
    const requestAnalysisRunId = message.analysisRunId;
    const requestIdentity = correctionIdentity;
    if (
      !requestProjectId ||
      !requestAnalysisRunId ||
      !correction ||
      correctionState === "saving" ||
      (correctionReusable && !hasBoundCorrectionTarget) ||
      metricSelectionPending ||
      metricSelectionRequired
    ) {
      return;
    }
    setCorrectionState("saving");
    setCorrectionError(null);
    const requestCorrectionQueryKey = [
      "analysis-corrections",
      requestProjectId,
    ] as const;
    try {
      await queryClient.cancelQueries({ queryKey: requestCorrectionQueryKey });
      const payload = {
        analysis_run_id: requestAnalysisRunId,
        text: correction,
        correction_type: correctionKind,
        target_ref: correctionTargetRef,
        selection:
          correctionReusable && boundCorrectionType === "metric_definition"
            ? effectiveMetricSelection
            : null,
        scope: correctionReusable ? "project" : "run",
        report_title: report?.title,
      };
      const response = persistedCorrection
        ? await api.put(
            `/api/v1/projects/${requestProjectId}/corrections/${persistedCorrection.id}`,
            payload,
          )
        : await api.post(
            `/api/v1/projects/${requestProjectId}/corrections`,
            payload,
          );
      const savedCorrection = response.data.data as AnalysisCorrection;
      queryClient.setQueryData<AnalysisCorrection[]>(
        requestCorrectionQueryKey,
        (current = []) => [
          savedCorrection,
          ...current.filter((item) => item.id !== savedCorrection.id),
        ],
      );
      await queryClient.invalidateQueries({
        queryKey: requestCorrectionQueryKey,
        refetchType: "none",
      });
      if (correctionIdentityRef.current !== requestIdentity) return;
      setCorrectionText(savedCorrection.text);
      setCorrectionKind(savedCorrection.correction_type);
      setCorrectionTargetRef(savedCorrection.target_ref || correctionTargetRef);
      setCorrectionSelection(savedCorrection.selection || null);
      setCorrectionReusable(savedCorrection.scope === "project");
      setCorrectionState("idle");
      setCorrectionOpen(false);

      if (savedCorrection.scope === "project") {
        await Promise.allSettled([
          refreshProject(),
          queryClient.invalidateQueries({
            queryKey: ["suggested-questions", requestProjectId],
          }),
        ]);
      }
    } catch (error) {
      if (correctionIdentityRef.current !== requestIdentity) return;
      setCorrectionState("idle");
      setCorrectionError(getErrorMessage(error));
    }
  };

  const handleDeleteCorrection = async () => {
    const requestProjectId = message.projectId;
    const requestIdentity = correctionIdentity;
    const requestCorrection = persistedCorrection;
    if (
      !requestProjectId ||
      !requestCorrection ||
      correctionState === "saving" ||
      correctionState === "deleting"
    ) {
      return;
    }
    setCorrectionState("deleting");
    setCorrectionError(null);
    const requestCorrectionQueryKey = [
      "analysis-corrections",
      requestProjectId,
    ] as const;
    try {
      await queryClient.cancelQueries({ queryKey: requestCorrectionQueryKey });
      await api.delete(
        `/api/v1/projects/${requestProjectId}/corrections/${requestCorrection.id}`,
      );
      queryClient.setQueryData<AnalysisCorrection[]>(
        requestCorrectionQueryKey,
        (current = []) =>
          current.filter((item) => item.id !== requestCorrection.id),
      );
      await queryClient.invalidateQueries({
        queryKey: requestCorrectionQueryKey,
        refetchType: "none",
      });
      if (correctionIdentityRef.current !== requestIdentity) return;
      if (requestCorrection.scope === "project") {
        await Promise.allSettled([
          refreshProject(),
          queryClient.invalidateQueries({
            queryKey: ["suggested-questions", requestProjectId],
          }),
        ]);
      }
      setCorrectionText("");
      setCorrectionKind("business_rule");
      setCorrectionTargetRef(null);
      setCorrectionSelection(null);
      setCorrectionReusable(false);
      setCorrectionOpen(false);
      setCorrectionState("idle");
    } catch (error) {
      if (correctionIdentityRef.current !== requestIdentity) return;
      setCorrectionState("idle");
      setCorrectionError(getErrorMessage(error));
    }
  };

  return (
    <article
      data-testid={`assistant-message-card-${index}`}
      className="relative w-full max-w-[920px] overflow-hidden rounded-xl border border-border bg-card"
    >
      <div
        className={hasError ? "px-8 py-6" : "px-8 py-7"}
      >
        {hasError ? (
          <div
            role="alert"
            aria-labelledby={`investigation-error-title-${index}`}
            aria-describedby={`investigation-error-reason-${index}`}
            className="flex items-start justify-between gap-5"
          >
            <div className="flex min-w-0 items-start gap-3">
              <AlertCircle
                aria-hidden="true"
                size={18}
                className="mt-0.5 shrink-0 text-destructive"
              />
              <div className="min-w-0">
                <h2
                  id={`investigation-error-title-${index}`}
                  className="text-lg font-semibold leading-6 tracking-[-0.015em] text-foreground"
                >
                  {failureTitle}
                </h2>
                <p
                  id={`investigation-error-reason-${index}`}
                  className="mt-1 text-sm leading-6 text-muted-foreground"
                >
                  {failureReason}
                </p>
              </div>
            </div>
            {needsAnalysisServiceChange &&
              (onChangeAnalysisService || onManageAnalysisServices) && (
                <div className="flex shrink-0 flex-wrap items-center gap-2 justify-end">
                  {onChangeAnalysisService && (
                    <Button
                      type="button"
                      onClick={() => onChangeAnalysisService(index)}
                      variant="primary"
                    >
                      {t("switchService")}
                    </Button>
                  )}
                  {onManageAnalysisServices && (
                    <Button
                      type="button"
                      onClick={() => onManageAnalysisServices(index)}
                      variant="outline"
                    >
                      {t("settings")}
                    </Button>
                  )}
                </div>
              )}
            {!needsAnalysisServiceChange && message.canRetry && (
              <Button
                type="button"
                onClick={() => onRetry(index)}
                variant="primary" className="self-start"
              >
                {message.resumable ? t("actionContinue") : t("actionRetry")}
              </Button>
            )}
          </div>
        ) : (
          <div className="flex items-start justify-between gap-5">
            <div className="min-w-0">
              <div
                className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em] ${
                  needsData ? "text-warning" : needsDecision ? "text-primary" : "text-success"
                }`}
              >
                {needsData ? (
                  <FilePlus2 size={14} />
                ) : needsDecision ? (
                  <CircleDot size={14} />
                ) : (
                  <CheckCircle2 size={14} />
                )}
                {needsData
                  ? t("phaseWaitingData")
                  : report?.confirmation && message.confirmationResolved
                    ? tConfirmation("confirmed")
                  : message.analysisState === "waiting_confirmation"
                    ? t("phaseWaitingInput")
                    : wasStopped
                      ? t("phaseStopped")
                      : t("reportTitleFallback")}
              </div>
              <h2 className="analysis-report-title mt-2 max-w-2xl text-[26px] font-semibold leading-tight tracking-[-0.035em] text-foreground">
                {(report?.confirmation && message.confirmationResolved ? tConfirmation("recordTitle") : localizedPreflightConfirmation?.title) ||
                  report?.title ||
                  (wasStopped ? t("reportTitleStopped") : t("reportTitleDefault"))}
              </h2>
            </div>
          </div>
        )}

        {message.correctionApplication && !correctionApplicationFailed && (
          <CorrectionApplicationReceipt
            receipt={message.correctionApplication}
          />
        )}

        {!hasError && partialSummary && !summaryDuplicatesConfirmation ? (
          <ReactMarkdown className="prose prose-sm mt-5 max-w-none dark:prose-invert">
            {partialSummary}
          </ReactMarkdown>
        ) : !hasError && !report?.confirmation ? (
          <p className="mt-5 text-sm text-muted-foreground">{t("noConclusionYet")}</p>
        ) : null}

        {needsData && report.action?.kind === "add_data" && (
          <section className="mt-7 rounded-xl border border-primary/25 bg-primary/[0.04] px-5 py-5">
            <div className="flex items-start gap-3">
              <FilePlus2 size={18} className="mt-0.5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold text-foreground">
                  {report.action.label}
                </h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {report.action.reason}
                </p>
                <ul className="mt-3 space-y-1.5 text-sm text-foreground/85">
                  {report.action.requested_data.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="text-primary">·</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={onOpenData}
                    variant="primary"
                  >
                    {t("addFileOrDb")}
                    <ArrowRight size={14} />
                  </Button>
                  {message.resumable && (
                    <Button
                      type="button"
                      onClick={() => onRetry(index)}
                      variant="outline"
                    >
                      {t("dataReadyContinue")}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        <AnalysisMetrics metrics={report?.metrics} />

        {report?.confirmation && (
          <BusinessConfirmation
            request={report.confirmation}
            projectId={message.projectId}
            analysisRunId={message.analysisRunId}
            resolvedOption={message.confirmationResolved}
            question={localizedPreflightConfirmation?.question || report.confirmation.question}
            reason={localizedPreflightConfirmation?.reason || report.confirmation.reason}
            optionLabel={localizedPreflightConfirmation?.optionLabel || ((option) => option)}
            onConfirm={onConfirm}
          />
        )}

        <AnalysisFindings findings={report?.findings} />

        {(structuredVisualization || pythonImages.length > 0) && (
          <section className="mt-7">
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {t("resultCharts")}
            </h3>
            {structuredVisualization ? (
              <ChartDisplay spec={structuredVisualization} />
            ) : null}
            {pythonImages.map((image, imageIndex) => (
              <Image
                key={imageIndex}
                src={`data:image/png;base64,${image}`}
                alt={t("resultImageAlt", { index: imageIndex + 1 })}
                width={1280}
                height={720}
                unoptimized
                className="mt-4 h-auto max-w-full rounded-xl border border-border bg-white"
              />
            ))}
          </section>
        )}

        {!hasError && message.data?.length ? (
          <details className="mt-7" open={!structuredVisualization && pythonImages.length === 0}>
            <summary className="w-fit cursor-pointer rounded-md border border-border px-3 py-2 text-xs font-medium text-primary hover:bg-muted">{t("resultTable")}</summary>
            <section className="mt-3" aria-label={t("resultDetailsAria")}>
            <DataTable data={message.data} title={t("resultTable")} />
            </section>
          </details>
        ) : null}

        {!needsData && artifactsFailed && (
          <section className="mt-7 flex flex-wrap items-center justify-between gap-3 border-y border-border py-3">
            <span className="text-xs text-muted-foreground">
              {t("artifactsNotLoaded")}
            </span>
            <Button
              type="button"
              onClick={() => void refetchArtifacts()}
              variant="ghost"
            >
              {t("retry")}
            </Button>
          </section>
        )}

        {!needsData && !artifactsFailed && artifacts.length > 0 && (
          <section className="mt-7 flex flex-wrap items-center justify-between gap-3 border-y border-border py-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <FolderCheck size={15} className="text-success" />
              {t("artifactsSavedCount", { count: artifacts.length })}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                onClick={() => setSavedArtifactsOpen(true)}
                variant="ghost"
              >
                {t("viewArtifactsCount", { count: artifacts.length })}
              </Button>
              {savedFiles.map((artifact) => (
                <a
                  key={artifact.id}
                  href={`/api/v1/projects/${artifact.project_id}/analysis-runs/${artifact.analysis_run_id}/artifacts/${artifact.id}/file`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                >
                  {t("openArtifact", { title: artifact.title })}
                  <ExternalLink size={12} />
                </a>
              ))}
            </div>
          </section>
        )}

        <SavedAnalysisArtifacts
          artifacts={artifacts}
          open={savedArtifactsOpen}
          onClose={() => setSavedArtifactsOpen(false)}
        />

        {canSavePlaybook && (
          <section className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
            <div className="flex items-start gap-2.5">
              <ClipboardCheck
                size={16}
                className="mt-0.5 shrink-0 text-primary"
              />
              <div>
                <div className="text-sm font-medium text-foreground">
                  {playbookState === "saved"
                    ? t("savedAsReusable")
                    : t("methodVerified")}
                </div>
                <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  {t("methodReuseHint")}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => void handleSavePlaybook()}
                disabled={playbookState !== "idle"}
                variant="outline"
              >
                {playbookState === "saving"
                  ? t("savingMethod")
                  : playbookState === "saved"
                    ? t("methodSaved")
                    : t("applyNextTime")}
              </Button>
              {playbookState === "saved" && (
                <Button
                  type="button"
                  onClick={() => void handleCreateStanding()}
                  disabled={standingState !== "idle"}
                  variant="primary"
                >
                  {standingState === "saving"
                    ? t("startingStanding")
                    : standingState === "saved"
                      ? t("standingActive")
                      : t("standingWatchChanges")}
                </Button>
              )}
            </div>
            {playbookError && (
              <p className="w-full text-xs leading-5 text-destructive">
                {playbookError}
              </p>
            )}
            {playbookState === "saved" &&
              standingState !== "saved" &&
              !standingError && (
                <p className="w-full text-xs leading-5 text-muted-foreground">
                  {t("standingExplain")}
                </p>
              )}
            {standingError && (
              <p className="w-full text-xs leading-5 text-destructive">
                {standingError}
              </p>
            )}
          </section>
        )}

        <AnalysisSuggestions actions={nextActions} questions={report?.follow_ups} onUsePrompt={onUsePrompt} />

        {!hasError && !needsData && !needsDecision && (
          <div className="analysis-report-actions mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
            <Button onClick={handleLatestDataRerun} disabled={Boolean(message.projectId && correctionsPending)}
              variant="ghost">
              <RefreshCw size={14} />{canResume ? t("continueLast") : t("rerunLatest")}
            </Button>
            {message.projectId && message.analysisRunId && canCorrectReport && <Link
              href={`/projects/${message.projectId}/reports?fromRun=${message.analysisRunId}`}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              <LayoutDashboard size={15} />{t("addToReport")}
            </Link>}
          </div>
        )}

        {canCorrectReport && (
          <section className="mt-7 border-t border-border pt-5">
            {(correctionState === "saved" || correctionState === "deleting") &&
            !correctionOpen ? (
              <div
                className={`flex flex-wrap items-start justify-between gap-3 border px-4 py-4 text-sm ${
                  projectCorrectionInactive || correctionExecutionBlocked
                    ? "border-border bg-muted/40 text-foreground"
                    : correctionReusable && !correctionExecutionVerified
                      ? "border-warning/30 bg-warning/[0.05] text-warning"
                      : "border-success/30 bg-success/[0.05] text-success"
                }`}
              >
                <div className="flex items-start gap-2.5">
                  {projectCorrectionInactive || correctionExecutionBlocked ? (
                    <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  ) : (
                    <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
                  )}
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {projectCorrectionInactive
                          ? t("ruleRetired")
                          : correctionExecutionBlocked
                            ? t("ruleCannotUseNow")
                            : correctionReusable && !correctionPromoted
                              ? t("ruleRecordedNoReuse")
                              : correctionReusable &&
                                  !correctionExecutionVerified
                                ? t("ruleRecordedNotVerified")
                                : correctionReusable
                                  ? t("ruleRecorded")
                                  : t("ruleRecordedJust")}
                      </span>
                      <span className="rounded-full border border-current/15 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {correctionKindLabel(
                          persistedCorrection?.correction_type,
                          t,
                        )}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
                      {projectCorrectionInactive
                        ? t("ruleRetiredDesc")
                        : correctionExecutionBlocked
                          ? t("ruleRecheckDesc")
                          : correctionReusable && !correctionPromoted
                            ? t("ruleOneTimeDesc")
                            : correctionReusable && correctionExecutionVerified
                              ? t("ruleVerifiedDesc")
                              : correctionReusable
                                ? t("ruleDefinitionOnlyDesc")
                                : t("ruleOneTimeReportDesc")}
                    </div>
                    <blockquote className="mt-2 border-l border-current/25 pl-3 text-sm leading-6 text-foreground">
                      {currentCorrectionText}
                    </blockquote>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {correctionExecutionVerified ? (
                    <Button
                      type="button"
                      disabled={correctionState === "deleting"}
                      onClick={onOpenUnderstanding || onOpenData}
                      variant="ghost"
                    >
                      {t("manageInData")}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      disabled={correctionState === "deleting"}
                      onClick={() => {
                        setCorrectionText(currentCorrectionText);
                        setCorrectionKind(
                          persistedCorrection?.correction_type ||
                            "business_rule",
                        );
                        setCorrectionTargetRef(
                          persistedCorrection?.target_ref || null,
                        );
                        setCorrectionSelection(
                          persistedCorrection?.selection || null,
                        );
                        setCorrectionReusable(
                          persistedCorrection?.scope === "project",
                        );
                        setCorrectionError(null);
                        setCorrectionState("idle");
                        setCorrectionOpen(true);
                      }}
                      variant="ghost"
                    >
                      {t("modify")}
                    </Button>
                  )}
                  {persistedCorrection && (
                    <Button
                      type="button"
                      disabled={correctionState === "deleting"}
                      onClick={() => void handleDeleteCorrection()}
                      variant="ghost"
                    >
                      {correctionState === "deleting"
                        ? t("revoking")
                        : t("revokeRecord")}
                    </Button>
                  )}
                  <Button
                    type="button"
                    disabled={correctionState === "deleting"}
                    onClick={() =>
                      runPrompt(correctedInvestigationPrompt(), {
                        correctionId: persistedCorrection?.id,
                      })
                    }
                    variant="primary"
                  >
                    {t("rerunWithCorrectionAction")}
                  </Button>
                </div>
                {correctionError && (
                  <p
                    className="basis-full text-xs leading-5 text-destructive"
                    role="alert"
                  >
                    {correctionError}
                  </p>
                )}
              </div>
            ) : !correctionOpen ? (
              <Button
                type="button"
                onClick={() => setCorrectionOpen(true)}
                variant="ghost"
              >
                <MessageSquareWarning size={16} />
                {t("correctionPrompt")}
              </Button>
            ) : (
              <div className="rounded-xl border border-warning/30 bg-warning/[0.05] px-4 py-4">
                {correctionTargets.length > 0 && (
                  <fieldset>
                    <legend className="text-sm font-semibold text-foreground">
                      {t("whichToCorrect")}
                    </legend>
                    <div className="mt-3 grid gap-2 grid-cols-2">
                      <label
                        className={`cursor-pointer rounded-md border px-3 py-2.5 transition-colors ${
                          correctionTargetRef === null
                            ? "border-primary bg-card text-foreground"
                            : "border-warning/30 bg-card/60 text-muted-foreground hover:border-primary/40"
                        }`}
                      >
                        <input
                          type="radio"
                          name={`report-correction-target-${index}`}
                          checked={correctionTargetRef === null}
                          onChange={() => {
                            setCorrectionTargetRef(null);
                            setCorrectionSelection(null);
                            setCorrectionReusable(false);
                          }}
                          disabled={correctionState === "saving"}
                          className="sr-only"
                        />
                        <span className="block text-xs font-semibold">
                          {t("overallOrOther")}
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-4">
                          {t("overallOrOtherDesc")}
                        </span>
                      </label>
                      {correctionTargets.map((target) => {
                        const selected =
                          correctionTargetRef === target.target_ref;
                        return (
                          <label
                            key={target.target_ref}
                            className={`cursor-pointer rounded-md border px-3 py-2.5 transition-colors ${
                              selected
                                ? "border-primary bg-card text-foreground"
                                : "border-warning/30 bg-card/60 text-muted-foreground hover:border-primary/40"
                            }`}
                          >
                            <input
                              type="radio"
                              name={`report-correction-target-${index}`}
                              value={target.target_ref}
                              checked={selected}
                              onChange={() => {
                                if (correctionTargetRef !== target.target_ref) {
                                  setCorrectionSelection(null);
                                }
                                setCorrectionTargetRef(target.target_ref);
                                setCorrectionKind(target.correction_type);
                              }}
                              disabled={correctionState === "saving"}
                              className="sr-only"
                            />
                            <span className="block text-xs font-semibold">
                              {target.label}
                            </span>
                            {target.description && (
                              <span className="mt-0.5 block text-[11px] leading-4">
                                {target.description}
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                )}
                {!hasBoundCorrectionTarget && (
                  <fieldset
                    className={
                      correctionTargets.length > 0 ? "mt-4" : undefined
                    }
                  >
                    <legend className="text-sm font-semibold text-foreground">
                      {t("whatWentWrong")}
                    </legend>
                    <div className="mt-3 grid gap-2 grid-cols-3">
                      {correctionKinds.map((kind) => {
                        const selected = correctionKind === kind.value;
                        return (
                          <label
                            key={kind.value}
                            className={`cursor-pointer rounded-md border px-3 py-2.5 transition-colors ${
                              selected
                                ? "border-primary bg-card text-foreground"
                                : "border-warning/30 bg-card/60 text-muted-foreground hover:border-primary/40"
                            }`}
                          >
                            <input
                              type="radio"
                              name={`report-correction-kind-${index}`}
                              value={kind.value}
                              checked={selected}
                              onChange={() => {
                                setCorrectionKind(kind.value);
                                setCorrectionSelection(null);
                              }}
                              disabled={correctionState === "saving"}
                              className="sr-only"
                            />
                            <span className="block text-xs font-semibold">
                              {kind.label}
                            </span>
                            <span className="mt-0.5 block text-[11px] leading-4">
                              {kind.description}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                )}
                {correctionTargetsFetching && (
                  <p
                    className="mt-3 text-xs leading-5 text-muted-foreground"
                    role="status"
                  >
                    {t("recheckingDefinitions")}
                  </p>
                )}
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {hasBoundCorrectionTarget
                    ? t("saveCorrectionFirst")
                    : correctionTargetsFailed
                      ? t("saveOneTimeNoChoice")
                      : t("saveOneTime")}
                </p>
                <label
                  htmlFor={`report-correction-${index}`}
                  className="mt-3 block text-xs font-medium text-foreground"
                >
                  {t("correctDefinition")}
                </label>
                <textarea
                  id={`report-correction-${index}`}
                  value={correctionText}
                  onChange={(event) => setCorrectionText(event.target.value)}
                  disabled={correctionState === "saving"}
                  rows={3}
                  autoFocus
                  placeholder={
                    correctionKinds.find(
                      (kind) => kind.value === correctionKind,
                    )?.placeholder
                  }
                  className="mt-2 w-full resize-y rounded-md border border-warning/30 bg-card px-3 py-2.5 text-sm leading-6 text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
                />
                <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-xs leading-5 text-foreground">
                  <input
                    type="checkbox"
                    checked={correctionReusable}
                    onChange={(event) => {
                      if (event.target.checked && !hasBoundCorrectionTarget)
                        return;
                      setCorrectionReusable(event.target.checked);
                    }}
                    aria-disabled={!hasBoundCorrectionTarget}
                    disabled={
                      correctionState === "saving" ||
                      (!hasBoundCorrectionTarget && !correctionReusable)
                    }
                    className="mt-1 h-3.5 w-3.5 accent-[hsl(var(--primary))]"
                  />
                  <span>
                    <span className="font-medium">
                      {t("useForFuture")}
                    </span>
                    <span className="block text-muted-foreground">
                      {hasBoundCorrectionTarget
                        ? t("useForFutureDesc")
                        : t("useForFutureRequire")}
                    </span>
                  </span>
                </label>
                {correctionReusable &&
                  boundCorrectionType === "metric_definition" && (
                    <fieldset className="mt-3 border-t border-warning/30 pt-3">
                      <legend className="text-xs font-semibold text-foreground">
                        {t("whichField")}
                      </legend>
                      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                        {t("whichFieldDesc")}
                      </p>
                      {correctionTargetOptionsFetching ? (
                        <p
                          className="mt-2 text-xs text-muted-foreground"
                          role="status"
                        >
                          {t("checkingFields")}
                        </p>
                      ) : correctionTargetOptionsFailed ? (
                        <p
                          className="mt-2 text-xs leading-5 text-warning"
                          role="alert"
                        >
                          {t("fieldsUnavailable")}
                        </p>
                      ) : correctionTargetOptions.length > 0 ? (
                        <div className="mt-2 grid gap-2 grid-cols-2">
                          {correctionTargetOptions.map((option) => {
                            const selected =
                              effectiveMetricSelection?.kind ===
                                "metric_column" &&
                              effectiveMetricSelection.field_ref ===
                                option.field_ref;
                            return (
                              <label
                                key={option.field_ref}
                                className={`cursor-pointer rounded-md border px-3 py-2.5 transition-colors ${
                                  selected
                                    ? "border-primary bg-card text-foreground"
                                    : "border-warning/30 bg-card/60 text-muted-foreground hover:border-primary/40"
                                }`}
                              >
                                <input
                                  type="radio"
                                  name={`report-correction-metric-field-${index}`}
                                  value={option.field_ref}
                                  checked={selected}
                                  onChange={() =>
                                    setCorrectionSelection({
                                      kind: "metric_column",
                                      field_ref: option.field_ref,
                                    })
                                  }
                                  disabled={correctionState === "saving"}
                                  className="sr-only"
                                />
                                <span className="block text-xs font-semibold">
                                  {option.label}
                                </span>
                                <span className="mt-0.5 block text-[11px] leading-4">
                                  {option.description}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="mt-2 text-xs leading-5 text-muted-foreground">
                          {t("noSafeFields")}
                        </p>
                      )}
                    </fieldset>
                  )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    disabled={
                      !correctionText.trim() ||
                      correctionState === "saving" ||
                      (correctionReusable && !hasBoundCorrectionTarget) ||
                      metricSelectionPending ||
                      metricSelectionRequired
                    }
                    onClick={() => void handleSaveCorrection()}
                    variant="primary"
                  >
                    {correctionState === "saving" ? t("savingCorrection") : t("saveCorrection")}
                  </Button>
                  <Button
                    type="button"
                    disabled={correctionState === "saving"}
                    onClick={() => {
                      setCorrectionText(currentCorrectionText);
                      setCorrectionKind(
                        persistedCorrection?.correction_type || "business_rule",
                      );
                      setCorrectionTargetRef(
                        persistedCorrection?.target_ref || null,
                      );
                      setCorrectionSelection(
                        persistedCorrection?.selection || null,
                      );
                      setCorrectionReusable(
                        persistedCorrection?.scope === "project",
                      );
                      setCorrectionOpen(false);
                      setCorrectionError(null);
                    }}
                    variant="ghost"
                  >
                    {t("cancel")}
                  </Button>
                </div>
                {correctionError && (
                  <p
                    className="mt-2 text-xs leading-5 text-destructive"
                    role="alert"
                  >
                    {correctionError}
                  </p>
                )}
              </div>
            )}
          </section>
        )}

      </div>
    </article>
  );
}
