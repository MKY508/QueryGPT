"use client";

import { useLocale, useTranslations } from "next-intl";
import type { PreflightIssue, PreflightReport, ProjectDataSource, SemanticEntry } from "@/lib/types/api";
import { sourceDisplayState } from "@/lib/source-directory";
import { fileSourceBlockers } from "@/lib/source-activation";


const FIELD_WORD_KEYS = [
  "unit",
  "price",
  "cost",
  "total",
  "amount",
  "revenue",
  "sales",
  "order",
  "id",
  "date",
  "time",
  "store",
  "shop",
  "channel",
  "category",
  "product",
  "quantity",
  "qty",
  "discount",
  "refund",
  "profit",
];

/** Business-facing descriptions share one locale and source-state interpretation. */
export function useDataWorkspacePresentation() {
  const locale = useLocale();
  const t = useTranslations("dataWorkspace");
  const fieldWordsRaw = t("fieldWords").split(",").map((s) => s.trim());
  const FIELD_WORDS: Record<string, string> = Object.fromEntries(
    FIELD_WORD_KEYS.map((key, i) => [key, fieldWordsRaw[i] || key]),
  );

  const businessFieldLabel = (value: string): string | null => {
    const normalized = value.trim().replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
    const parts = normalized.split(/[_\s.-]+/).filter(Boolean);
    if (!parts.length || !parts.every((part) => FIELD_WORDS[part])) return null;
    return parts.map((part) => FIELD_WORDS[part]).join("");
  };

  const businessIssueTitle = (issue: PreflightIssue): string => {
    if (issue.code === "preflight_failed") {
      const sheet = issue.presentation_facts?.sheet;
      const cell = issue.presentation_facts?.cell;
      const hasCell = typeof sheet === "string" && sheet.length > 0 && sheet.length <= 128 &&
        typeof cell === "string" && /^[A-Z]{1,3}[1-9][0-9]{0,6}$/.test(cell);
      const line: unknown = issue.presentation_facts?.line;
      const jsonIssue = (message: string) =>
        typeof line === "number" && Number.isSafeInteger(line) && line > 0 && line <= 1_000_000_000
          ? t("issueJsonLine", { line: line.toLocaleString(locale), message }) : message;
      switch (issue.presentation_code) {
        case "xlsx_formula_result_missing":
          return hasCell ? t("issueFormulaMissingCell", { sheet, cell }) : t("issueFormulaMissing");
        case "xlsx_cell_error":
          return hasCell ? t("issueExcelErrorCell", { sheet, cell }) : t("issueExcelError");
        case "xlsx_expanded_limit":
          return t("issueExcelExpandedLimit");
        case "xlsx_metadata_limit":
          return t("issueExcelMetadataLimit");
        case "parquet_schema_unsupported":
          return t("issueParquetSchemaUnsupported");
        case "parquet_size_limit":
          return t("issueParquetSizeLimit");
        case "parquet_unreadable":
          return t("issueParquetUnreadable");
        case "json_unreadable":
          return jsonIssue(t("issueJsonUnreadable"));
        case "json_structure_unsupported":
          return jsonIssue(t("issueJsonStructure"));
        case "json_size_limit":
          return jsonIssue(t("issueJsonSizeLimit"));
        case "json_lines_invalid":
          return jsonIssue(t("issueJsonLinesInvalid"));
      }
    }
    const fieldMatch = issue.title.match(/^([^“”]+?)\s*中有\s*(\d+)\s*个(.+)$/);
    const duplicateKeyMatch = issue.title.match(/^(.+?)\s+有\s+(\d+)\s+条重复出现$/);
    const rawField = fieldMatch?.[1] || duplicateKeyMatch?.[1];
    const field = rawField
      ? businessFieldLabel(rawField) || rawField.trim().slice(0, 80)
      : null;
    const countValue =
      typeof issue.count === "number" && Number.isFinite(issue.count)
        ? issue.count
        : Number(fieldMatch?.[2] || duplicateKeyMatch?.[2] || 0);
    const count = Math.max(0, countValue).toLocaleString(locale);

    switch (issue.code) {
      case "possible_outliers":
        return field
          ? t("issueOutliersField", { field, count })
          : t("issueOutliers", { count });
      case "invalid_currency_values":
        return field
          ? t("issueAmountsField", { field, count })
          : t("issueAmounts", { count });
      case "invalid_date_values":
        return field
          ? t("issueDatesField", { field, count })
          : t("issueDates", { count });
      case "date_format_review":
        return t("issueDateFormatReview");
      case "numeric_precision_review":
        return t("issueNumericPrecisionReview");
      case "json_values_preserved":
        return t("issueJsonValuesPreserved");
      case "refund_values_review":
        return t("issueRefundValuesReview");
      case "formula_results_review":
        return t("issueFormulaResultsReview", { count });
      case "duplicate_business_keys":
        return field
          ? t("issueDuplicates", { label: field, count })
          : t("issueDuplicateKeys", { count });
      case "header_offset":
        return t("issueHeaderOffset", {
          row: (Math.max(0, countValue) + 1).toLocaleString(locale),
        });
      case "empty_regions":
        return t("issueEmptyRegions");
      case "summary_rows":
        return t("issueSummaryRows", { count });
      case "duplicate_rows":
      case "drop_exact_duplicates":
        return t("issueDuplicateRows", { count });
      case "missing_values":
        return t("issueMissingValues", { count });
      case "recipe_replay_drift":
      case "recipe_input_changed":
        return t("issueRecipeChanged", { count });
      case "recipe_replayed":
        return t("issueRecipeReplayed", { count });
      case "imported_recipe_candidate":
        return t("issueImportedRecipe");
      case "schema_drift":
      case "replacement_pending":
        return t("issueSchemaChanged");
      case "replacement_accepted":
        return t("issueReplacementAccepted");
      case "sanitation_reverted":
        return t("issueSanitationReverted");
      case "confirmed_knowledge_reused":
        return t("issueKnowledgeReused");
      case "database_table_budget_reached":
      case "database_catalog_column_budget_reached":
      case "database_table_column_budget_reached":
      case "database_column_budget_reached":
        return t("issueDatabaseScopeLimited");
      case "database_sample_byte_budget_reached":
      case "database_preflight_time_budget_reached":
      case "database_preflight_byte_budget_reached":
        return t("issueDatabaseSampleLimited");
      case "database_tables_partially_unavailable":
      case "no_profileable_columns":
        return t("issueDatabasePartial");
      case "database_catalog_unavailable":
      case "database_preflight_failed":
      case "preflight_failed":
        return t("issuePreparationFailed");
      default:
        if (issue.severity === "critical") return t("issueUnknownFailed");
        return issue.automatic
          ? t("issueUnknownPrepared")
          : t("issueUnknownReview");
    }
  };

  const businessPreflightSummary = (
    report: PreflightReport | undefined,
    source: ProjectDataSource,
  ): string => {
    const displayState = sourceDisplayState(source, report);
    if (displayState === "history") return t("preflightHistorical");
    if (displayState === "activation_pending") return t("preflightReplacementWaiting");
    if (displayState === "preparation_review") return t(fileSourceBlockers(source).has("recipe_input_changed") ? "preflightSourceChanged" : "preflightMethodReview");
    const asRecord = (value: unknown): Record<string, unknown> =>
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const asCount = (value: unknown): number | null =>
      typeof value === "number" && Number.isFinite(value) && value >= 0
        ? value
        : null;
    const format = (value: number) => value.toLocaleString(locale);
    const snapshot = asRecord(report?.source_snapshot);
    const sourcePreanalysis = asRecord(source.profile_data.preanalysis);
    const preanalysis = asRecord(snapshot.preanalysis);
    const effectivePreanalysis = Object.keys(preanalysis).length
      ? preanalysis
      : sourcePreanalysis;
    const summaryCode = String(
      snapshot.summary_code ?? effectivePreanalysis.summary_code ?? "",
    );
    const summaryFacts = asRecord(
      snapshot.summary_facts ?? effectivePreanalysis.summary_facts,
    );
    const shape = asRecord(effectivePreanalysis.shape);
    const legacySummary = String(
      report?.summary ?? source.profile_data.summary ?? "",
    ).trim();
    const legacySummaryMatchesLocale =
      !summaryCode &&
      legacySummary.length > 0 &&
      (locale.startsWith("zh")
        ? /[\u3400-\u9fff]/u.test(legacySummary)
        : !/[\u3400-\u9fff]/u.test(legacySummary));

    if (source.kind === "connection") {
      const tables = asCount(summaryFacts.profiled_tables ?? shape.profiled_tables);
      const columns = asCount(summaryFacts.profiled_columns ?? shape.columns);
      const relationIndex = asRecord(
        source.profile_data.relation_index ?? sourcePreanalysis.relation_index,
      );
      const indexedRelations = Array.isArray(relationIndex.relations)
        ? relationIndex.relations
        : [];
      const catalogTables =
        asCount(relationIndex.relations_total) ??
        asCount(relationIndex.relations_total_at_least) ??
        asCount(relationIndex.relations_loaded) ??
        (indexedRelations.length ? indexedRelations.length : null);
      const catalogComplete =
        relationIndex.complete !== false && relationIndex.truncated !== true;
      const profileStatus = String(
        summaryFacts.status ??
          snapshot.profile_status ??
          source.profile_data.profile_status ??
          report?.status ??
          source.status,
      );
      if (profileStatus === "error" || source.status === "error") {
        return t("preflightDatabaseFailed");
      }
      if (
        catalogTables !== null &&
        tables !== null &&
        catalogTables !== tables
      ) {
        return t(
          catalogComplete
            ? "preflightDatabaseCatalogReady"
            : "preflightDatabaseCatalogPartial",
          {
            tables: format(catalogTables),
            checked: format(tables),
          },
        );
      }
      if (tables !== null && columns !== null) {
        const parts = [
          t("preflightDatabaseReady", {
            tables: format(tables),
            columns: format(columns),
          }),
        ];
        if (summaryFacts.partial === true || profileStatus === "partial") {
          parts.push(t("preflightDatabasePartial"));
        }
        return parts.join(" · ");
      }
      if (legacySummaryMatchesLocale) return legacySummary;
      return t("preflightDatabasePrepared");
    }

    if (source.status === "error" || report?.status === "error") {
      return t("preflightFileFailed");
    }
    const rows = asCount(summaryFacts.rows ?? snapshot.ready_rows ?? shape.rows);
    const columns = asCount(
      summaryFacts.columns ?? snapshot.ready_columns ?? shape.columns,
    );
    if (rows === null || columns === null) {
      if (legacySummaryMatchesLocale) return legacySummary;
      return source.status === "attached"
        ? t("sourceAwaitingPreparation")
        : t("preflightFilePrepared");
    }
    const parts = [
      t("preflightFileReady", {
        rows: format(rows),
        columns: format(columns),
      }),
    ];
    const automaticCount =
      asCount(summaryFacts.automatic_issue_count) ??
      report?.issues.filter((issue) => issue.automatic).length ??
      0;
    const ambiguityCount =
      asCount(summaryFacts.ambiguity_count) ?? report?.ambiguities.length ?? 0;
    if (automaticCount > 0) {
      parts.push(t("preflightAutomaticHandled", { count: format(automaticCount) }));
    }
    if (ambiguityCount > 0) {
      parts.push(t("preflightDefinitionsPending", { count: format(ambiguityCount) }));
    }
    const recipeSteps = asCount(summaryFacts.recipe_step_count) ?? 0;
    const recipeDrift = asCount(summaryFacts.recipe_drift_count) ?? 0;
    if (recipeDrift > 0) {
      parts.push(t("preflightRecipeChanged"));
    } else if (recipeSteps > 0) {
      parts.push(t("preflightRecipeChecked"));
    }
    return parts.join(" · ");
  };

  const dedupeBusinessIssues = (issues: PreflightIssue[]): PreflightIssue[] => {
    const unique = new Map<string, PreflightIssue>();
    for (const issue of issues) {
      const label = businessIssueTitle(issue);
      const previous = unique.get(label);
      if (!previous || (previous.automatic && !issue.automatic)) {
        unique.set(label, issue);
      }
    }
    return Array.from(unique.values()).sort(
      (left, right) =>
        Number(right.severity === "critical") - Number(left.severity === "critical") ||
        Number(Boolean(left.automatic)) - Number(Boolean(right.automatic))
    );
  };

  const businessColumnSummary = (values: unknown): string | null => {
    if (!Array.isArray(values) || !values.length) return null;
    const known = Array.from(
      new Set(
        values
          .map((value) => businessFieldLabel(String(value)))
          .filter((value): value is string => Boolean(value))
      )
    );
    const hiddenCount = values.length - known.length;
    const knownLabel = new Intl.ListFormat(locale, {
      style: "short",
      type: "conjunction",
    }).format(known);
    return hiddenCount > 0
      ? t("columnSummaryWithHidden", {
          known: knownLabel,
          hidden: t("hiddenItems", { count: hiddenCount }),
        })
      : knownLabel;
  };

  const knowledgeKindLabel = (kind: SemanticEntry["entry_type"]): string => {
    if (kind === "metric") return t("knowledgeMetric");
    if (kind === "dimension") return t("knowledgeGranularity");
    if (kind === "relationship") return t("knowledgeRelation");
    if (kind === "cleaning_rule") return t("knowledgeMethod");
    if (kind === "verified_query") return t("knowledgeVerified");
    return t("knowledgeDefinition");
  };

  const knowledgeDisplayValue = (entry: SemanticEntry): string => {
    if (entry.entry_type === "relationship" && entry.state === "candidate") {
      return t("relationPreviewHint");
    }
    return entry.value.replace(/\b[a-zA-Z][a-zA-Z0-9_.-]*\b/g, (token) => {
      const lastPart = token.split(".").at(-1) || token;
      const businessLabel = businessFieldLabel(lastPart);
      if (businessLabel) return businessLabel;
      return token.includes("_") || token.includes(".") || /[a-z][A-Z]/.test(token)
        ? t("relatedFields")
        : token;
    });
  };

  const revisionTime = (value: string): string => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return t("timeUnconfirmed");
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  };
  return { locale, businessFieldLabel, businessIssueTitle, businessPreflightSummary, dedupeBusinessIssues, businessColumnSummary, knowledgeKindLabel, knowledgeDisplayValue, revisionTime };
}
