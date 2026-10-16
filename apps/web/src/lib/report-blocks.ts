/** Report block models and transformations; no component or React dependencies. */
import type { AnalysisArtifact, AnalysisHistoryItem } from "@/lib/types/api";
import { normalizeChartSpec } from "@/lib/charts";
import { compareNumericValues, numericValue } from "@/lib/numeric-values";
import { reportContentRows as contentRows } from "@/lib/report-rows";
import { metricColumnContent, metricResultColumns } from "@/lib/report-metrics";
import type {
  ReportBlock,
  ReportBlockLayout,
  ReportBlockType,
  ReportPage,
} from "@/lib/reports";

let localSequence = 0;

export function createLocalId(kind: "page" | "block"): string {
  localSequence += 1;
  return `local-${kind}-${Date.now()}-${localSequence}`;
}

export const REPORT_BLOCK_TYPES: readonly ReportBlockType[] = [
  "metric",
  "chart",
  "table",
  "text",
  "evidence",
  "filter",
];

export interface ReportBlocksCopy {
  labels: Record<ReportBlockType, string>;
  descriptions: Record<ReportBlockType, string>;
  genericBlock: string;
  filterValuePlaceholder: string;
  newPage: string;
  evidenceStatusPassed: string;
  evidenceStatusFailed: string;
  evidenceStatusDefinitionOnly: string;
  evidenceStatusReviewed: string;
  validationRelationship: string;
  validationApplication: string;
  validationGoldenRegression: string;
  validationAnalysis: string;
  validationRows: (count: string) => string;
  validationColumns: (count: number) => string;
  businessAdjustment: (rule: string) => string;
  businessAdjustmentReviewed: string;
  correctionSummaryVerified: string;
  correctionSummaryRelationshipVerified: string;
  correctionSummaryDefinitionOnly: string;
  correctionSummaryFailed: string;
  metricFallback: string;
  changePercent: (value: string) => string;
  changeDelta: (value: string) => string;
  changeLine: (values: {
    metric: string;
    before: string;
    after: string;
    change: string;
  }) => string;
  driverLine: (values: { group: string; change: string }) => string;
  materialChange: string;
  noMaterialChange: string;
  mainDrivers: string;
  groupFallback: string;
  changedGroups: (count: number) => string;
  evidencePreserved: string;
  evidencePreservedDetail: string;
  investigationSummary: string;
}

type ReportBlocksTranslationValues = Record<string, string | number>;
type ReportBlocksTranslator = (
  key: string,
  values?: ReportBlocksTranslationValues
) => string;

export function createReportBlocksCopy(t: ReportBlocksTranslator): ReportBlocksCopy {
  return {
    labels: {
      metric: t("labelMetric"),
      chart: t("labelChart"),
      table: t("labelTable"),
      text: t("labelText"),
      evidence: t("labelEvidence"),
      filter: t("labelFilter"),
    },
    descriptions: {
      metric: t("descriptionMetric"),
      chart: t("descriptionChart"),
      table: t("descriptionTable"),
      text: t("descriptionText"),
      evidence: t("descriptionEvidence"),
      filter: t("descriptionFilter"),
    },
    genericBlock: t("genericBlock"),
    filterValuePlaceholder: t("filterValuePlaceholder"),
    newPage: t("newPage"),
    evidenceStatusPassed: t("evidenceStatusPassed"),
    evidenceStatusFailed: t("evidenceStatusFailed"),
    evidenceStatusDefinitionOnly: t("evidenceStatusDefinitionOnly"),
    evidenceStatusReviewed: t("evidenceStatusReviewed"),
    validationRelationship: t("validationRelationship"),
    validationApplication: t("validationApplication"),
    validationGoldenRegression: t("validationGoldenRegression"),
    validationAnalysis: t("validationAnalysis"),
    validationRows: (count) => t("validationRows", { count }),
    validationColumns: (count) => t("validationColumns", { count }),
    businessAdjustment: (rule) => t("businessAdjustment", { rule }),
    businessAdjustmentReviewed: t("businessAdjustmentReviewed"),
    correctionSummaryVerified: t("correctionSummaryVerified"),
    correctionSummaryRelationshipVerified: t("correctionSummaryRelationshipVerified"),
    correctionSummaryDefinitionOnly: t("correctionSummaryDefinitionOnly"),
    correctionSummaryFailed: t("correctionSummaryFailed"),
    metricFallback: t("metricFallback"),
    changePercent: (value) => t("changePercent", { value }),
    changeDelta: (value) => t("changeDelta", { value }),
    changeLine: ({ metric, before, after, change }) =>
      t("changeLine", { metric, before, after, change }),
    driverLine: ({ group, change }) => t("driverLine", { group, change }),
    materialChange: t("materialChange"),
    noMaterialChange: t("noMaterialChange"),
    mainDrivers: t("mainDrivers"),
    groupFallback: t("groupFallback"),
    changedGroups: (count) => t("changedGroups", { count }),
    evidencePreserved: t("evidencePreserved"),
    evidencePreservedDetail: t("evidencePreservedDetail"),
    investigationSummary: t("investigationSummary"),
  };
}

export function reportBlockOptions(copy: ReportBlocksCopy): Array<{
  type: ReportBlockType;
  label: string;
  description: string;
}> {
  return REPORT_BLOCK_TYPES.map((type) => ({
    type,
    label: copy.labels[type],
    description: copy.descriptions[type],
  }));
}

export type ReportFilterOperator =
  | "contains"
  | "equals"
  | "not_equals"
  | "greater_than"
  | "greater_or_equal"
  | "less_than"
  | "less_or_equal";

export interface ActiveReportFilter {
  field: string;
  operator: ReportFilterOperator;
  value: string;
  /** Resolved runtime target, never persisted as a configuration reference. */
  blockId?: string;
}

export function blockTypeLabel(type: ReportBlockType, copy: ReportBlocksCopy): string {
  return copy.labels[type] || copy.genericBlock;
}

function defaultLayout(type: ReportBlockType): ReportBlockLayout {
  if (type === "metric") return { x: 0, y: 0, w: 4, h: 2 };
  if (type === "filter") return { x: 0, y: 0, w: 12, h: 3 };
  if (type === "table") return { x: 0, y: 0, w: 12, h: 6 };
  if (type === "evidence") return { x: 0, y: 0, w: 12, h: 4 };
  if (type === "text") return { x: 0, y: 0, w: 12, h: 3 };
  return { x: 0, y: 0, w: 6, h: 4 };
}

function defaultContent(type: ReportBlockType): Record<string, unknown> {
  if (type === "metric") return { value: "—", context: "" };
  if (type === "text") return { text: "" };
  if (type === "evidence") return { text: "" };
  if (type === "filter") return {};
  return { rows: [] };
}

function defaultConfig(
  type: ReportBlockType,
  copy: ReportBlocksCopy
): Record<string, unknown> {
  if (type === "chart") {
    return {
      chart_type: "bar",
      orientation: "vertical",
      stack: "none",
      number_format: "auto",
      palette: "receiptbi",
      show_labels: false,
    };
  }
  if (type === "filter") {
    return {
      field: "",
      operator: "contains",
      placeholder: copy.filterValuePlaceholder,
    };
  }
  return {};
}

export function createManualBlock(
  type: ReportBlockType,
  copy: ReportBlocksCopy
): ReportBlock {
  return {
    id: createLocalId("block"),
    block_type: type,
    title: blockTypeLabel(type, copy),
    order_index: 0,
    source_kind: "manual",
    analysis_run_id: null,
    artifact_id: null,
    content: defaultContent(type),
    config: defaultConfig(type, copy),
    layout: defaultLayout(type),
  };
}

export function applyReportBlockUpdates(
  block: ReportBlock,
  updates: Partial<ReportBlock>
): ReportBlock {
  const next: ReportBlock = {
    ...block,
    ...updates,
    // Provenance is system-owned. Editing presentation or copy must never
    // detach a block from the investigation evidence it came from.
    id: block.id,
    source_kind: block.source_kind,
    analysis_run_id: block.analysis_run_id,
    artifact_id: block.artifact_id,
    source_ref: block.source_ref,
    source_available: block.source_available,
  };
  if (updates.block_type === "metric" && block.block_type === "table") {
    const columns = metricResultColumns(block);
    // Choosing the metric visualization is enough only when the value is unique.
    // Multi-value results retain their rows and ask for an explicit field.
    const column = columns.length === 1 ? columns[0] : "";
    next.content = metricColumnContent(block, column);
    next.config = { ...next.config, metric_column: column };
  }
  const isManualEdit = ["block_type", "title", "content", "config"].some((key) =>
    Object.prototype.hasOwnProperty.call(updates, key)
  );
  if (block.source_kind !== "manual" && isManualEdit) {
    next.config = { ...next.config, manual_override: true };
  }
  return next;
}

export function createReportPage(
  title: string,
  orderIndex = 0
): ReportPage {
  return {
    id: createLocalId("page"),
    title,
    order_index: orderIndex,
    config: {},
    blocks: [],
  };
}

export function reflowBlocks(blocks: ReportBlock[]): ReportBlock[] {
  let x = 0;
  let y = 0;
  let rowHeight = 1;
  const arranged = blocks.map((block, orderIndex) => {
    const requestedWidth = Math.max(3, Math.min(12, Math.round(block.layout.w || 6)));
    const w = block.block_type === "table" ? 12 : requestedWidth;
    const minimumHeight =
      block.block_type === "table"
        ? 6
        : block.block_type === "chart" || block.block_type === "evidence"
          ? 4
          : block.block_type === "filter"
            ? 3
            : 2;
    const h = Math.max(minimumHeight, Math.min(8, Math.round(block.layout.h || 3)));
    if (x > 0 && x + w > 12) {
      x = 0;
      y += rowHeight;
      rowHeight = 1;
    }
    const next = block.order_index === orderIndex && block.layout.x === x && block.layout.y === y &&
      block.layout.w === w && block.layout.h === h ? block
      : { ...block, order_index: orderIndex, layout: { x, y, w, h } };
    x += w;
    rowHeight = Math.max(rowHeight, h);
    if (x >= 12) {
      x = 0;
      y += rowHeight;
      rowHeight = 1;
    }
    return next;
  });
  return arranged.every((block, index) => block === blocks[index]) ? blocks : arranged;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function reportFilterFields(blocks: ReportBlock[], locale: string): string[] {
  const fields = new Set<string>();
  for (const block of blocks) {
    if (block.block_type !== "chart" && block.block_type !== "table") continue;
    const collection = contentRows(block.content);
    for (const row of collection?.rows || []) {
      Object.keys(row).forEach((field) => fields.add(field));
    }
  }
  return [...fields].sort((left, right) => left.localeCompare(right, locale));
}

function normalizedComparable(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim().toLocaleLowerCase();
}

function matchesFilter(
  candidate: unknown,
  filter: ActiveReportFilter
): boolean {
  const expected = filter.value.trim();
  const actualText = normalizedComparable(candidate);
  const expectedText = normalizedComparable(expected);
  if (filter.operator === "contains") return actualText.includes(expectedText);
  if (filter.operator === "equals") return actualText === expectedText;
  if (filter.operator === "not_equals") return actualText !== expectedText;

  const comparison = compareNumericValues(candidate, expected);
  if (comparison === null) return false;
  if (filter.operator === "greater_than") return comparison > 0;
  if (filter.operator === "greater_or_equal") return comparison >= 0;
  if (filter.operator === "less_than") return comparison < 0;
  if (filter.operator === "less_or_equal") return comparison <= 0;
  return true;
}

export function applyStaticReportFilters(
  block: ReportBlock,
  filters: ActiveReportFilter[]
): ReportBlock {
  if (
    (block.block_type !== "chart" && block.block_type !== "table") ||
    !filters.length
  ) {
    return block;
  }
  const collection = contentRows(block.content);
  if (!collection) return block;
  let rows = collection.rows;
  const sourceRowCount = rows.length;
  let applied = false;
  for (const filter of filters) {
    if (filter.blockId !== undefined && filter.blockId !== block.id) continue;
    if (!filter.field || !filter.value.trim()) continue;
    if (!rows.some((row) => Object.prototype.hasOwnProperty.call(row, filter.field))) {
      continue;
    }
    if (
      filter.operator !== "contains" &&
      filter.operator !== "equals" &&
      filter.operator !== "not_equals" &&
      numericValue(filter.value.trim()) === null
    ) {
      continue;
    }
    rows = rows.filter((row) =>
      Object.prototype.hasOwnProperty.call(row, filter.field)
        ? matchesFilter(row[filter.field], filter)
        : false
    );
    applied = true;
  }
  if (!applied) return block;
  return {
    ...block,
    content: {
      ...block.content,
      [collection.key]: rows,
      _filter_applied: true,
      _filter_source_rows: sourceRowCount,
    },
  };
}

function firstValue(payload: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" || typeof value === "number") return value;
  }
  for (const value of Object.values(payload)) {
    const nested = record(value);
    if (!nested) continue;
    const result = firstValue(nested, keys);
    if (result !== undefined) return result;
  }
  return undefined;
}

function artifactBlockType(kind: AnalysisArtifact["kind"]): ReportBlockType {
  if (kind === "metric") return "metric";
  if (kind === "chart") return "chart";
  if (kind === "table" || kind === "result_snapshot") return "table";
  if (kind === "evidence" || kind === "file") return "evidence";
  return "text";
}

function evidenceStatus(value: unknown, copy: ReportBlocksCopy): string {
  if (value === "verified" || value === "passed" || value === "success") {
    return copy.evidenceStatusPassed;
  }
  if (value === "failed" || value === "rejected") return copy.evidenceStatusFailed;
  if (value === "definition_only") return copy.evidenceStatusDefinitionOnly;
  return copy.evidenceStatusReviewed;
}

function validationLabel(
  item: Record<string, unknown>,
  copy: ReportBlocksCopy
): string {
  if (item.kind === "relationship_validation") return copy.validationRelationship;
  if (item.kind === "relationship_application") return copy.validationApplication;
  if (item.kind === "golden_regression_validation") {
    return copy.validationGoldenRegression;
  }
  return copy.validationAnalysis;
}

function validationDetail(
  item: Record<string, unknown>,
  copy: ReportBlocksCopy,
  locale: string
): string {
  const profile = record(item.profile);
  const rowCount = profile?.returned_rows ?? profile?.materialized_rows ?? profile?.rows;
  if (typeof rowCount === "number") {
    return copy.validationRows(rowCount.toLocaleString(locale));
  }
  if (Array.isArray(profile?.columns) && profile.columns.length) {
    return copy.validationColumns(profile.columns.length);
  }
  return evidenceStatus(item.status, copy);
}

function isTechnicalEvidenceText(value: string): boolean {
  return (
    /\b(sql|python|schema|json|tool|agent|token|api|exception|traceback|validation|binding)\b/i.test(
      value
    ) ||
    /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/i.test(value) ||
    /(字段绑定|内部状态|错误码|异常堆栈|查询执行|验证任务)/u.test(value)
  );
}

function humanEvidenceItems(
  payload: Record<string, unknown>,
  copy: ReportBlocksCopy,
  locale: string
): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  if (Array.isArray(payload.validations)) {
    for (const candidate of payload.validations) {
      const item = record(candidate);
      if (!item) continue;
      items.push({
        label: validationLabel(item, copy),
        text: validationDetail(item, copy, locale),
      });
    }
  }
  if (Array.isArray(payload.correction_applications)) {
    for (const candidate of payload.correction_applications) {
      const item = record(candidate);
      if (!item) continue;
      items.push({
        label:
          typeof item.rule_value === "string" && item.rule_value.trim()
            ? copy.businessAdjustment(item.rule_value.trim())
            : copy.businessAdjustmentReviewed,
        text: correctionApplicationSummary(item, copy, locale),
      });
    }
  }
  for (const key of ["evidence", "checks", "items"] as const) {
    const values = payload[key];
    if (!Array.isArray(values)) continue;
    for (const candidate of values) {
      if (typeof candidate === "string" && candidate.trim()) {
        const label = candidate.trim();
        if (!isTechnicalEvidenceText(label)) {
          items.push({ label, text: copy.evidenceStatusReviewed });
        }
        continue;
      }
      const item = record(candidate);
      if (!item) continue;
      const label = firstValue(item, ["label", "title", "summary", "message", "purpose"]);
      if (typeof label === "string" && label.trim()) {
        const businessLabel = label.trim();
        if (!isTechnicalEvidenceText(businessLabel)) {
          items.push({
            label: businessLabel,
            text: evidenceStatus(item.status, copy),
          });
        }
      }
    }
  }
  return items;
}

function correctionApplicationSummary(
  item: Record<string, unknown>,
  copy: ReportBlocksCopy,
  locale: string
): string {
  switch (item.summary_code) {
    case "correction_verified":
      return copy.correctionSummaryVerified;
    case "correction_relationship_verified":
      return copy.correctionSummaryRelationshipVerified;
    case "correction_definition_only":
      return copy.correctionSummaryDefinitionOnly;
    case "correction_failed":
      return copy.correctionSummaryFailed;
  }

  const summary = typeof item.summary === "string" ? item.summary.trim() : "";
  if (summary) {
    const containsCjk = /[\u3400-\u9fff]/u.test(summary);
    const isEnglish = locale.toLowerCase().startsWith("en");
    const isTechnical =
      /\b(sql|python|schema|json|tool|agent|token|api|exception|traceback)\b/i.test(
        summary
      );
    if (isEnglish !== containsCjk && !isTechnical) return summary;
  }
  return evidenceStatus(item.status, copy);
}

function formatChangeNumber(value: unknown, locale: string): string {
  return typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)
    : String(value ?? "—");
}

function changeLine(
  change: Record<string, unknown>,
  copy: ReportBlocksCopy,
  locale: string
): string {
  const metric = typeof change.metric === "string" ? change.metric : copy.metricFallback;
  const delta = typeof change.delta === "number" ? change.delta : null;
  const percent = typeof change.percent_change === "number" ? change.percent_change : null;
  const suffix =
    percent !== null
      ? copy.changePercent(`${percent >= 0 ? "+" : ""}${(percent * 100).toFixed(1)}%`)
      : delta !== null
        ? copy.changeDelta(
            `${delta >= 0 ? "+" : ""}${formatChangeNumber(delta, locale)}`
          )
        : "";
  return copy.changeLine({
    metric,
    before: formatChangeNumber(change.before, locale),
    after: formatChangeNumber(change.after, locale),
    change: suffix,
  });
}

function changeBriefText(
  payload: Record<string, unknown>,
  copy: ReportBlocksCopy,
  locale: string
): string {
  const lines = [
    payload.status === "material_change"
      ? copy.materialChange
      : copy.noMaterialChange,
  ];
  if (Array.isArray(payload.overall)) {
    for (const candidate of payload.overall.slice(0, 4)) {
      const item = record(candidate);
      if (item) lines.push(changeLine(item, copy, locale));
    }
  }
  if (Array.isArray(payload.top_drivers) && payload.top_drivers.length) {
    lines.push(copy.mainDrivers);
    for (const candidate of payload.top_drivers.slice(0, 5)) {
      const driver = record(candidate);
      const key = record(driver?.key);
      const change = record(driver?.change);
      if (!driver || !change) continue;
      const keyLabel = key
        ? Object.values(key).map((value) => String(value)).join(" · ")
        : copy.groupFallback;
      lines.push(
        copy.driverLine({
          group: keyLabel,
          change: changeLine(change, copy, locale),
        })
      );
    }
  } else if (Array.isArray(payload.by_key) && payload.by_key.length) {
    lines.push(copy.changedGroups(payload.by_key.length));
  }
  return lines.join("\n");
}

function artifactContent(
  artifact: AnalysisArtifact,
  copy: ReportBlocksCopy,
  locale: string
): Record<string, unknown> {
  const payload = { ...artifact.payload };
  const type = artifactBlockType(artifact.kind);
  if (artifact.kind === "change_brief") {
    return { ...payload, text: changeBriefText(payload, copy, locale) };
  }
  if (artifact.kind === "chart") {
    if (payload.format === "png" && typeof payload.relative_path === "string") {
      return {
        ...payload,
        image_url: `/api/v1/projects/${artifact.project_id}/analysis-runs/${artifact.analysis_run_id}/artifacts/${artifact.id}/file`,
      };
    }
    const chart = normalizeChartSpec(payload.chart);
    if (chart) {
      return {
        ...payload,
        rows: chart.data,
      };
    }
  }
  if (type === "metric") {
    return {
      ...payload,
      value:
        firstValue(payload, ["value", "metric_value", "amount", "result", "total"]) ??
        "—",
      context:
        firstValue(payload, ["context", "summary", "description", "note"]) ?? "",
    };
  }
  if (type === "text" || type === "evidence") {
    const evidenceItems =
      type === "evidence" ? humanEvidenceItems(payload, copy, locale) : [];
    return {
      ...payload,
      ...(type === "evidence"
        ? {
            items: evidenceItems.length
              ? evidenceItems
              : [
                  {
                    label: copy.evidencePreserved,
                    text: copy.evidencePreservedDetail,
                  },
                ],
          }
        : {}),
      text:
        firstValue(payload, ["text", "summary", "content", "description", "value"]) ??
        "",
    };
  }
  return payload;
}

export function artifactToReportBlock(
  artifact: AnalysisArtifact,
  copy: ReportBlocksCopy,
  locale: string
): ReportBlock {
  const type = artifactBlockType(artifact.kind);
  const chart =
    artifact.kind === "chart" ? normalizeChartSpec(artifact.payload.chart) : null;
  const legacyChart = artifact.kind === "chart" ? record(artifact.payload.chart) : null;
  const isPng = artifact.kind === "chart" && artifact.payload.format === "png";
  const chartType =
    chart?.type || (typeof legacyChart?.type === "string" ? legacyChart.type : "bar");
  const xKey = chart?.encoding.x?.field;
  const yKeys = chart?.encoding.y.map((encoding) => encoding.field) || [];
  const numberFormat = chart?.encoding.y[0]?.format;
  const seriesLabels = chart
    ? Object.fromEntries(
        chart.encoding.y.flatMap((encoding) => {
          const label = encoding.label?.trim();
          return label ? [[encoding.field, label] as const] : [];
        })
      )
    : {};
  const seriesFormats = chart
    ? Object.fromEntries(
        chart.encoding.y.flatMap((encoding) =>
          encoding.format ? [[encoding.field, encoding.format] as const] : []
        )
      )
    : {};
  return {
    id: createLocalId("block"),
    block_type: type,
    title:
      (typeof chart?.title === "string" && chart.title.trim()) ||
      (typeof legacyChart?.title === "string" && legacyChart.title.trim()) ||
      artifact.title ||
      blockTypeLabel(type, copy),
    order_index: 0,
    source_kind: "artifact",
    analysis_run_id: artifact.analysis_run_id,
    artifact_id: artifact.id,
    content: artifactContent(artifact, copy, locale),
    config:
      artifact.kind === "chart"
        ? {
            chart_type: isPng ? "image" : chartType,
            ...(xKey ? { x_key: xKey } : {}),
            ...(yKeys[0] ? { y_key: yKeys[0] } : {}),
            ...(yKeys.length ? { y_keys: yKeys } : {}),
            ...(chart
              ? {
                  orientation: chart.presentation.orientation,
                  stack: chart.presentation.stack,
                  palette: chart.presentation.palette,
                  ...(numberFormat ? { number_format: numberFormat } : {}),
                  ...(Object.keys(seriesLabels).length ? { series_labels: seriesLabels } : {}),
                  ...(Object.keys(seriesFormats).length ? { series_formats: seriesFormats } : {}),
                }
              : {}),
          }
        : defaultConfig(type, copy),
    layout: defaultLayout(type),
  };
}

export function analysisSummaryToReportBlock(
  run: AnalysisHistoryItem,
  copy: ReportBlocksCopy
): ReportBlock {
  return {
    id: createLocalId("block"),
    block_type: "text",
    title: run.report.title?.trim() || run.query.trim() || copy.investigationSummary,
    order_index: 0,
    source_kind: "analysis_run",
    analysis_run_id: run.id,
    artifact_id: null,
    content: {
      text:
        (typeof run.report.summary === "string" && run.report.summary.trim()) ||
        run.query.trim(),
    },
    config: {},
    layout: defaultLayout("text"),
  };
}
