"use client";

import {
  ArrowLeft,
  BookOpenText,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Database,
  FileSpreadsheet,
  Filter,
  FolderTree,
  History,
  ListChecks,
  Loader2,
  PencilLine,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserCheck,
  X,
} from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { SemanticGovernanceDialog } from "@/components/semantic/SemanticGovernanceDialog";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/SearchField";
import { SemanticDetailPanel } from "@/components/semantic/SemanticDetailPanel";
import { SemanticHistoryDialog } from "@/components/semantic/SemanticHistoryDialog";
import { DiscardChangesDialog } from "@/components/ui/DiscardChangesDialog";
import { SemanticSaveRecovery } from "@/components/semantic/SemanticSaveRecovery";
import { SemanticSelectionDialog } from "@/components/semantic/SemanticSelectionDialog";
import { SEMANTIC_SELECTION_LIMIT, reconcileSemanticSelection, removeSemanticSelection, toggleSemanticSelection, type SemanticSelection } from "@/lib/semantic-selection";
import { inspectSemanticBatchResult } from "@/lib/semantic-batch";
import { inspectSemanticSaveEntry, type SemanticSaveTarget } from "@/lib/semantic-save-recovery";
import { SemanticInventoryProgress } from "@/components/semantic/SemanticInventoryProgress";
import {
  normalizeSemanticInventoryJob,
  normalizeSemanticInventoryJobItemPage,
  requestStatus,
  semanticInventoryJobIsActive,
  semanticInventoryReviewItem,
} from "@/components/semantic/semantic-inventory";
import { api } from "@/lib/api/client";
import { SemanticDefinitionEditor } from "@/components/semantic/SemanticDefinitionEditor";
import { useProjectStore } from "@/lib/stores/project";
import { PROJECT_STORAGE_KEY } from "@/lib/storage/legacy";
import {
  UserFacingError,
  type Project,
  type ProjectDataSource,
  type SemanticBatchAction,
  type SemanticEntry,
  type SemanticInventoryJob,
  type SemanticKnowledgePage,
  type SemanticRecommendationResult,
  type SemanticScopeKind,
  type SemanticScopeNode,
  type SemanticSourceScope,
  type SemanticValidationJob,
  type SemanticValidationJobItem,
} from "@/lib/types/api";
import { cn } from "@/lib/utils";
import fieldStyles from "@/components/ui/FieldControl.module.css";

const PAGE_SIZE = 50;

type EntryTypeFilter = SemanticEntry["entry_type"] | "all";
type StateFilter = SemanticEntry["state"] | "all";
type ValidityFilter = SemanticEntry["validity"] | "all";

interface BrowserScopeNode {
  key: string;
  backendId?: string;
  parentKey: string | null;
  kind: SemanticScopeKind;
  businessName: string;
  description: string;
  sourceId?: string;
  sourceLogicalName?: string;
  tableOrView?: string;
  directEntryCount?: number;
  childCount: number;
  depth: number;
}

const TYPE_OPTIONS: EntryTypeFilter[] = [
  "all",
  "scope_presentation",
  "relationship",
  "metric",
  "dimension",
  "business_rule",
  "cleaning_rule",
];

const STATE_OPTIONS: StateFilter[] = ["all", "candidate", "confirmed", "locked"];

const VALIDITY_OPTIONS: ValidityFilter[] = ["all", "unverified", "active", "stale"];

const EDITABLE_TYPE_OPTIONS = TYPE_OPTIONS.filter(
  (option): option is SemanticEntry["entry_type"] =>
    option !== "all" && option !== "scope_presentation"
);

const EDITABLE_STATE_OPTIONS: SemanticEntry["state"][] = [
  "candidate",
  "confirmed",
  "locked",
];

interface RelationshipEndpoint {
  source_logical_name?: string;
  source_kind?: "file" | "connection";
  table_or_view?: string;
  column?: string;
  data_type?: string;
  schema_signature?: string;
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

interface RelationshipDefinition {
  version?: 1;
  left?: RelationshipEndpoint;
  right?: RelationshipEndpoint;
  cardinality?: string | null;
  normalization?: string;
  default_join?: string;
  minimum_left_match_rate?: number;
  maximum_expansion_ratio?: number;
}

interface SourceColumn {
  name: string;
  type: string;
}

interface SourceTable {
  name: string;
  businessName?: string;
  columns: SourceColumn[];
  summary?: string;
}

interface SemanticEditorDraft {
  key: string;
  businessName: string;
  value: string;
  entryType: SemanticEntry["entry_type"];
  state: SemanticEntry["state"];
  scopeKey: string;
  definitionText: string;
  synonymsText: string;
  bindingSourceId: string;
  bindingTable: string;
  bindingColumn: string;
  metricOperation: "sum" | "avg";
  dimensionRole: "time" | "category" | "identifier";
  leftSourceId: string;
  leftTable: string;
  leftColumn: string;
  rightSourceId: string;
  rightTable: string;
  rightColumn: string;
  normalization: "exact" | "trim_casefold" | "identifier" | "auto";
  cardinality: "" | "one_to_one" | "one_to_many" | "many_to_one" | "many_to_many";
  defaultJoin: "left" | "inner";
  minimumLeftMatchRate: string;
  maximumExpansionRatio: string;
}

interface SemanticDisplayContent {
  businessName: string | null;
  description: string | null;
  exampleQuestions: string[];
  synonyms: string[];
  formulaSummary: string | null;
  fieldSummary: string[];
}

type RecommendationGroup = "scope" | "dimension" | "metric" | "relationship" | "other";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const normalized = nonEmptyString(item);
    return normalized ? [normalized] : [];
  });
}

function editableSynonyms(value: string, businessName: string): string[] {
  const normalizedName = businessName.normalize("NFKC").trim().toLocaleLowerCase();
  return Array.from(
    new Set(
      value
        .split(/[\n,，、;；]+/)
        .map((item) => item.normalize("NFKC").trim())
        .filter(
          (item) => item && item.toLocaleLowerCase() !== normalizedName
        )
    )
  );
}

function definitionSynonyms(
  draft: SemanticEditorDraft,
  existing?: Record<string, unknown> | null
): { synonyms?: string[] } {
  const synonyms = editableSynonyms(draft.synonymsText, draft.businessName);
  return synonyms.length || (existing && "synonyms" in existing) ? { synonyms } : {};
}

function presentationRecords(entry: SemanticEntry): Record<string, unknown>[] {
  const definition = isRecord(entry.definition) ? entry.definition : null;
  const records: Record<string, unknown>[] = [];
  if (definition) records.push(definition);
  if (definition && isRecord(definition.presentation)) records.push(definition.presentation);
  if (isRecord(entry.presentation)) records.push(entry.presentation);
  for (const evidence of entry.evidence) {
    if (isRecord(evidence.presentation)) records.push(evidence.presentation);
    records.push(evidence);
  }
  return records;
}

function humanizeFieldIdentifier(value: string, locale: string): string {
  const normalized = value.trim();
  if (locale === "en") {
    return normalized
      .split(/[_\s-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }
  const known: Record<string, string> = {
    order_date: "下单日期",
    order_id: "订单编号",
    refund_amount: "退款金额",
    sales: "销售额",
    sales_amount: "销售额",
    revenue: "收入",
    revenue_amount: "收入",
    cost: "成本",
    cost_amount: "成本",
    gross_profit: "毛利",
    net_profit: "净利润",
    profit: "利润",
    amount: "金额",
    quantity: "数量",
    unit_cost: "单位成本",
    unit_price: "单价",
    published_at: "发布时间",
  };
  const exact = known[normalized.toLowerCase()];
  if (exact) return exact;
  const tokens: Record<string, string> = {
    actual: "实际",
    address: "地址",
    area: "区域",
    category: "类别",
    channel: "渠道",
    code: "编码",
    cost: "成本",
    customer: "客户",
    customers: "客户",
    date: "日期",
    datetime: "时间",
    department: "部门",
    dept: "部门",
    flag: "标记",
    id: "编号",
    is: "是否",
    listing: "上架",
    name: "名称",
    no: "编号",
    number: "编号",
    order: "订单",
    orders: "订单",
    other: "其他",
    price: "价格",
    product: "商品",
    products: "商品",
    quantity: "数量",
    qty: "数量",
    region: "地区",
    sales: "销售",
    account: "客户",
    label: "标签",
    rep: "代表",
    shop: "门店",
    sku: "SKU",
    status: "状态",
    store: "门店",
    time: "时间",
    total: "合计",
    type: "类型",
    unit: "单位",
  };
  const parts = normalized
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .split(/[_\s.-]+/)
    .filter(Boolean);
  const rendered: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index].toLowerCase();
    const next = parts[index + 1]?.toLowerCase();
    if (part === "product" && next === "line") {
      rendered.push("产品线");
      index += 1;
      continue;
    }
    if (part === "account" && next === "rep") {
      rendered.push("客户代表");
      index += 1;
      continue;
    }
    rendered.push(
      /[\u3400-\u9fff]/u.test(part) ? part : tokens[part] || part.toUpperCase()
    );
  }
  return rendered.join(" ").trim() || normalized;
}

function derivedMetricSourceLabels(
  definition: Record<string, unknown>,
  locale: string
): Map<string, string> {
  const labels = new Map<string, string>();
  const rawSources = Array.isArray(definition.sources)
    ? definition.sources
    : isRecord(definition.sources)
      ? Object.entries(definition.sources).map(([key, source]) =>
          isRecord(source) ? { ...source, binding_key: key } : { binding_key: key }
        )
      : [];
  for (const rawSource of rawSources) {
    if (!isRecord(rawSource)) continue;
    const label =
      nonEmptyString(rawSource.business_name) ||
      nonEmptyString(rawSource.business_label) ||
      nonEmptyString(rawSource.label) ||
      nonEmptyString(rawSource.name) ||
      (nonEmptyString(rawSource.action_column)
        ? humanizeFieldIdentifier(String(rawSource.action_column), locale)
        : null) ||
      (nonEmptyString(rawSource.column)
        ? humanizeFieldIdentifier(String(rawSource.column), locale)
        : null);
    if (!label) continue;
    for (const key of [
      "binding_key",
      "id",
      "key",
      "ref",
      "source_ref",
      "alias",
      "name",
      "action_column",
      "column",
    ]) {
      const identity = nonEmptyString(rawSource[key]);
      if (identity) labels.set(identity, label);
    }
  }
  return labels;
}

function humanizeFormulaNode(
  node: unknown,
  sourceLabels: Map<string, string>,
  depth = 0
): string | null {
  if (depth > 8) return null;
  if (typeof node === "number" && Number.isFinite(node)) return String(node);
  if (typeof node === "string" && node.trim()) return sourceLabels.get(node.trim()) || node.trim();
  if (!isRecord(node)) return null;
  if ("expression" in node) {
    const expression = humanizeFormulaNode(node.expression, sourceLabels, depth + 1);
    if (expression) return expression;
  }

  const directLabel =
    nonEmptyString(node.business_name) ||
    nonEmptyString(node.business_label) ||
    nonEmptyString(node.label);
  const reference =
    nonEmptyString(node.ref) ||
    nonEmptyString(node.source_ref) ||
    nonEmptyString(node.binding) ||
    nonEmptyString(node.binding_key) ||
    nonEmptyString(node.field) ||
    nonEmptyString(node.key) ||
    nonEmptyString(node.name);
  if (directLabel && !node.left && !node.right && !node.operands && !node.args) {
    return directLabel;
  }
  if (reference && !node.left && !node.right && !node.operands && !node.args) {
    return sourceLabels.get(reference) || directLabel || reference;
  }
  if ("value" in node && (typeof node.value === "number" || typeof node.value === "string")) {
    return humanizeFormulaNode(node.value, sourceLabels, depth + 1);
  }

  const operation = (
    nonEmptyString(node.op) ||
    nonEmptyString(node.operator) ||
    nonEmptyString(node.operation) ||
    nonEmptyString(node.kind) ||
    ""
  ).toLowerCase();
  const operands = Array.isArray(node.operands)
    ? node.operands
    : Array.isArray(node.args)
      ? node.args
      : [node.left, node.right].filter((item) => item !== undefined);
  const rendered = operands
    .map((item) => humanizeFormulaNode(item, sourceLabels, depth + 1))
    .filter((item): item is string => Boolean(item));
  if (!rendered.length) return directLabel || null;
  const symbols: Record<string, string> = {
    add: "+",
    sum: "+",
    subtract: "−",
    sub: "−",
    minus: "−",
    multiply: "×",
    mul: "×",
    product: "×",
    divide: "÷",
    div: "÷",
    ratio: "÷",
  };
  const symbol = symbols[operation];
  if (symbol && rendered.length >= 2) return rendered.join(` ${symbol} `);
  if ((operation === "negate" || operation === "negative") && rendered[0]) {
    return `−${rendered[0]}`;
  }
  return rendered.length === 1 ? rendered[0] : rendered.join(" · ");
}

function derivedMetricFormula(
  definition: Record<string, unknown> | null,
  locale: string
): string | null {
  if (!definition || definition.kind !== "derived_metric") return null;
  const labels = derivedMetricSourceLabels(definition, locale);
  return humanizeFormulaNode(definition.formula, labels);
}

function semanticDisplayContent(entry: SemanticEntry, locale = "zh"): SemanticDisplayContent {
  const records = presentationRecords(entry);
  const firstString = (
    matchesLocale: (value: string, locale: string) => boolean,
    ...keys: string[]
  ) => {
    for (const record of records) {
      for (const key of keys) {
        const value = nonEmptyString(record[key]);
        if (value && matchesLocale(value, locale)) return value;
      }
    }
    return null;
  };
  const exampleQuestions = Array.from(
    new Set(records.flatMap((record) => stringList(record.example_questions)))
  )
    .filter((value) => businessProseMatchesLocale(value, locale))
    .slice(0, 4);
  const synonyms = Array.from(
    new Set(
      records.flatMap((record) => [
        ...stringList(record.synonyms),
        ...stringList(record.aliases),
        ...stringList(record.alternative_names),
      ])
    )
  )
    .filter((value) => businessNameMatchesLocale(value, locale))
    .slice(0, 12);
  const definition = isRecord(entry.definition) ? entry.definition : null;
  const formulaSummary = derivedMetricFormula(definition, locale);
  const fieldSummary: string[] = [];
  if (definition) {
    const source = isRecord(definition.source) ? definition.source : null;
    if (source) {
      const location = [
        nonEmptyString(source.source_logical_name),
        nonEmptyString(source.table_or_view),
        nonEmptyString(source.action_column) || nonEmptyString(source.column),
      ].filter((part): part is string => Boolean(part));
      const operation = nonEmptyString(definition.operation);
      if (location.length) {
        fieldSummary.push(operation ? `${operation}(${location.join(".")})` : location.join("."));
      }
    }
    if (Array.isArray(definition.sources)) {
      for (const item of definition.sources) {
        if (!isRecord(item)) continue;
        const location = [
          nonEmptyString(item.source_logical_name),
          nonEmptyString(item.table_or_view),
          nonEmptyString(item.action_column) || nonEmptyString(item.column),
        ].filter((part): part is string => Boolean(part));
        if (location.length) fieldSummary.push(location.join("."));
      }
    }
    const relationship = relationshipDefinition(entry);
    if (relationship?.left || relationship?.right) {
      const endpoint = (value?: RelationshipEndpoint) =>
        [value?.source_logical_name, value?.table_or_view, value?.column]
          .filter(Boolean)
          .join(".");
      const left = endpoint(relationship.left);
      const right = endpoint(relationship.right);
      if (left || right) fieldSummary.push([left, right].filter(Boolean).join(" → "));
    }
    for (const key of ["calculation_fields", "value_fields", "fields", "columns"]) {
      fieldSummary.push(...stringList(definition[key]));
    }
    const expression =
      definition.kind === "derived_metric"
        ? null
        : nonEmptyString(definition.formula) || nonEmptyString(definition.expression);
    if (expression) fieldSummary.push(expression);
  }
  if (!fieldSummary.length) {
    for (const record of records) {
      const table = nonEmptyString(record.table) || nonEmptyString(record.table_or_view);
      const column = nonEmptyString(record.column) || nonEmptyString(record.action_column);
      if (table || column) fieldSummary.push([table, column].filter(Boolean).join("."));
      fieldSummary.push(...stringList(record.fields), ...stringList(record.columns));
    }
  }
  return {
    businessName: firstString(
      businessNameMatchesLocale,
      "business_name",
      "business_label",
      "display_name"
    ),
    description: firstString(
      businessProseMatchesLocale,
      "description",
      "purpose",
      "business_description"
    ),
    exampleQuestions,
    synonyms,
    formulaSummary,
    fieldSummary: Array.from(new Set(fieldSummary.filter(Boolean))).slice(0, 6),
  };
}

function recommendationGroup(entry: SemanticEntry): RecommendationGroup {
  if (entry.entry_type === "scope_presentation") return "scope";
  if (entry.entry_type === "dimension") return "dimension";
  if (entry.entry_type === "metric") return "metric";
  if (entry.entry_type === "relationship") return "relationship";
  return "other";
}

function recommendationGroupLabel(entry: SemanticEntry, t: Translate): string {
  return t(`recommendationGroup.${recommendationGroup(entry)}`);
}

function recommendationGroupRank(entry: SemanticEntry): number {
  return ["scope", "dimension", "metric", "relationship", "other"].indexOf(
    recommendationGroup(entry)
  );
}

function sortRecommendationEntries(entries: SemanticEntry[]): SemanticEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (left, right) =>
        recommendationGroupRank(left.entry) - recommendationGroupRank(right.entry) ||
        left.index - right.index
    )
    .map(({ entry }) => entry);
}

function technicalFieldNames(entry: SemanticEntry): string[] {
  const definition = isRecord(entry.definition) ? entry.definition : null;
  const names = new Set<string>();
  const addSource = (source: unknown) => {
    if (!isRecord(source)) return;
    for (const key of ["action_column", "column"]) {
      const value = nonEmptyString(source[key]);
      if (value) names.add(value);
    }
  };
  if (definition) {
    addSource(definition.source);
    if (Array.isArray(definition.sources)) definition.sources.forEach(addSource);
    else if (isRecord(definition.sources)) Object.values(definition.sources).forEach(addSource);
  }
  const relationship = relationshipDefinition(entry);
  if (relationship?.left?.column) names.add(relationship.left.column);
  if (relationship?.right?.column) names.add(relationship.right.column);
  return Array.from(names);
}

function rawPresentationBusinessName(entry: SemanticEntry): string | null {
  for (const record of presentationRecords(entry)) {
    for (const key of ["business_name", "business_label", "display_name"]) {
      const value = nonEmptyString(record[key]);
      if (value) return value;
    }
  }
  return null;
}

function looksLikeUntranslatedField(entry: SemanticEntry, _locale: string): boolean {
  const title = rawPresentationBusinessName(entry) || entry.value;
  if (!title) return false;
  if (/^(?:待命名|未命名|名称待确认)(?:[（(].+[）)])?$/u.test(title.trim())) return true;
  if (/^(?:unnamed|name (?:needed|required))(?:\s*[（(].+[）)])?$/iu.test(title.trim())) {
    return true;
  }
  const comparable = title.normalize("NFKC").trim().toLowerCase().replace(/[\s_.-]+/g, "");
  return technicalFieldNames(entry).some(
    (field) =>
      field.normalize("NFKC").trim().toLowerCase().replace(/[\s_.-]+/g, "") === comparable
  );
}

function hasChineseBusinessCopy(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value);
}

function businessNameMatchesLocale(value: string, locale: string): boolean {
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/iu.test(normalized)) {
    return false;
  }
  if (locale === "en") return !hasChineseBusinessCopy(normalized);
  return (
    hasChineseBusinessCopy(normalized) ||
    /^[A-Z][A-Z0-9&%/+\-×().\s]{1,20}$/u.test(normalized)
  );
}

function businessProseMatchesLocale(value: string, locale: string): boolean {
  return locale === "en"
    ? !hasChineseBusinessCopy(value)
    : hasChineseBusinessCopy(value);
}

function containsTechnicalField(value: string, entry: SemanticEntry): boolean {
  const compact = value.normalize("NFKC").toLowerCase().replace(/[\s_.-]+/g, "");
  return technicalFieldNames(entry).some((field) => {
    const normalized = field.normalize("NFKC").toLowerCase().replace(/[\s_.-]+/g, "");
    return normalized.length >= 3 && compact.includes(normalized);
  });
}

function containsImplementationDetail(value: string): boolean {
  return (
    /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/iu.test(value) ||
    /\b(?:select|from|join|where|group by|order by|sum|avg|count|schema|json|sql)\b/iu.test(
      value
    ) ||
    /(?:技术标识|技术绑定|结构化 JSON|系统固定生成|固定公式|候选(?:派生)?指标)/u.test(
      value
    )
  );
}

function userFacingDisplayContent(
  entry: SemanticEntry,
  locale: string
): SemanticDisplayContent {
  const display = semanticDisplayContent(entry, locale);
  return {
    ...display,
    description:
      display.description &&
      !containsTechnicalField(display.description, entry) &&
      !containsImplementationDetail(display.description) &&
      businessProseMatchesLocale(display.description, locale)
        ? display.description
        : null,
    exampleQuestions: display.exampleQuestions.filter(
      (question) =>
        !containsTechnicalField(question, entry) &&
        !/(?:待命名|未命名|unnamed)/iu.test(question) &&
        businessProseMatchesLocale(question, locale)
    ),
    synonyms: display.synonyms.filter(
      (synonym) =>
        !containsTechnicalField(synonym, entry) &&
        !/(?:待命名|未命名|unnamed)/iu.test(synonym) &&
        businessNameMatchesLocale(synonym, locale)
    ),
  };
}

function untranslatedFieldPlaceholder(entry: SemanticEntry, t: Translate): string {
  return entry.state === "candidate"
    ? t("list.untranslatedCandidate")
    : t("list.untranslatedAdopted");
}

export function relationshipDefinition(entry: SemanticEntry): RelationshipDefinition | null {
  if (entry.entry_type !== "relationship" || !isRecord(entry.definition)) return null;
  return entry.definition as RelationshipDefinition;
}

function projectSourceLogicalName(source: ProjectDataSource): string {
  const logicalName = source.profile_data.logical_name;
  return typeof logicalName === "string" && logicalName.trim()
    ? logicalName.trim()
    : source.name;
}

function projectSourceBusinessName(source: ProjectDataSource): string {
  const presentation = isRecord(source.profile_data.presentation)
    ? source.profile_data.presentation
    : {};
  return (
    nonEmptyString(source.profile_data.business_name) ||
    nonEmptyString(source.profile_data.display_name) ||
    nonEmptyString(presentation.business_name) ||
    source.name
  );
}

function sourceIdsFromEntry(entry: SemanticEntry | null): string[] {
  if (!entry) return [];
  const ids = entry.evidence.flatMap((item) => {
    if (!Array.isArray(item.source_ids)) return [];
    return item.source_ids.filter(
      (sourceId): sourceId is string => typeof sourceId === "string" && Boolean(sourceId)
    );
  });
  if (!ids.length) {
    ids.push(
      ...(entry.source_refs || []).flatMap((source) =>
        source.source_id ? [source.source_id] : []
      )
    );
  }
  return Array.from(new Set(ids));
}

function semanticSourceLabel(entry: SemanticEntry, t: Translate, locale: string): string {
  if (entry.source_scope === "project") return t("scope.project");
  if (entry.source_scope === "unresolved") return t("scope.unresolved");
  const names = Array.from(
    new Set(
      (entry.source_refs || [])
        .map((source) => source.logical_name || source.name)
        .filter(Boolean)
      )
  );
  if (!names.length && entry.entry_type === "relationship") {
    const relationship = relationshipDefinition(entry);
    names.push(
      ...Array.from(
        new Set(
          [relationship?.left?.source_logical_name, relationship?.right?.source_logical_name]
            .filter((name): name is string => Boolean(name))
        )
      )
    );
  }
  const listFormatter = new Intl.ListFormat(locale, { style: "short", type: "conjunction" });
  const namesLabel =
    names.length === 1
      ? names[0]
      : names.length === 2
        ? listFormatter.format(names)
        : names.length > 2
          ? t("scope.namedMany", {
              names: listFormatter.format(names.slice(0, 2)),
              count: names.length,
            })
          : "";
  if (entry.source_scope === "cross_source") {
    return namesLabel ? t("scope.crossSourceNamed", { names: namesLabel }) : t("scope.crossSource");
  }
  if (namesLabel) return namesLabel;
  const labelKeys: Record<SemanticSourceScope, string> = {
    project: "scope.project",
    local_database: "scope.localDatabase",
    remote_database: "scope.remoteDatabase",
    csv: "scope.csv",
    excel: "scope.excel",
    parquet: "scope.parquet",
    json: "scope.json",
    other_file: "scope.otherFile",
    cross_source: "scope.crossSource",
    unresolved: "scope.unresolved",
  };
  return entry.source_scope ? t(labelKeys[entry.source_scope]) : t("scope.unresolved");
}

function normalizeSourceColumns(value: unknown): SourceColumn[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((column) => {
    if (!isRecord(column) || typeof column.name !== "string" || !column.name.trim()) return [];
    return [
      {
        name: column.name.trim(),
        type:
          typeof column.type === "string"
            ? column.type
            : typeof column.dtype === "string"
              ? column.dtype
              : "unknown",
      },
    ];
  });
}

function qualifiedRelationName(record: Record<string, unknown>): string | null {
  const name = nonEmptyString(record.name);
  if (!name) return null;
  const schema = nonEmptyString(record.schema);
  return schema ? `${schema}.${name}` : name;
}

function relationIdentity(record: Record<string, unknown>): string | null {
  const name = nonEmptyString(record.name);
  if (!name) return null;
  return `${nonEmptyString(record.schema) || ""}\u0000${name}`;
}

function mergedRelationTableRecords(source: ProjectDataSource): Record<string, unknown>[] {
  const preanalysis = isRecord(source.profile_data.preanalysis)
    ? source.profile_data.preanalysis
    : {};
  const relationIndex = isRecord(source.profile_data.relation_index)
    ? source.profile_data.relation_index
    : isRecord(preanalysis.relation_index)
      ? preanalysis.relation_index
      : {};
  const profiledTables = Array.isArray(source.profile_data.tables)
    ? source.profile_data.tables.filter(isRecord)
    : [];
  const indexedRelations = Array.isArray(relationIndex.relations)
    ? relationIndex.relations.filter(isRecord)
    : [];
  if (!indexedRelations.length) return profiledTables;

  const profilesByIdentity = new Map(
    profiledTables.flatMap((table) => {
      const identity = relationIdentity(table);
      return identity ? [[identity, table] as const] : [];
    })
  );
  const profilesByName = new Map<string, Record<string, unknown>[]>();
  for (const table of profiledTables) {
    const name = nonEmptyString(table.name);
    if (!name) continue;
    profilesByName.set(name, [...(profilesByName.get(name) || []), table]);
  }
  const indexedNameCounts = new Map<string, number>();
  for (const relation of indexedRelations) {
    const name = nonEmptyString(relation.name);
    if (name) indexedNameCounts.set(name, (indexedNameCounts.get(name) || 0) + 1);
  }

  const matchedProfiles = new Set<Record<string, unknown>>();
  const mergedRelations = indexedRelations.map((relation) => {
    const identity = relationIdentity(relation);
    const name = nonEmptyString(relation.name);
    const sameNamedProfiles = name ? profilesByName.get(name) || [] : [];
    const profile =
      (identity ? profilesByIdentity.get(identity) : undefined) ||
      (name && indexedNameCounts.get(name) === 1 && sameNamedProfiles.length === 1
        ? sameNamedProfiles[0]
        : undefined);
    if (profile) matchedProfiles.add(profile);
    return profile ? { ...profile, ...relation } : relation;
  });

  if (relationIndex.complete !== false) return mergedRelations;
  return [
    ...mergedRelations,
    ...profiledTables.filter((table) => !matchedProfiles.has(table)),
  ];
}

function sourceTables(source?: ProjectDataSource): SourceTable[] {
  if (!source) return [];
  if (source.kind === "file") {
    const schema = isRecord(source.profile_data.schema) ? source.profile_data.schema : {};
    return [
      {
        name: projectSourceLogicalName(source),
        businessName:
          nonEmptyString(source.profile_data.business_name) ||
          nonEmptyString(source.profile_data.display_name) ||
          undefined,
        columns: normalizeSourceColumns(schema.columns),
        summary:
          nonEmptyString(source.profile_data.description) ||
          nonEmptyString(source.profile_data.business_topic) ||
          undefined,
      },
    ];
  }
  return mergedRelationTableRecords(source).flatMap((table) => {
    const qualifiedName = qualifiedRelationName(table);
    if (!qualifiedName) return [];
    return [
      {
        name: qualifiedName,
        businessName:
          nonEmptyString(table.business_name) ||
          nonEmptyString(table.display_name) ||
          undefined,
        columns: normalizeSourceColumns(table.columns),
        summary:
          nonEmptyString(table.description) ||
          nonEmptyString(table.business_topic) ||
          nonEmptyString(table.comment) ||
          undefined,
      },
    ];
  });
}

function semanticScopeNodes(value: unknown): SemanticScopeNode[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.stable_key !== "string" ||
      typeof item.business_name !== "string" ||
      !["project", "source", "table", "context", "period"].includes(String(item.kind))
    ) {
      return [];
    }
    return [item as unknown as SemanticScopeNode];
  });
}

function fallbackScopeKey(kind: SemanticScopeKind, ...parts: string[]): string {
  return `fallback:${kind}:${parts.map((part) => encodeURIComponent(part)).join(":")}`;
}

function sourceSummary(source: ProjectDataSource, t: Translate): string {
  return (
    nonEmptyString(source.profile_data.description) ||
    nonEmptyString(source.profile_data.business_topic) ||
    (source.kind === "connection" ? t("scopeTree.databaseSummary") : t("scopeTree.fileSummary"))
  );
}

function scopeDisplayName(
  businessName: string | null | undefined,
  physicalName: string | null | undefined,
  kind: "source" | "table",
  locale: string
): string {
  const business = businessName?.trim() || "";
  const physical = physicalName?.trim() || "";
  const sameAsPhysical =
    business &&
    physical &&
    business.normalize("NFKC").toLowerCase() === physical.normalize("NFKC").toLowerCase();
  if (business && (!sameAsPhysical || /[\u3400-\u9fff]/u.test(business))) return business;
  if (locale === "en") {
    return (
      humanizeFieldIdentifier(physical || business, locale) ||
      (kind === "table" ? "Data table" : "Data source")
    );
  }

  const tokens = (physical || business)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .split(/[^a-zA-Z0-9\u3400-\u9fff]+/)
    .filter(Boolean);
  const year = tokens.find((token) => /^(?:19|20)\d{2}$/.test(token));
  const ignored = new Set(["d", "dim", "f", "fact", "info", "new", "tbl", "table", "v", "view"]);
  const topicTokens = tokens.filter(
    (token) => token !== year && !ignored.has(token.toLowerCase())
  );
  const readable = humanizeFieldIdentifier(topicTokens.join("_"), locale);
  if (kind === "table") {
    if (year && readable) return `${year} 年${readable}资料`;
    return readable ? `${readable}资料` : "数据表";
  }
  return readable ? `${readable}数据源` : "数据源";
}

function scopeContextSummary(scope: SemanticScopeNode, t: Translate): string | null {
  const facts = isRecord(scope.context_facts) ? scope.context_facts : {};
  const year = typeof facts.year === "number" ? facts.year : null;
  const month = typeof facts.month === "number" ? facts.month : null;
  const topic = nonEmptyString(facts.business_topic);
  if (year && month && topic) return t("scopeTree.periodMonthTopic", { year, month, topic });
  if (year && topic) return t("scopeTree.periodYearTopic", { year, topic });
  if (year && month) return t("scopeTree.periodMonth", { year, month });
  if (year) return t("scopeTree.periodYear", { year });
  return topic;
}

function buildBrowserScopes(
  serverScopes: SemanticScopeNode[],
  sources: ProjectDataSource[],
  locale: string,
  t: Translate
): BrowserScopeNode[] {
  if (serverScopes.length) {
    const activeScopes = serverScopes.filter(
      (scope) => scope.is_active !== false && scope.kind !== "project"
    );
    const keyById = new Map(activeScopes.map((scope) => [scope.id, `scope:${scope.id}`]));
    const projectIds = new Set(
      serverScopes.filter((scope) => scope.kind === "project").map((scope) => scope.id)
    );
    return serverScopes
      .filter((scope) => scope.is_active !== false && scope.kind !== "project")
      .map((scope) => {
        const source = sources.find(
          (candidate) =>
            projectSourceLogicalName(candidate) === scope.source_logical_name ||
            candidate.name === scope.source_logical_name
        );
        return {
          key: keyById.get(scope.id) || `scope:${scope.id}`,
          backendId: scope.id,
          parentKey:
            scope.parent_id && !projectIds.has(scope.parent_id)
              ? keyById.get(scope.parent_id) || null
              : null,
          kind: scope.kind,
          businessName:
            scope.kind === "source"
              ? scopeDisplayName(
                  scope.business_name,
                  scope.source_logical_name,
                  "source",
                  locale
                )
              : scope.kind === "table"
                ? scopeDisplayName(
                    scope.business_name,
                    scope.table_or_view,
                    "table",
                    locale
                  )
                : scope.business_name,
          description:
            scopeContextSummary(scope, t) ||
            (scope.kind === "project"
              ? t("scopeTree.projectSummary")
              : scope.kind === "source"
                ? source
                  ? sourceSummary(source, t)
                  : t("scopeTree.sourceSummary")
                : scope.kind === "table"
                  ? t("scopeTree.tableSummary")
                  : nonEmptyString(scope.description) || t("scopeTree.contextSummary")),
          sourceId: source?.id,
          sourceLogicalName: nonEmptyString(scope.source_logical_name) || undefined,
          tableOrView: nonEmptyString(scope.table_or_view) || undefined,
          directEntryCount: Math.max(0, Number(scope.direct_entry_count) || 0),
          childCount: Math.max(0, Number(scope.child_count) || 0),
          depth: Math.max(0, (scope.path?.length || 1) - 2),
        } satisfies BrowserScopeNode;
      });
  }

  const nodes: BrowserScopeNode[] = [];
  for (const source of sources) {
    const logicalName = projectSourceLogicalName(source);
    const sourceKey = fallbackScopeKey("source", source.id);
    const tables = sourceTables(source);
    nodes.push({
      key: sourceKey,
      parentKey: null,
      kind: "source",
      businessName: scopeDisplayName(
        projectSourceBusinessName(source),
        logicalName,
        "source",
        locale
      ),
      description: sourceSummary(source, t),
      sourceId: source.id,
      sourceLogicalName: logicalName,
      childCount: tables.length,
      depth: 0,
    });
    for (const table of tables) {
      nodes.push({
        key: fallbackScopeKey("table", source.id, table.name),
        parentKey: sourceKey,
        kind: "table",
        businessName: scopeDisplayName(
          table.businessName ||
            (source.kind === "file" ? t("scopeTree.fileView") : null),
          table.name,
          "table",
          locale
        ),
        description: table.summary || t("scopeTree.tableSummary"),
        sourceId: source.id,
        sourceLogicalName: logicalName,
        tableOrView: table.name,
        childCount: 0,
        depth: 1,
      });
    }
  }
  return nodes;
}

function scopeTableNames(entry: SemanticEntry): string[] {
  const names = new Set<string>();
  for (const pathItem of entry.scope_path || []) {
    if (pathItem.table_or_view) names.add(pathItem.table_or_view);
  }
  const definition = isRecord(entry.definition) ? entry.definition : null;
  const addRecord = (record: unknown) => {
    if (!isRecord(record)) return;
    const table = nonEmptyString(record.table_or_view) || nonEmptyString(record.table);
    if (table) names.add(table);
  };
  if (definition) {
    addRecord(definition.source);
    if (Array.isArray(definition.sources)) definition.sources.forEach(addRecord);
    else if (isRecord(definition.sources)) Object.values(definition.sources).forEach(addRecord);
  }
  const relationship = relationshipDefinition(entry);
  addRecord(relationship?.left);
  addRecord(relationship?.right);
  return Array.from(names);
}

function browserScopePath(
  scope: BrowserScopeNode,
  allScopes: BrowserScopeNode[]
): BrowserScopeNode[] {
  const path: BrowserScopeNode[] = [];
  let cursor: BrowserScopeNode | undefined = scope;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.key)) {
    path.unshift(cursor);
    seen.add(cursor.key);
    cursor = cursor.parentKey
      ? allScopes.find((candidate) => candidate.key === cursor?.parentKey)
      : undefined;
  }
  return path;
}

function scopeBreadcrumb(
  entry: SemanticEntry,
  currentScope: BrowserScopeNode | undefined,
  allScopes: BrowserScopeNode[],
  t: Translate
): string {
  const exactScope = entry.scope_id
    ? allScopes.find((scope) => scope.backendId === entry.scope_id)
    : undefined;
  if (exactScope) {
    return browserScopePath(exactScope, allScopes)
      .map((scope) => scope.businessName)
      .join(" / ");
  }

  const storedScope = [...(entry.scope_path || [])]
    .reverse()
    .map((item) => allScopes.find((scope) => scope.backendId === item.id))
    .find((scope): scope is BrowserScopeNode => Boolean(scope));
  if (storedScope) {
    return browserScopePath(storedScope, allScopes)
      .map((scope) => scope.businessName)
      .join(" / ");
  }

  const storedNames = (entry.scope_path || [])
    .map((item) => item.business_name)
    .filter(Boolean);
  if (
    storedNames.length &&
    storedNames.every(
      (name) =>
        !/_[0-9a-f]{6,}$/i.test(name) &&
        (!/[a-z0-9]+_[a-z0-9_]+/i.test(name) || /[\u3400-\u9fff]/u.test(name))
    )
  ) {
    return storedNames.join(" / ");
  }

  // Non-project pages are exact-scope views even on the legacy API. Prefer the
  // selected business path so source refs such as `orders_4f9eeb` never leak.
  if (currentScope && currentScope.kind !== "project") {
    return browserScopePath(currentScope, allScopes)
      .map((scope) => scope.businessName)
      .join(" / ");
  }

  const sourceRefs = entry.source_refs || [];
  const sourceScopes = allScopes.filter(
    (scope) =>
      scope.kind === "source" &&
      sourceRefs.some(
        (source) =>
          source.source_id === scope.sourceId ||
          source.logical_name === scope.sourceLogicalName ||
          source.name === scope.businessName
      )
  );
  const tableNames = new Set(scopeTableNames(entry));
  const mappedTable = allScopes.find(
    (scope) =>
      scope.kind === "table" &&
      Boolean(scope.tableOrView && tableNames.has(scope.tableOrView)) &&
      (!sourceScopes.length || sourceScopes.some((source) => source.key === scope.parentKey))
  );
  const mappedScope = mappedTable || sourceScopes[0];
  if (mappedScope) {
    return browserScopePath(mappedScope, allScopes)
      .map((scope) => scope.businessName)
      .join(" / ");
  }

  if (currentScope) {
    return browserScopePath(currentScope, allScopes)
      .map((scope) => scope.businessName)
      .join(" / ");
  }
  return t("header.allDefinitions");
}

function internalSemanticKey(
  businessName: string,
  entryType: SemanticEntry["entry_type"],
  scopeKey: string
): string {
  const input = `${scopeKey}\u0000${entryType}\u0000${businessName.normalize("NFKC").trim().toLowerCase()}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `semantic:${entryType}:${(hash >>> 0).toString(36)}`;
}

function sourceForEndpoint(
  sources: ProjectDataSource[],
  endpoint?: RelationshipEndpoint
): ProjectDataSource | undefined {
  if (!endpoint) return undefined;
  return sources.find(
    (source) =>
      projectSourceLogicalName(source) === endpoint.source_logical_name &&
      (!endpoint.source_kind || source.kind === endpoint.source_kind)
  );
}

function relationshipDraft(
  entry: SemanticEntry | null,
  sources: ProjectDataSource[],
  scopeKey = ""
): SemanticEditorDraft {
  const definition = entry ? relationshipDefinition(entry) : null;
  const typedDefinition = entry?.definition && isRecord(entry.definition) ? entry.definition : null;
  const binding = typedDefinition && isRecord(typedDefinition.source) ? typedDefinition.source : null;
  const bindingSource = binding
    ? sources.find(
        (source) =>
          projectSourceLogicalName(source) === binding.source_logical_name &&
          (!binding.source_kind || source.kind === binding.source_kind)
      )
    : undefined;
  const display = entry ? semanticDisplayContent(entry) : null;
  const alternate = entry ? semanticDisplayContent(entry, "en") : null;
  return {
    key: entry?.key || "",
    businessName: display?.businessName || alternate?.businessName || entry?.value || "",
    value: entry?.value || "",
    entryType: entry?.entry_type || "business_rule",
    state: entry?.state || "candidate",
    scopeKey: entry?.scope_id ? `scope:${entry.scope_id}` : scopeKey,
    definitionText:
      entry?.entry_type !== "relationship" && entry?.definition
        ? JSON.stringify(entry.definition, null, 2)
        : "",
    synonymsText: Array.from(new Set([...(display?.synonyms || []), ...(alternate?.synonyms || [])])).join("、"),
    bindingSourceId: bindingSource?.id || "",
    bindingTable: nonEmptyString(binding?.table_or_view) || "",
    bindingColumn:
      nonEmptyString(binding?.action_column) || nonEmptyString(binding?.column) || "",
    metricOperation:
      typedDefinition?.operation === "avg" || typedDefinition?.aggregate === "avg"
        ? "avg"
        : "sum",
    dimensionRole:
      typedDefinition?.role === "time" ||
      typedDefinition?.role === "identifier"
        ? typedDefinition.role
        : "category",
    leftSourceId: sourceForEndpoint(sources, definition?.left)?.id || "",
    leftTable: definition?.left?.table_or_view || "",
    leftColumn: definition?.left?.column || "",
    rightSourceId: sourceForEndpoint(sources, definition?.right)?.id || "",
    rightTable: definition?.right?.table_or_view || "",
    rightColumn: definition?.right?.column || "",
    normalization:
      definition?.normalization === "exact" ||
      definition?.normalization === "trim_casefold" ||
      definition?.normalization === "identifier"
        ? definition.normalization
        : "auto",
    cardinality:
      definition?.cardinality === "one_to_one" ||
      definition?.cardinality === "one_to_many" ||
      definition?.cardinality === "many_to_one" ||
      definition?.cardinality === "many_to_many"
        ? definition.cardinality
        : "",
    defaultJoin: definition?.default_join === "inner" ? "inner" : "left",
    minimumLeftMatchRate: String(definition?.minimum_left_match_rate ?? 0.8),
    maximumExpansionRatio: String(definition?.maximum_expansion_ratio ?? 1.2),
  };
}

async function schemaSignature(columns: SourceColumn[], t: Translate): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new UserFacingError(t("errors.schemaSignatureUnavailable"));
  }
  const payload = JSON.stringify(
    columns
      .map((column) => ({ name: column.name, type: column.type || "unknown" }))
      .sort((left, right) => {
        if (left.name !== right.name) return left.name < right.name ? -1 : 1;
        if (left.type === right.type) return 0;
        return left.type < right.type ? -1 : 1;
      })
  );
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload)
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function relationshipEndpointFromDraft(
  sources: ProjectDataSource[],
  sourceId: string,
  tableName: string,
  columnName: string,
  existing: RelationshipEndpoint | undefined,
  t: Translate
): Promise<Required<RelationshipEndpoint>> {
  const source = sources.find((item) => item.id === sourceId);
  const normalizedTable = tableName.trim();
  const normalizedColumn = columnName.trim();
  if (!source) {
    if (
      existing?.source_logical_name &&
      existing.source_kind &&
      existing.table_or_view === normalizedTable &&
      existing.column === normalizedColumn &&
      existing.data_type &&
      existing.schema_signature
    ) {
      return existing as Required<RelationshipEndpoint>;
    }
    throw new UserFacingError(t("errors.relationshipSourceRequired"));
  }
  const table = sourceTables(source).find((item) => item.name === normalizedTable);
  if (!table) {
    throw new UserFacingError(t("errors.tableNotFound", { table: normalizedTable }));
  }
  const column = table.columns.find((item) => item.name === normalizedColumn);
  if (!column) {
    throw new UserFacingError(
      t("errors.columnNotFound", { table: normalizedTable, column: normalizedColumn })
    );
  }
  return {
    source_logical_name: projectSourceLogicalName(source),
    source_kind: source.kind,
    table_or_view: table.name,
    column: column.name,
    data_type: column.type,
    schema_signature: await schemaSignature(table.columns, t),
  };
}

function canonicalSemanticType(value: string): "boolean" | "number" | "datetime" | "text" {
  const normalized = value.toLowerCase();
  if (/bool/.test(normalized)) return "boolean";
  if (/date|time/.test(normalized)) return "datetime";
  if (/int|decimal|numeric|number|float|double|real/.test(normalized)) return "number";
  return "text";
}

async function sourceBindingFromDraft(
  draft: SemanticEditorDraft,
  sources: ProjectDataSource[],
  t: Translate,
  existing?: Record<string, unknown> | null
): Promise<Record<string, unknown>> {
  const source = sources.find((item) => item.id === draft.bindingSourceId);
  if (!source) {
    if (
      existing &&
      nonEmptyString(existing.source_logical_name) &&
      nonEmptyString(existing.table_or_view) === draft.bindingTable.trim() &&
      (nonEmptyString(existing.action_column) || nonEmptyString(existing.column)) ===
        draft.bindingColumn.trim() &&
      nonEmptyString(existing.schema_signature)
    ) {
      return existing;
    }
    throw new UserFacingError(t("errors.bindingSourceRequired"));
  }
  const tableName = draft.bindingTable.trim();
  const table = sourceTables(source).find((item) => item.name === tableName);
  if (!table) throw new UserFacingError(t("errors.tableNotFound", { table: tableName }));
  const columnName = draft.bindingColumn.trim();
  const column = table.columns.find((item) => item.name === columnName);
  if (!column) {
    throw new UserFacingError(
      t("errors.columnNotFound", { table: tableName, column: columnName })
    );
  }
  return {
    source_logical_name: projectSourceLogicalName(source),
    source_kind: source.kind,
    table_or_view: table.name,
    action_column: column.name,
    canonical_type: canonicalSemanticType(column.type),
    schema_signature: await schemaSignature(table.columns, t),
  };
}

async function editorDefinition(
  draft: SemanticEditorDraft,
  sources: ProjectDataSource[],
  entry: SemanticEntry | null,
  t: Translate
): Promise<Record<string, unknown> | null> {
  if (draft.entryType === "relationship") {
    const current = entry ? relationshipDefinition(entry) : null;
    const minimumLeftMatchRate = Number(draft.minimumLeftMatchRate);
    const maximumExpansionRatio = Number(draft.maximumExpansionRatio);
    if (
      !Number.isFinite(minimumLeftMatchRate) ||
      minimumLeftMatchRate < 0 ||
      minimumLeftMatchRate > 1
    ) {
      throw new UserFacingError(t("errors.minimumMatchRate"));
    }
    if (!Number.isFinite(maximumExpansionRatio) || maximumExpansionRatio < 1) {
      throw new UserFacingError(t("errors.maximumExpansionRatio"));
    }
    return {
      version: 1,
      business_name: draft.businessName.trim(),
      description: draft.value.trim(),
      ...definitionSynonyms(draft, isRecord(entry?.definition) ? entry.definition : null),
      left: await relationshipEndpointFromDraft(
        sources,
        draft.leftSourceId,
        draft.leftTable,
        draft.leftColumn,
        current?.left,
        t
      ),
      right: await relationshipEndpointFromDraft(
        sources,
        draft.rightSourceId,
        draft.rightTable,
        draft.rightColumn,
        current?.right,
        t
      ),
      normalization: draft.normalization,
      cardinality: draft.cardinality || null,
      default_join: draft.defaultJoin,
      minimum_left_match_rate: minimumLeftMatchRate,
      maximum_expansion_ratio: maximumExpansionRatio,
    };
  }

  const existingDefinition = entry?.definition && isRecord(entry.definition)
    ? entry.definition
    : null;
  if (draft.entryType === "metric" && existingDefinition?.kind === "derived_metric") {
    return {
      ...existingDefinition,
      business_name: draft.businessName.trim(),
      description: draft.value.trim(),
      ...definitionSynonyms(draft, existingDefinition),
    };
  }
  if (draft.entryType === "metric") {
    const preservedExamples = stringList(existingDefinition?.example_questions);
    const existingBinding = isRecord(existingDefinition?.source)
      ? existingDefinition.source
      : null;
    return {
      version: 1,
      kind: "aggregate_metric",
      operation: draft.metricOperation,
      source: await sourceBindingFromDraft(draft, sources, t, existingBinding),
      null_policy: "ignore",
      business_name: draft.businessName.trim(),
      description: draft.value.trim(),
      example_questions: preservedExamples,
      ...definitionSynonyms(draft, existingDefinition),
    };
  }
  if (draft.entryType === "dimension") {
    const preservedExamples = stringList(existingDefinition?.example_questions);
    const preservedGranularities = stringList(existingDefinition?.time_granularities);
    const preservedTimezone = nonEmptyString(existingDefinition?.timezone);
    const existingBinding = isRecord(existingDefinition?.source)
      ? existingDefinition.source
      : null;
    return {
      version: 1,
      kind: "dimension",
      role: draft.dimensionRole,
      source: await sourceBindingFromDraft(draft, sources, t, existingBinding),
      business_name: draft.businessName.trim(),
      description: draft.value.trim(),
      example_questions: preservedExamples,
      ...definitionSynonyms(draft, existingDefinition),
      time_granularities:
        draft.dimensionRole === "time" ? preservedGranularities : [],
      timezone: draft.dimensionRole === "time" ? preservedTimezone : null,
    };
  }

  if (draft.entryType === "scope_presentation") {
    return {
      ...(existingDefinition || {}),
      version: 1,
      kind: "scope_presentation",
      business_name: draft.businessName.trim(),
      description: draft.value.trim(),
      ...definitionSynonyms(draft, existingDefinition),
    };
  }

  const raw = draft.definitionText.trim();
  if (!raw) {
    return {
      business_name: draft.businessName.trim(),
      description: draft.value.trim(),
      ...definitionSynonyms(draft, existingDefinition),
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new UserFacingError(t("errors.invalidJson"));
  }
  if (!isRecord(parsed)) throw new UserFacingError(t("errors.jsonObjectRequired"));
  const kind = parsed.kind;
  const definitionVariant =
    kind === "aggregate_metric"
      ? "aggregate_metric"
      : kind === "derived_metric"
        ? "derived_metric"
        : kind === "dimension"
          ? "dimension"
        : kind === "business_rule_strategy"
          ? "business_rule_strategy"
          : kind === "relationship" ||
              ((kind === undefined || kind === null) && ("left" in parsed || "right" in parsed))
            ? "relationship"
            : "raw";
  const expectedEntryType = {
    relationship: "relationship",
    aggregate_metric: "metric",
    derived_metric: "metric",
    dimension: "dimension",
    business_rule_strategy: "business_rule",
  } as const;
  const compatibilityError = {
    relationship: "errors.relationshipDefinitionType",
    aggregate_metric: "errors.metricDefinitionType",
    derived_metric: "errors.metricDefinitionType",
    dimension: "errors.dimensionDefinitionType",
    business_rule_strategy: "errors.businessRuleDefinitionType",
  } as const;
  if (
    definitionVariant !== "raw" &&
    draft.entryType !== expectedEntryType[definitionVariant]
  ) {
    throw new UserFacingError(t(compatibilityError[definitionVariant]));
  }
  return {
    ...parsed,
    business_name: draft.businessName.trim(),
    description: draft.value.trim(),
    ...definitionSynonyms(draft, existingDefinition),
  };
}

export function semanticTypeLabel(type: SemanticEntry["entry_type"], t: Translate): string {
  const keys: Record<SemanticEntry["entry_type"], string> = {
    scope_presentation: "entryType.scopePresentation",
    relationship: "entryType.relationship",
    metric: "entryType.metric",
    dimension: "entryType.dimension",
    business_rule: "entryType.businessRule",
    cleaning_rule: "entryType.cleaningRule",
    verified_query: "entryType.verifiedQuery",
  };
  return t(keys[type] || "entryType.fallback");
}

function governanceLabel(entry: SemanticEntry, t: Translate): string {
  if (entry.validity === "stale" || entry.is_active === false) return t("governance.ignored");
  if (entry.state === "locked") return t("governance.locked");
  if (entry.execution_state === "verified") {
    return entry.state === "candidate"
      ? t("governance.verifiedPendingRemember")
      : t("governance.rememberedAndVerified");
  }
  if (entry.entry_type === "scope_presentation" && entry.state === "candidate") {
    return t("governance.pendingManualReview");
  }
  if (entry.state === "confirmed") return t("governance.remembered");
  return entry.validity === "unverified"
    ? t("governance.pendingValidation")
    : t("governance.pendingReview");
}

function governanceTone(entry: SemanticEntry): string {
  if (entry.validity === "stale" || entry.is_active === false) return "text-muted-foreground";
  if (entry.execution_state === "verified") return "text-success";
  if (entry.state === "locked" || entry.state === "confirmed") return "text-primary";
  return "text-warning";
}

function entryTitle(entry: SemanticEntry, t: Translate, locale = "zh"): string {
  const presentation = semanticDisplayContent(entry, locale);
  if (looksLikeUntranslatedField(entry, locale)) {
    const field = technicalFieldNames(entry)[0];
    return field ? humanizeFieldIdentifier(field, locale) : t("list.namingPending");
  }
  if (presentation.businessName) return presentation.businessName;
  if (entry.entry_type === "relationship") return t("list.untitledRelationship");
  if (
    entry.value &&
    businessNameMatchesLocale(entry.value, locale) &&
    !containsImplementationDetail(entry.value)
  ) {
    return entry.value;
  }
  const field = technicalFieldNames(entry)[0];
  return field
    ? humanizeFieldIdentifier(field, locale)
    : t("list.untitledDefinition");
}

function entryDescription(entry: SemanticEntry, t: Translate, locale = "zh"): string | null {
  const presentation = userFacingDisplayContent(entry, locale);
  const title = entryTitle(entry, t, locale);
  if (looksLikeUntranslatedField(entry, locale)) {
    return presentation.description || untranslatedFieldPlaceholder(entry, t);
  }
  if (entry.entry_type === "relationship" && !presentation.description) return null;
  if (presentation.description) return presentation.description;
  if (
    entry.value &&
    entry.value !== title &&
    businessProseMatchesLocale(entry.value, locale) &&
    !containsTechnicalField(entry.value, entry) &&
    !containsImplementationDetail(entry.value)
  ) {
    return entry.value;
  }
  if (entry.entry_type === "metric") return t("details.metricPurposeFallback", { name: title });
  if (entry.entry_type === "dimension") {
    return t("details.dimensionPurposeFallback", { name: title });
  }
  return t("details.definitionPurposeFallback", { name: title });
}

function historyPresentation(entry: SemanticEntry, t: Translate, locale: string) {
  // History compares authored meaning: changing the UI language must not turn
  // both versions into the same generated placeholder. Keep technical filtering.
  const display = userFacingDisplayContent(entry, locale);
  const fallback = userFacingDisplayContent(entry, locale === "en" ? "zh" : "en");
  const safeValue = !containsTechnicalField(entry.value, entry) && !containsImplementationDetail(entry.value) ? entry.value : null;
  return {
    title: display.businessName || fallback.businessName || entryTitle(entry, t, locale),
    description: display.description || fallback.description || safeValue,
    type: semanticTypeLabel(entry.entry_type, t), state: governanceLabel(entry, t),
    formula: display.formulaSummary || fallback.formulaSummary,
    synonyms: Array.from(new Set([...display.synonyms, ...fallback.synonyms])),
  };
}

const VALIDATION_POLL_INTERVAL_MS = 800;
const VALIDATION_RECOVERY_INTERVAL_MS = 35_000;

function localizedValidationCode(code: string, t: Translate): string {
  if (
    code === "semantic_validation_queued" ||
    code === "semantic_validation_running" ||
    code === "semantic_validation_verified" ||
    code === "semantic_validation_cancelled"
  ) {
    return t(`validationCode.${code}`);
  }
  return t("validationCode.needsInformation");
}

function validationItemReason(
  item: SemanticValidationJobItem,
  t: Translate
): string | null {
  const code = nonEmptyString(item.code);
  if (code) return localizedValidationCode(code, t);
  return null;
}

function canQueueValidation(entry: SemanticEntry): boolean {
  return (
    entry.entry_type !== "scope_presentation" &&
    entry.allowed_actions.includes("queue_validation")
  );
}

function canRemember(entry: SemanticEntry): boolean {
  return entry.allowed_actions.includes("remember");
}

function canIgnore(entry: SemanticEntry): boolean {
  return entry.allowed_actions.includes("ignore");
}

function canRestore(entry: SemanticEntry): boolean {
  return entry.allowed_actions.includes("restore");
}

function canAttest(entry: SemanticEntry): boolean {
  return entry.allowed_actions.includes("attest");
}

function actionAllowed(action: SemanticBatchAction, entries: SemanticEntry[]): boolean {
  if (!entries.length) return false;
  if (action === "ignore") return entries.every(canIgnore);
  if (action === "queue_validation") return entries.every(canQueueValidation);
  if (action === "attest") return entries.every(canAttest);
  if (action === "remember") return entries.every(canRemember);
  return entries.every(canRestore);
}

function errorMessage(error: unknown, t: Translate): string {
  return businessErrorMessage(error, t("errors.loadFailed"));
}

function businessErrorMessage(error: unknown, fallback: string): string {
  return error instanceof UserFacingError && error.message.trim()
    ? error.message
    : fallback;
}

export function ProjectUnderstandingWorkspace({ projectId }: { projectId: string }) {
  return <ProjectUnderstandingSession key={projectId} projectId={projectId} />;
}

function ProjectUnderstandingSession({ projectId }: { projectId: string }) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("projectUnderstanding") as Translate;
  const [project, setProject] = useState<Project | null>(null);
  const [sources, setSources] = useState<ProjectDataSource[]>([]);
  const [page, setPage] = useState<SemanticKnowledgePage | null>(null);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [entryType, setEntryType] = useState<EntryTypeFilter>("all");
  const [state, setState] = useState<StateFilter>("all");
  const [validity, setValidity] = useState<ValidityFilter>("all");
  const [serverScopes, setServerScopes] = useState<SemanticScopeNode[]>([]);
  const [selectedScopeKey, setSelectedScopeKey] = useState<string | null>(null);
  const [expandedScopeKeys, setExpandedScopeKeys] = useState<Set<string>>(new Set());
  const [leftTable, setLeftTable] = useState("");
  const [rightTable, setRightTable] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [selection, setSelection] = useState<SemanticSelection>(() => new Map());
  const [selectionOpen, setSelectionOpen] = useState(false);
  const batchInFlight = useRef(false);
  const selectedIds = useMemo(() => new Set(selection.keys()), [selection]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [batchAction, setBatchAction] = useState<SemanticBatchAction | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [editorEntry, setEditorEntry] = useState<SemanticEntry | null | undefined>(undefined);
  const [editorDraft, setEditorDraft] = useState<SemanticEditorDraft>(() =>
    relationshipDraft(null, [])
  );
  const [editorError, setEditorError] = useState<string | null>(null);
  const [savingEditor, setSavingEditor] = useState(false);
  const [discardEditorOpen, setDiscardEditorOpen] = useState(false);
  const [editorRecovery, setEditorRecovery] = useState<{ target: SemanticSaveTarget; conflict: boolean } | null>(null);
  const editorCreateKey = useRef<string | null>(null);
  const editorBaseline = useRef<SemanticEditorDraft | null>(null);
  const editorSavingRef = useRef(false), sessionActiveRef = useRef(false);
  const editorDirty = editorEntry !== undefined && editorBaseline.current !== null
    && (Object.keys(editorDraft) as (keyof SemanticEditorDraft)[]).some(key => editorDraft[key] !== editorBaseline.current?.[key]);
  useEffect(() => { sessionActiveRef.current = true; return () => { sessionActiveRef.current = false; }; }, []);
  useEffect(() => {
    if (!editorDirty && !savingEditor) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [editorDirty, savingEditor]);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [governanceDialogOpen, setGovernanceDialogOpen] = useState(false);
  const [recommendationBatch, setRecommendationBatch] =
    useState<SemanticRecommendationResult | null>(null);
  const [recommendationBatchId, setRecommendationBatchId] = useState<string | null>(null);
  const [inventoryJobs, setInventoryJobs] = useState<Record<string, SemanticInventoryJob>>(
    {}
  );
  const [inventoryReviewJobId, setInventoryReviewJobId] = useState<string | null>(null);
  const [inventoryActionBySource, setInventoryActionBySource] = useState<
    Record<string, "retry" | "cancel" | undefined>
  >({});
  const [inventoryErrorBySource, setInventoryErrorBySource] = useState<
    Record<string, string | undefined>
  >({});
  const [inventoryRestoreVersion, setInventoryRestoreVersion] = useState(0);
  const [validationJobId, setValidationJobId] = useState<string | null>(null);
  const [validationJob, setValidationJob] = useState<SemanticValidationJob | null>(null);
  const [validationJobError, setValidationJobError] = useState<string | null>(null);
  const [validationPollVersion, setValidationPollVersion] = useState(0);
  const [historyEntry, setHistoryEntry] = useState<{ id: string; label: string } | null>(null);
  const [detailFocusRequest, setDetailFocusRequest] = useState(0);
  const detailSearchRef = useRef<HTMLInputElement>(null);
  const selectionWasOpen = useRef(false);
  useEffect(() => {
    if (selectionWasOpen.current && !selectionOpen && selection.size === 0) detailSearchRef.current?.focus();
    selectionWasOpen.current = selectionOpen;
  }, [selectionOpen, selection.size]);
  const detailTriggers = useRef(new Map<string, HTMLElement>());
  const governanceTriggerRef = useRef<HTMLButtonElement>(null);
  const editorNameRef = useRef<HTMLInputElement>(null);
  const catalogRefreshEpochRef = useRef(0);
  const inventoryLoadedSourcesRef = useRef<Set<string>>(new Set());
  const inventoryRestoreAttemptsRef = useRef<Record<string, number>>({});
  const inventoryJobsRef = useRef<Record<string, SemanticInventoryJob>>({});
  const inventoryReviewRequestEpochRef = useRef(0);

  const browserScopes = useMemo(
    () => buildBrowserScopes(serverScopes, sources, locale, t),
    [locale, serverScopes, sources, t]
  );
  const selectedScope = browserScopes.find((scope) => scope.key === selectedScopeKey);
  const selectedScopeBackendId = selectedScope?.backendId;
  const selectedScopeKind = selectedScope?.kind;
  const selectedScopeSourceId = selectedScope?.sourceId;
  const selectedScopeTableOrView = selectedScope?.tableOrView;
  const inventoryJobList = useMemo(
    () =>
      Object.values(inventoryJobs).sort((left, right) =>
        right.created_at.localeCompare(left.created_at)
      ),
    [inventoryJobs]
  );
  const inventoryRestoreFailures = useMemo(
    () =>
      Object.entries(inventoryErrorBySource).flatMap(([sourceId, message]) => {
        if (!message || inventoryJobs[sourceId]) return [];
        const source = sources.find((item) => item.id === sourceId);
        if (!source) return [];
        return [
          {
            sourceId,
            sourceName: projectSourceBusinessName(source),
            message,
          },
        ];
      }),
    [inventoryErrorBySource, inventoryJobs, sources]
  );
  const readyConnectionSourceKey = useMemo(
    () =>
      sources
        .filter(
          (source) =>
            source.project_id === projectId &&
            source.kind === "connection" &&
            source.status === "ready"
        )
        .map((source) => source.id)
        .sort()
        .join("|"),
    [projectId, sources]
  );
  const activeInventoryJobKey = inventoryJobList
    .filter(semanticInventoryJobIsActive)
    .map((job) => `${job.source_id}:${job.id}`)
    .sort()
    .join("|");
  const visibleBrowserScopes = useMemo(
    () =>
      browserScopes.filter((scope) => {
        if (!scope.parentKey) return true;
        let parent = browserScopes.find((candidate) => candidate.key === scope.parentKey);
        while (parent) {
          if (!expandedScopeKeys.has(parent.key)) return false;
          parent = parent.parentKey
            ? browserScopes.find((candidate) => candidate.key === parent?.parentKey)
            : undefined;
        }
        return true;
      }),
    [browserScopes, expandedScopeKeys]
  );

  useEffect(() => {
    inventoryJobsRef.current = inventoryJobs;
  }, [inventoryJobs]);

  useEffect(() => {
    if (!selectedScope) return;
    setExpandedScopeKeys((current) => {
      const next = new Set(current);
      let parent = selectedScope.parentKey
        ? browserScopes.find((scope) => scope.key === selectedScope.parentKey)
        : undefined;
      while (parent) {
        next.add(parent.key);
        parent = parent.parentKey
          ? browserScopes.find((scope) => scope.key === parent?.parentKey)
          : undefined;
      }
      return next.size === current.size && Array.from(next).every((key) => current.has(key))
        ? current
        : next;
    });
  }, [browserScopes, selectedScope]);

  const chooseScope = (scope: BrowserScopeNode) => {
    const reviewRequestEpoch = ++inventoryReviewRequestEpochRef.current;
    setSelectedScopeKey(scope.key);
    const reviewJob = inventoryReviewJobId
      ? Object.values(inventoryJobs).find((job) => job.id === inventoryReviewJobId)
      : null;
    const reviewItem =
      reviewJob &&
      scope.kind === "table" &&
      scope.sourceId === reviewJob.source_id &&
      scope.tableOrView
        ? semanticInventoryReviewItem(reviewJob, scope.tableOrView)
        : null;
    if (reviewItem?.recommendation_batch_id) {
      setRecommendationBatchId(reviewItem.recommendation_batch_id);
      setRecommendationBatch(null);
    } else if (
      reviewJob &&
      scope.kind === "table" &&
      scope.sourceId === reviewJob.source_id &&
      scope.tableOrView
    ) {
      setRecommendationBatchId(null);
      setRecommendationBatch(null);
      void api
        .get(
          `/api/v1/projects/${projectId}/sources/${reviewJob.source_id}/semantic-inventory-jobs/${reviewJob.id}/items`,
          {
            params: {
              table: scope.tableOrView,
              reviewable: true,
              limit: 1,
            },
          }
        )
        .then((response) => normalizeSemanticInventoryJobItemPage(response.data.data))
        .then((itemPage) => {
          if (inventoryReviewRequestEpochRef.current !== reviewRequestEpoch) return;
          const item = itemPage?.items[0];
          if (!item?.recommendation_batch_id) {
            setInventoryReviewJobId(null);
            setFeedback(t("inventoryJob.noReviewableResults"));
            return;
          }
          setRecommendationBatchId(item.recommendation_batch_id);
          setRecommendationBatch(null);
          setFeedback(t("inventoryJob.reviewingTable", { table: item.table }));
        })
        .catch((requestError: unknown) => {
          if (inventoryReviewRequestEpochRef.current !== reviewRequestEpoch) return;
          setError(
            businessErrorMessage(requestError, t("inventoryJob.pollFailed"))
          );
        });
    } else {
      setInventoryReviewJobId(null);
      setRecommendationBatchId(null);
      setRecommendationBatch(null);
    }
    setActiveId(null);
    setOffset(0);
    setFeedback(null);
  };

  const chooseTreeScope = (scope: BrowserScopeNode) => {
    if (scope.kind === "source" && scope.childCount > 0) {
      setExpandedScopeKeys((current) => {
        const next = new Set(current);
        if (selectedScope?.key === scope.key && next.has(scope.key)) next.delete(scope.key);
        else next.add(scope.key);
        return next;
      });
    }
    chooseScope(scope);
  };

  const refreshProjectState = async () => {
    // The semantic mutation has already committed at this point.  A secondary
    // dashboard refresh must not turn that successful write into a false error.
    await useProjectStore.getState().refreshCurrent().catch(() => undefined);
  };

  const handleCatalogRefreshed = useCallback(
    async (refreshedSource: ProjectDataSource) => {
      const refreshEpoch = ++catalogRefreshEpochRef.current;
      const mergeSource = (current: ProjectDataSource[]) =>
        current.map((source) =>
          source.id === refreshedSource.id ? refreshedSource : source
        );
      setSources(mergeSource);
      useProjectStore.setState((state) =>
        state.currentProjectId === projectId
          ? { sources: mergeSource(state.sources) }
          : {}
      );

      const [sourcesResult, scopesResult] = await Promise.allSettled([
        api.get(`/api/v1/projects/${projectId}/sources`),
        api.get(`/api/v1/projects/${projectId}/semantic-scopes`),
      ]);
      // Multiple ready connections refresh in parallel. Only the newest
      // committed refresh may publish its aggregate source/scope snapshot;
      // otherwise a slower, older response can hide a directory that just
      // finished loading for another connection.
      if (refreshEpoch !== catalogRefreshEpochRef.current) return;
      if (
        sourcesResult.status === "fulfilled" &&
        Array.isArray(sourcesResult.value.data.data)
      ) {
        const refreshedSources = sourcesResult.value.data.data as ProjectDataSource[];
        setSources(refreshedSources);
        useProjectStore.setState((state) =>
          state.currentProjectId === projectId ? { sources: refreshedSources } : {}
        );
      }
      if (scopesResult.status === "fulfilled") {
        setServerScopes(semanticScopeNodes(scopesResult.value.data.data));
      }
    },
    [projectId]
  );

  const closeGovernanceDialog = () => {
    setGovernanceDialogOpen(false);
    setTimeout(() => governanceTriggerRef.current?.focus(), 0);
  };

  useEffect(() => {
    localStorage.setItem(PROJECT_STORAGE_KEY, projectId);
    inventoryLoadedSourcesRef.current = new Set();
    inventoryRestoreAttemptsRef.current = {};
    inventoryJobsRef.current = {};
    setInventoryJobs({});
    setInventoryReviewJobId(null);
    setInventoryErrorBySource({});
    if (useProjectStore.getState().currentProjectId !== projectId) {
      useProjectStore.setState({ currentProjectId: projectId });
    }
  }, [projectId]);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      api.get(`/api/v1/projects/${projectId}`),
      api.get(`/api/v1/projects/${projectId}/sources`),
      api.get(`/api/v1/projects/${projectId}/semantic-scopes`),
    ]).then(([projectResult, sourceResult, scopeResult]) => {
      if (!active) return;
      setProject(
        projectResult.status === "fulfilled"
          ? (projectResult.value.data.data as Project)
          : null
      );
      setSources(
        sourceResult.status === "fulfilled" && Array.isArray(sourceResult.value.data.data)
          ? (sourceResult.value.data.data as ProjectDataSource[])
          : []
      );
      setServerScopes(
        scopeResult.status === "fulfilled"
          ? semanticScopeNodes(scopeResult.value.data.data)
          : []
      );
    });
    return () => {
      active = false;
    };
  }, [projectId]);

  useEffect(() => {
    const readyConnectionSourceIds = readyConnectionSourceKey
      .split("|")
      .filter(
        (sourceId) =>
          sourceId && !inventoryLoadedSourcesRef.current.has(sourceId)
      );
    if (!readyConnectionSourceIds.length) return;
    let active = true;
    const retryTimers: Array<ReturnType<typeof setTimeout>> = [];
    const pendingSourceIds = new Set(readyConnectionSourceIds);
    for (const sourceId of readyConnectionSourceIds) {
      inventoryLoadedSourcesRef.current.add(sourceId);
      void api
        .get(
          `/api/v1/projects/${projectId}/sources/${sourceId}/semantic-inventory-jobs/current`,
          { params: { include_items: false } }
        )
        .then((response) => {
          if (!active) return;
          const rawJob = response.data.data;
          if (rawJob == null) {
            delete inventoryRestoreAttemptsRef.current[sourceId];
            return;
          }
          const job = normalizeSemanticInventoryJob(rawJob);
          if (!job) throw new UserFacingError(t("inventoryJob.pollFailed"));
          delete inventoryRestoreAttemptsRef.current[sourceId];
          setInventoryJobs((current) => ({ ...current, [sourceId]: job }));
          setInventoryErrorBySource((current) => ({
            ...current,
            [sourceId]: undefined,
          }));
        })
        .catch((requestError) => {
          if (!active) return;
          if (requestStatus(requestError) === 404) {
            delete inventoryRestoreAttemptsRef.current[sourceId];
            return;
          }
          inventoryLoadedSourcesRef.current.delete(sourceId);
          const attempts = (inventoryRestoreAttemptsRef.current[sourceId] || 0) + 1;
          inventoryRestoreAttemptsRef.current[sourceId] = attempts;
          setInventoryErrorBySource((current) => ({
            ...current,
            [sourceId]: businessErrorMessage(
              requestError,
              t("inventoryJob.pollFailed")
            ),
          }));
          retryTimers.push(
            setTimeout(
              () => setInventoryRestoreVersion((current) => current + 1),
              Math.min(30_000, 1000 * 2 ** Math.min(attempts - 1, 5))
            )
          );
        })
        .finally(() => pendingSourceIds.delete(sourceId));
    }
    return () => {
      active = false;
      retryTimers.forEach(clearTimeout);
      pendingSourceIds.forEach((sourceId) =>
        inventoryLoadedSourcesRef.current.delete(sourceId)
      );
    };
  }, [inventoryRestoreVersion, projectId, readyConnectionSourceKey, t]);

  useEffect(() => {
    if (!activeInventoryJobKey) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const trackedJobs = activeInventoryJobKey.split("|").flatMap((entry) => {
      const separator = entry.indexOf(":");
      if (separator < 1) return [];
      return [
        {
          sourceId: entry.slice(0, separator),
          jobId: entry.slice(separator + 1),
        },
      ];
    });

    const poll = async () => {
      const results = await Promise.allSettled(
        trackedJobs.map(async ({ sourceId, jobId }) => {
          const response = await api.get(
            `/api/v1/projects/${projectId}/sources/${sourceId}/semantic-inventory-jobs/${jobId}`,
            { params: { include_items: false } }
          );
          const summary = normalizeSemanticInventoryJob(response.data.data);
          if (!summary) throw new UserFacingError(t("inventoryJob.pollFailed"));
          return summary;
        })
      );
      if (!active) return;

      let reachedTerminal = false;
      const successfulJobs = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : []
      );
      if (successfulJobs.length) {
        reachedTerminal = successfulJobs.some((job) => {
          const previous = inventoryJobsRef.current[job.source_id];
          return (
            Boolean(previous) &&
            semanticInventoryJobIsActive(previous) &&
            !semanticInventoryJobIsActive(job)
          );
        });
        setInventoryJobs((current) => {
          const next = { ...current };
          for (const job of successfulJobs) {
            next[job.source_id] = job;
          }
          return next;
        });
        setInventoryErrorBySource((current) => {
          const next = { ...current };
          for (const job of successfulJobs) next[job.source_id] = undefined;
          return next;
        });
      }
      results.forEach((result, index) => {
        if (result.status !== "rejected") return;
        const sourceId = trackedJobs[index]?.sourceId;
        if (!sourceId) return;
        setInventoryErrorBySource((current) => ({
          ...current,
          [sourceId]: businessErrorMessage(
            result.reason,
            t("inventoryJob.pollFailed")
          ),
        }));
      });

      if (reachedTerminal) {
        const [sourcesResult, scopesResult] = await Promise.allSettled([
          api.get(`/api/v1/projects/${projectId}/sources`),
          api.get(`/api/v1/projects/${projectId}/semantic-scopes`),
        ]);
        if (!active) return;
        if (
          sourcesResult.status === "fulfilled" &&
          Array.isArray(sourcesResult.value.data.data)
        ) {
          setSources(sourcesResult.value.data.data as ProjectDataSource[]);
        }
        if (scopesResult.status === "fulfilled") {
          setServerScopes(semanticScopeNodes(scopesResult.value.data.data));
        }
        setReloadVersion((current) => current + 1);
      }

      const stillActive = trackedJobs.some(({ sourceId }) => {
        const updated = successfulJobs.find((job) => job.source_id === sourceId);
        return updated
          ? semanticInventoryJobIsActive(updated)
          : semanticInventoryJobIsActive(inventoryJobsRef.current[sourceId]);
      });
      if (stillActive) timer = setTimeout(() => void poll(), 1000);
    };

    timer = setTimeout(() => void poll(), 500);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [activeInventoryJobKey, projectId, t]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const fallbackExactTable = !selectedScopeBackendId && selectedScopeKind === "table";
    const fallbackSourceDirect = !selectedScopeBackendId && selectedScopeKind === "source";
    const params: Record<string, string | number | boolean> = {
      offset: fallbackExactTable || fallbackSourceDirect ? 0 : offset,
      limit: fallbackExactTable || fallbackSourceDirect ? 100 : PAGE_SIZE,
      business_facing_only: true,
    };
    if (deferredSearch) params.search = deferredSearch;
    if (entryType !== "all") params.entry_type = entryType;
    if (state !== "all") params.state = state;
    if (validity !== "all") params.validity = validity;
    if (
      selectedScopeBackendId &&
      (!recommendationBatchId ||
        (inventoryReviewJobId && selectedScopeKind === "table"))
    ) {
      params.scope_id = selectedScopeBackendId;
    } else if (!recommendationBatchId && selectedScopeKind === "project") {
      params.source_scope = "project";
    } else if (!recommendationBatchId && selectedScopeSourceId) {
      params.source_id = selectedScopeSourceId;
    }
    if (leftTable.trim()) params.left_table = leftTable.trim();
    if (rightTable.trim()) params.right_table = rightTable.trim();
    if (recommendationBatchId) params.recommendation_batch_id = recommendationBatchId;

    void api
      .get(`/api/v1/projects/${projectId}/knowledge/page`, {
        params,
        signal: controller.signal,
      })
      .then((response) => response.data.data as SemanticKnowledgePage)
      .then((nextPage) => {
        if (controller.signal.aborted) return;
        const exactItems = fallbackExactTable
          ? nextPage.items.filter((entry) =>
              scopeTableNames(entry).some(
                (table) => table === selectedScopeTableOrView
              )
            )
          : fallbackSourceDirect
            ? nextPage.items.filter((entry) => scopeTableNames(entry).length === 0)
            : nextPage.items;
        const scopedPage =
          fallbackExactTable || fallbackSourceDirect
            ? {
                ...nextPage,
                items: exactItems.slice(offset, offset + PAGE_SIZE),
                total: exactItems.length,
                offset,
                limit: PAGE_SIZE,
                has_more: offset + PAGE_SIZE < exactItems.length,
                next_offset:
                  offset + PAGE_SIZE < exactItems.length ? offset + PAGE_SIZE : null,
              }
            : nextPage;
        if (scopedPage.items.some((entry) => entry.project_id !== projectId || !Array.isArray(entry.allowed_actions))) {
          throw new UserFacingError(t("errors.actionsUnavailable"));
        }
        if (scopedPage.total === 0 && scopedPage.offset > 0) {
          setOffset(0);
          return;
        }
        if (scopedPage.total > 0 && scopedPage.offset >= scopedPage.total) {
          setOffset(Math.floor((scopedPage.total - 1) / PAGE_SIZE) * PAGE_SIZE);
          return;
        }
        setPage(scopedPage);
        setSelection(current => reconcileSemanticSelection(current, scopedPage.items));
        setActiveId((current) =>
          current && scopedPage.items.some((entry) => entry.id === current)
            ? current
            : scopedPage.items[0]?.id || null
        );
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(requestError, t));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [
    deferredSearch,
    entryType,
    leftTable,
    offset,
    projectId,
    recommendationBatchId,
    inventoryReviewJobId,
    reloadVersion,
    rightTable,
    selectedScopeBackendId,
    selectedScopeKind,
    selectedScopeSourceId,
    selectedScopeTableOrView,
    state,
    t,
    validity,
  ]);

  useEffect(() => {
    setOffset(0);
  }, [deferredSearch, entryType, state, validity, selectedScopeKey, leftTable, rightTable]);

  useEffect(() => {
    if (!validationJobId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let nextRecoveryAt = Date.now() + VALIDATION_RECOVERY_INTERVAL_MS;

    const schedulePoll = () => {
      if (active) timer = setTimeout(() => void poll(), VALIDATION_POLL_INTERVAL_MS);
    };

    const finishJob = async (nextJob: SemanticValidationJob) => {
      setValidationJob(nextJob);
      setValidationJobError(null);
      if (nextJob.status === "queued" || nextJob.status === "running") {
        schedulePoll();
        return;
      }
      setSelection(current => removeSemanticSelection(current, nextJob.items.map(item => item.entry_id)));
      await useProjectStore.getState().refreshCurrent().catch(() => undefined);
      if (!active) return;
      setReloadVersion((current) => current + 1);
    };

    const recoverJob = async (jobId: string) => {
      nextRecoveryAt = Date.now() + VALIDATION_RECOVERY_INTERVAL_MS;
      try {
        const response = await api.post(
          `/api/v1/projects/${projectId}/knowledge/validation-jobs/${jobId}/retry`
        );
        if (!active) return;
        const recoveredJob = response.data.data as SemanticValidationJob;
        if (recoveredJob.id !== validationJobId) {
          setValidationJobId(recoveredJob.id);
        }
        await finishJob(recoveredJob);
      } catch (requestError) {
        if (!active) return;
        // A 409 means fresh work is still active. Recovery is deliberately
        // background-only, so a transient retry failure must not replace a
        // successfully read business status with transport or lease details.
        if (requestStatus(requestError) === 409) {
          setValidationJobError(null);
        }
        schedulePoll();
      }
    };

    const poll = async () => {
      try {
        const response = await api.get(
          `/api/v1/projects/${projectId}/knowledge/validation-jobs/${validationJobId}`
        );
        if (!active) return;
        const nextJob = response.data.data as SemanticValidationJob;
        setValidationJob(nextJob);
        setValidationJobError(null);
        if (nextJob.status === "queued" || nextJob.status === "running") {
          if (Date.now() >= nextRecoveryAt) {
            await recoverJob(nextJob.id);
          } else {
            schedulePoll();
          }
          return;
        }
        await finishJob(nextJob);
      } catch {
        if (!active) return;
        setValidationJobError(t("validationJob.pollFailed"));
      }
    };

    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [projectId, t, validationJobId, validationPollVersion]);

  const selectedEntries = useMemo(
    () => [...selection.values()].map(item => item.entry),
    [selection]
  );
  const displayEntries = useMemo(
    () =>
      recommendationBatchId
        ? sortRecommendationEntries(page?.items || [])
        : page?.items || [],
    [page, recommendationBatchId]
  );
  const activeEntry = displayEntries.find((entry) => entry.id === activeId) || null;
  const activeDisplay = activeEntry ? userFacingDisplayContent(activeEntry, locale) : null;
  const validationInProgress =
    validationJob?.status === "queued" || validationJob?.status === "running";
  const pendingValidationEntryIds = new Set(
    (validationJob?.items || [])
      .filter((item) => item.status === "queued" || item.status === "running")
      .map((item) => item.entry_id)
  );
  const selectableEntries = displayEntries.filter(
    (entry) =>
      !loading &&
      !pendingValidationEntryIds.has(entry.id) &&
      Boolean(entry.active_revision_id) &&
      (canQueueValidation(entry) ||
        canAttest(entry) ||
        canRemember(entry) ||
        canIgnore(entry) ||
        canRestore(entry))
  );
  const allPageSelected =
    selectableEntries.length > 0 && selectableEntries.every((entry) => selectedIds.has(entry.id));
  const somePageSelected =
    !allPageSelected && selectableEntries.some((entry) => selectedIds.has(entry.id));
  const pageSelectionExceedsLimit = !allPageSelected && selection.size
    + selectableEntries.filter(entry => !selection.has(entry.id)).length > SEMANTIC_SELECTION_LIMIT;
  const visibleSelectedIds = new Set(loading ? [] : displayEntries.filter(entry => selection.has(entry.id)).map(entry => entry.id));
  const selectedElsewhere = selection.size - visibleSelectedIds.size;
  const selectionNeedsReview = [...selection.values()].some(item => item.needsReview);
  const currentPage = page ? Math.floor(page.offset / page.limit) + 1 : 1;
  const pageCount = page ? Math.max(1, Math.ceil(page.total / page.limit)) : 1;
  const activeFilterCount =
    Number(state !== "all") +
    Number(validity !== "all") +
    Number(Boolean(leftTable.trim())) +
    Number(Boolean(rightTable.trim()));
  const blockedValidationItems = (validationJob?.items || []).filter(
    (item) => item.status === "blocked" || item.status === "failed"
  );
  const activeBlockedValidation = blockedValidationItems.find(
    (item) => item.entry_id === activeEntry?.id
  );
  const validationProcessed = validationJob
    ? validationJob.progress.verified +
      validationJob.progress.blocked +
      validationJob.progress.failed
    : 0;

  const entryValidationPending = (entryId: string) =>
    validationInProgress && pendingValidationEntryIds.has(entryId);
  const selectedHasPendingValidation = selectedEntries.some((entry) =>
    entryValidationPending(entry.id)
  );

  const toggleSelection = (entryId: string) => {
    if (loading || batchInFlight.current || entryValidationPending(entryId)) return;
    const entry = selectableEntries.find(item => item.id === entryId);
    if (entry) setSelection(current => toggleSemanticSelection(current, [entry]));
  };

  const openDetails = (entryId: string) => {
    setActiveId(entryId);
    setDetailFocusRequest(current => current + 1);
  };

  const returnToDetailsList = () => {
    const target = activeId ? detailTriggers.current.get(`table:${activeId}`) : null;
    (target?.isConnected ? target : detailSearchRef.current)?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ block: "nearest" });
  };

  const togglePageSelection = () => {
    if (loading || batchInFlight.current) return;
    setSelection(current => toggleSemanticSelection(current, selectableEntries));
  };

  const draftForEntry = (entry: SemanticEntry | null) => {
    const entrySourceIds = sourceIdsFromEntry(entry);
    const entryTables = entry ? scopeTableNames(entry) : [];
    const inferredScope = entry?.scope_id
      ? browserScopes.find((scope) => scope.backendId === entry.scope_id)
      : browserScopes.find(
          (scope) =>
            scope.kind === "table" &&
            Boolean(scope.sourceId && entrySourceIds.includes(scope.sourceId)) &&
            Boolean(scope.tableOrView && entryTables.includes(scope.tableOrView))
        ) ||
        browserScopes.find(
          (scope) =>
            scope.kind === "source" &&
            Boolean(scope.sourceId && entrySourceIds.includes(scope.sourceId))
        );
    return relationshipDraft(
        entry,
        sources,
        inferredScope?.key || (entry && !entry.scope_id ? "preserve" : selectedScope?.key || "")
      );
  };
  const openEditor = (entry: SemanticEntry | null) => {
    if (editorSavingRef.current || editorEntry !== undefined) return;
    const draft = draftForEntry(entry);
    editorCreateKey.current = null;
    setEditorRecovery(null);
    editorBaseline.current = draft;
    setEditorEntry(entry);
    setEditorDraft(draft);
    setDiscardEditorOpen(false);
    setEditorError(null);
    setFeedback(null);
  };

  const discardEditor = () => {
    if (editorSavingRef.current) return;
    editorBaseline.current = null;
    setEditorEntry(undefined);
    setEditorError(null);
    setDiscardEditorOpen(false);
    setEditorRecovery(null);
  };
  const closeEditor = () => {
    if (editorSavingRef.current || discardEditorOpen) return;
    if (editorDirty) setDiscardEditorOpen(true);
    else discardEditor();
  };

  const updateEditorDraft = <Key extends keyof SemanticEditorDraft>(
    key: Key,
    value: SemanticEditorDraft[Key]
  ) => {
    setEditorDraft((current) => ({ ...current, [key]: value }));
  };

  const saveEditor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (editorSavingRef.current || discardEditorOpen || editorRecovery || editorEntry === undefined) return;
    const businessName = editorDraft.businessName.trim();
    const editorScope = browserScopes.find((scope) => scope.key === editorDraft.scopeKey);
    const key = editorEntry?.key || editorCreateKey.current || internalSemanticKey(
      businessName,
      editorDraft.entryType,
      editorScope?.key || "project"
    );
    const value = editorDraft.value.trim();
    if (!businessName) {
      setEditorError(t("errors.nameRequired"));
      return;
    }
    if (!value) {
      setEditorError(t("errors.businessDefinitionRequired"));
      return;
    }
    if (editorEntry && !editorEntry.active_revision_id) {
      setEditorError(t("errors.revisionUnavailable"));
      return;
    }

    editorSavingRef.current = true;
    setSavingEditor(true);
    setEditorError(null);
    const target: SemanticSaveTarget = { projectId, key, entryId: editorEntry?.id, expectedHead: editorEntry?.active_revision_id, previousVersion: editorEntry?.revision_number,
      content: { value, entryType: editorDraft.entryType, state: editorDraft.state, businessName } };
    let sent = false;
    try {
      const definition = await editorDefinition(editorDraft, sources, editorEntry || null, t);
      if (!sessionActiveRef.current) return;
      const relationshipSourceIds = Array.from(
        new Set(
          [editorDraft.leftSourceId, editorDraft.rightSourceId].filter(
            (source): source is string => editorDraft.entryType === "relationship" && Boolean(source)
          )
        )
      );
      const priorEvidence = editorEntry?.evidence || [];
      const evidenceWithoutDeclaration = priorEvidence.filter(
        (item) => item.kind !== "user_declaration"
      );
      let evidence: Record<string, unknown>[];
      if (editorDraft.entryType === "relationship") {
        evidence = relationshipSourceIds.length
          ? [
              ...evidenceWithoutDeclaration,
              { kind: "user_declaration", source_ids: relationshipSourceIds },
            ]
          : priorEvidence.length
            ? priorEvidence
            : [{ kind: "user_declaration" }];
      } else if (editorEntry && editorDraft.scopeKey === "preserve") {
        evidence = priorEvidence.length ? priorEvidence : [{ kind: "user_declaration" }];
      } else {
        const selectedSourceId = editorScope?.sourceId || "";
        evidence = [
          ...evidenceWithoutDeclaration,
          selectedSourceId
            ? { kind: "user_declaration", source_ids: [selectedSourceId] }
            : { kind: "user_declaration" },
        ];
      }
      const basePayload = {
        key,
        value,
        entry_type: editorDraft.entryType,
        state: editorDraft.state,
        confidence:
          editorDraft.state === "candidate"
            ? editorEntry?.confidence ?? 0.5
            : 1,
        definition,
        validity:
          editorDraft.entryType === "relationship"
            ? editorEntry?.validity === "stale"
              ? "unverified"
              : editorEntry?.validity || "unverified"
            : "active",
        evidence,
        source: "user" as const,
        ...(editorEntry && editorDraft.scopeKey === "preserve"
          ? {}
          : editorScope?.backendId
            ? { scope_id: editorScope.backendId }
            : { scope_id: null }),
      };
      if (!editorEntry) editorCreateKey.current = key;
      sent = true;
      const response = editorEntry
        ? await api.put(`/api/v1/projects/${projectId}/knowledge/${editorEntry.id}`, {
            expected_active_revision_id: editorEntry.active_revision_id,
            ...basePayload,
          })
        : await api.post(`/api/v1/projects/${projectId}/knowledge`, {
            ...basePayload,
          });
      const saved = inspectSemanticSaveEntry(response.data.data, target, true);
      if (!sessionActiveRef.current) return;
      await refreshProjectState();
      if (!sessionActiveRef.current) return;
      editorBaseline.current = null;
      setEditorEntry(undefined);
      setEntryType(saved.entry_type);
      setState("all");
      setValidity("all");
      setSearch(businessName);
      setOffset(0);
      setActiveId(saved.id);
      setFeedback(editorEntry ? t("feedback.updated") : t("feedback.added"));
      setReloadVersion((current) => current + 1);
    } catch (requestError) {
      if (sessionActiveRef.current) {
        const status = requestStatus(requestError);
        if (sent && (status === null || status === 0 || status === 404 || status === 408 || status === 409 || status >= 500)) {
          setEditorRecovery({ target, conflict: status === 409 });
        }
        setEditorError(businessErrorMessage(requestError, t("editor.saveFailed")));
      }
    } finally {
      editorSavingRef.current = false;
      if (sessionActiveRef.current) setSavingEditor(false);
    }
  };

  const showAllDefinitions = () => {
    setInventoryReviewJobId(null);
    setRecommendationBatchId(null);
    setRecommendationBatch(null);
    setEntryType("all");
    setState("all");
    setValidity("all");
    setSelectedScopeKey(null);
    setLeftTable("");
    setRightTable("");
    setSearch("");
    setAdvancedOpen(false);
    setOffset(0);
    setFeedback(null);
  };

  const handleRecommendationsGenerated = (result: SemanticRecommendationResult) => {
    const sortedItems = sortRecommendationEntries(result.items);
    setInventoryReviewJobId(null);
    setRecommendationBatch({ ...result, items: sortedItems });
    setRecommendationBatchId(result.batch_id);
    setSelectedScopeKey(null);
    setEntryType("all");
    setState("candidate");
    setValidity("all");
    setLeftTable("");
    setRightTable("");
    setSearch("");
    setAdvancedOpen(false);
    setActiveId(sortedItems[0]?.id || null);
    setOffset(0);
    setFeedback(t("recommendationBatch.generated", { count: result.items.length }));
    setReloadVersion((current) => current + 1);
  };

  const handleInventoryStarted = (jobs: SemanticInventoryJob[]) => {
    if (!jobs.length) return;
    setInventoryJobs((current) => {
      const next = { ...current };
      for (const job of jobs) next[job.source_id] = job;
      return next;
    });
    setInventoryErrorBySource((current) => {
      const next = { ...current };
      for (const job of jobs) next[job.source_id] = undefined;
      return next;
    });
    setFeedback(t("inventoryJob.started", { count: jobs.length }));
  };

  const updateInventoryJob = (job: SemanticInventoryJob) => {
    setInventoryJobs((current) => ({ ...current, [job.source_id]: job }));
    setInventoryErrorBySource((current) => ({
      ...current,
      [job.source_id]: undefined,
    }));
  };

  const retryInventoryRestore = (sourceId: string) => {
    inventoryLoadedSourcesRef.current.delete(sourceId);
    delete inventoryRestoreAttemptsRef.current[sourceId];
    setInventoryErrorBySource((current) => ({
      ...current,
      [sourceId]: undefined,
    }));
    setInventoryRestoreVersion((current) => current + 1);
  };

  const refreshInventoryJob = async (job: SemanticInventoryJob) => {
    setInventoryErrorBySource((current) => ({
      ...current,
      [job.source_id]: undefined,
    }));
    try {
      const response = await api.get(
        `/api/v1/projects/${projectId}/sources/${job.source_id}/semantic-inventory-jobs/${job.id}`,
        { params: { include_items: false } }
      );
      const refreshed = normalizeSemanticInventoryJob(response.data.data);
      if (!refreshed) throw new UserFacingError(t("inventoryJob.pollFailed"));
      updateInventoryJob(refreshed);
    } catch (requestError) {
      setInventoryErrorBySource((current) => ({
        ...current,
        [job.source_id]: businessErrorMessage(
          requestError,
          t("inventoryJob.pollFailed")
        ),
      }));
    }
  };

  const runInventoryAction = async (
    job: SemanticInventoryJob,
    action: "retry" | "cancel"
  ) => {
    if (inventoryActionBySource[job.source_id]) return;
    setInventoryActionBySource((current) => ({
      ...current,
      [job.source_id]: action,
    }));
    setInventoryErrorBySource((current) => ({
      ...current,
      [job.source_id]: undefined,
    }));
    try {
      const response = await api.post(
        `/api/v1/projects/${projectId}/sources/${job.source_id}/semantic-inventory-jobs/${job.id}/${action}`
      );
      const updated = normalizeSemanticInventoryJob(response.data.data);
      if (!updated) throw new UserFacingError(t("inventoryJob.actionFailed"));
      updateInventoryJob(updated);
    } catch (requestError) {
      setInventoryErrorBySource((current) => ({
        ...current,
        [job.source_id]: businessErrorMessage(
          requestError,
          t("inventoryJob.actionFailed")
        ),
      }));
    } finally {
      setInventoryActionBySource((current) => ({
        ...current,
        [job.source_id]: undefined,
      }));
    }
  };

  const reviewInventoryJob = (job: SemanticInventoryJob) => {
    const item = semanticInventoryReviewItem(job);
    if (!item?.recommendation_batch_id) {
      setFeedback(t("inventoryJob.noReviewableResults"));
      return;
    }
    const tableScope = browserScopes.find(
      (scope) =>
        scope.kind === "table" &&
        scope.sourceId === job.source_id &&
        Boolean(scope.tableOrView) &&
        semanticInventoryReviewItem(job, scope.tableOrView)?.id === item.id
    );
    setInventoryReviewJobId(job.id);
    setRecommendationBatchId(item.recommendation_batch_id);
    setRecommendationBatch(null);
    setSelectedScopeKey(tableScope?.key || null);
    setEntryType("all");
    setState("candidate");
    setValidity("all");
    setLeftTable("");
    setRightTable("");
    setSearch("");
    setAdvancedOpen(false);
    setActiveId(null);
    setOffset(0);
    setFeedback(t("inventoryJob.reviewingTable", { table: item.table }));
  };

  const runBatch = async (
    action: SemanticBatchAction,
    entries: SemanticEntry[] = selectedEntries
  ) => {
    if (
      batchInFlight.current ||
      loading ||
      entries.length > SEMANTIC_SELECTION_LIMIT ||
      entries.some(entry => entry.project_id !== projectId || !entry.active_revision_id) ||
      (entries === selectedEntries && selectionNeedsReview) ||
      !actionAllowed(action, entries) ||
      entries.some((entry) => entryValidationPending(entry.id)) ||
      (action === "queue_validation" && validationInProgress)
    ) {
      return;
    }
    batchInFlight.current = true;
    setBatchAction(action);
    setError(null);
    setFeedback(null);
    try {
      const response = await api.post(
        `/api/v1/projects/${projectId}/knowledge/batch`,
        {
          action,
          items: entries.map((entry) => ({
            entry_id: entry.id,
            expected_active_revision_id: entry.active_revision_id,
          })),
        }
      );
      if (!sessionActiveRef.current) return;
      const result = inspectSemanticBatchResult(response.data.data, projectId, action, entries);
      setSelection(current => removeSemanticSelection(current, entries.map(entry => entry.id)));
      setSelectionOpen(false);
      await refreshProjectState();
      if (!sessionActiveRef.current) return;
      if (action === "queue_validation" && result.validation_job_id) {
        const queuedIds = result.queued_entry_ids.length
          ? result.queued_entry_ids
          : entries.map((entry) => entry.id);
        const now = new Date().toISOString();
        setValidationJob({
          id: result.validation_job_id,
          project_id: projectId,
          status: result.validation_status || "queued",
          progress: {
            total: queuedIds.length,
            queued: queuedIds.length,
            running: 0,
            verified: 0,
            blocked: 0,
            failed: 0,
          },
          items: queuedIds.map((entryId) => ({
            id: `queued:${entryId}`,
            entry_id: entryId,
            semantic_revision_id:
              entries.find((entry) => entry.id === entryId)?.active_revision_id || "",
            definition_hash: "",
            status: "queued",
          })),
          created_at: now,
        });
        setValidationJobError(null);
        setValidationJobId(result.validation_job_id);
        setReloadVersion((current) => current + 1);
        return;
      }
      setFeedback(
        action === "ignore"
          ? t("feedback.ignored", { count: result.items.length })
          : action === "restore"
            ? t("feedback.restored", { count: result.items.length })
            : action === "remember"
              ? t("feedback.remembered", { count: result.items.length })
              : action === "attest"
                ? result.items.every((entry) => entry.state === "candidate")
                  ? t("feedback.attestedCandidate", { count: result.items.length })
                  : t("feedback.attestedAdopted", { count: result.items.length })
                : t("feedback.validated", { count: result.items.length })
      );
      setReloadVersion((current) => current + 1);
    } catch (requestError) {
      if (!sessionActiveRef.current) return;
      const status = requestStatus(requestError);
      const uncertain = !status || status === 404 || status === 408 || status === 409 || status >= 500;
      if (uncertain) setSelection(current => {
        const next = new Map(current);
        for (const entry of entries) {
          const selected = next.get(entry.id);
          if (selected) next.set(entry.id, { ...selected, needsReview: true });
        }
        return next;
      });
      setError(uncertain ? t("selection.unconfirmed") : errorMessage(requestError, t));
    } finally {
      batchInFlight.current = false;
      if (sessionActiveRef.current) setBatchAction(null);
    }
  };

  const editorLeftSource = sources.find((source) => source.id === editorDraft.leftSourceId);
  const editorRightSource = sources.find((source) => source.id === editorDraft.rightSourceId);
  const editorBindingSource = sources.find(
    (source) => source.id === editorDraft.bindingSourceId
  );
  const editorBindingTables = sourceTables(editorBindingSource);
  const editorBindingColumns =
    editorBindingTables.find((table) => table.name === editorDraft.bindingTable)?.columns || [];
  const editorLeftTables = sourceTables(editorLeftSource);
  const editorRightTables = sourceTables(editorRightSource);
  const editorLeftColumns =
    editorLeftTables.find((table) => table.name === editorDraft.leftTable)?.columns || [];
  const editorRightColumns =
    editorRightTables.find((table) => table.name === editorDraft.rightTable)?.columns || [];
  const editorDefinitionRecord = isRecord(editorEntry?.definition)
    ? editorEntry.definition
    : null;
  const editorIsDerivedMetric =
    editorDraft.entryType === "metric" && editorDefinitionRecord?.kind === "derived_metric";
  const editorDerivedFormula = editorEntry
    ? semanticDisplayContent(editorEntry, locale).formulaSummary
    : null;

  return (
    <div className="flex h-dvh min-h-0 min-w-[var(--desktop-min-width)] flex-col items-center overflow-hidden bg-background p-2 text-foreground">
      <header className="flex h-[var(--shell-header-height)] w-full shrink-0 items-center justify-between gap-3 rounded-t-xl border border-border bg-card px-6">
        <div className="flex min-w-0 items-center gap-4">
          <Button variant="ghost"
            
            onClick={() => router.push("/")}
            
          >
            <ArrowLeft size={16} />
            {t("navigation.backToProject")}
          </Button>
          <span className="h-5 w-px bg-border" />
          <div className="min-w-0 truncate text-sm font-semibold">
            {project?.name || t("navigation.currentProject")}
          </div>
        </div>
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          <Button variant="primary"
            ref={governanceTriggerRef}
            
            onClick={() => setGovernanceDialogOpen(true)}
            
          >
            <Sparkles size={15} />
            {t("header.governance")}
          </Button>
        </div>
      </header>

      <main className="flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-b-xl border-x border-b border-border bg-card">
        <section className="shrink-0 border-b border-border px-6 py-4">
          <div className="flex flex-col gap-4">
            <div className="shrink-0">
              <h1 className="text-xl font-semibold tracking-tight">
                {t("header.title")}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">{t("header.description")}</p>
            </div>
            <div className="grid min-w-0 flex-1 grid-cols-[minmax(220px,1fr)_auto_auto_auto] gap-2">
              <SearchField value={search} onChange={setSearch} inputRef={detailSearchRef}
                label={t("search.label")} clearLabel={t("search.clear")} />
              <select
                aria-label={t("filters.contentType")}
                value={entryType}
                onChange={(event) => setEntryType(event.target.value as EntryTypeFilter)}
                className="h-9 min-w-0 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary"
              >
                {TYPE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option === "all"
                      ? t("entryType.all")
                      : semanticTypeLabel(option, t)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setAdvancedOpen((current) => !current)}
                aria-expanded={advancedOpen}
                aria-controls="semantic-advanced-filters"
                className={cn(
                  "inline-flex h-9 rounded-md items-center justify-center gap-2 border px-3 text-sm transition-colors",
                  advancedOpen || activeFilterCount
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                <Filter size={15} />
                {activeFilterCount
                  ? t("filters.toggleWithCount", { count: activeFilterCount })
                  : t("filters.toggle")}
              </button>
              <button
                type="button"
                onClick={() => openEditor(null)}
                className="inline-flex h-9 rounded-md shrink-0 items-center justify-center gap-2 bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Plus size={15} />
                {t("actions.addDefinition")}
              </button>
            </div>
          </div>

          {advancedOpen && (
            <div
              id="semantic-advanced-filters"
              className="mt-4 grid gap-3 border-t border-border pt-4 grid-cols-4"
            >
              <select
                aria-label={t("filters.governanceState")}
                value={state}
                onChange={(event) => setState(event.target.value as StateFilter)}
                className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary"
              >
                {STATE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {t(`stateFilter.${option}`)}
                  </option>
                ))}
              </select>
              <select
                aria-label={t("filters.validity")}
                value={validity}
                onChange={(event) => setValidity(event.target.value as ValidityFilter)}
                className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary"
              >
                {VALIDITY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {t(`validity.${option}`)}
                  </option>
                ))}
              </select>
              <input
                value={leftTable}
                onChange={(event) => setLeftTable(event.target.value)}
                placeholder={t("filters.leftTable")}
                aria-label={t("filters.leftTable")}
                className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary"
              />
              <input
                value={rightTable}
                onChange={(event) => setRightTable(event.target.value)}
                placeholder={t("filters.rightTable")}
                aria-label={t("filters.rightTable")}
                className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary"
              />
            </div>
          )}
        </section>

        <div
          data-testid="semantic-browser-layout"
          className="relative grid min-h-0 flex-1 overflow-hidden grid-cols-[200px_minmax(0,1fr)_320px]"
        >
          <nav
            aria-label={t("scopeTree.aria")}
            data-testid="semantic-scope-tree"
            className="flex min-h-0 flex-col overflow-hidden border-r border-border bg-card/45"
          >
            <div className="shrink-0 border-b border-border px-4 py-4">
              <div className="flex items-center gap-2 text-xs font-semibold">
                <FolderTree size={15} className="text-primary" />
                {t("scopeTree.title")}
              </div>
              <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
                {t("scopeTree.description")}
              </p>
            </div>
            <div role="tree" className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-2">
              {visibleBrowserScopes.map((scope) => {
                const current = selectedScope?.key === scope.key;
                const expandable = scope.kind === "source" && scope.childCount > 0;
                const expanded = expandable && expandedScopeKeys.has(scope.key);
                const count =
                  scope.directEntryCount ??
                  (current && !recommendationBatchId ? page?.total : undefined);
                const ScopeIcon =
                  scope.kind === "project"
                    ? BookOpenText
                    : scope.kind === "source"
                      ? scope.sourceId && sources.find((item) => item.id === scope.sourceId)?.kind === "file"
                        ? FileSpreadsheet
                        : Database
                      : scope.kind === "table"
                        ? FileSpreadsheet
                        : FolderTree;
                return (
                  <button
                    key={scope.key}
                    type="button"
                    role="treeitem"
                    aria-current={current ? "page" : undefined}
                    aria-selected={current}
                    aria-level={scope.depth + 1}
                    aria-expanded={expandable ? expanded : undefined}
                    onClick={() => chooseTreeScope(scope)}
                    className={cn(
                      "group block w-full border-l-2 py-2 pr-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40",
                      current
                        ? "border-primary bg-primary/[0.055]"
                        : "border-transparent hover:bg-muted/55"
                    )}
                    style={{ paddingLeft: `${12 + scope.depth * 14}px` }}
                  >
                    <span className="flex items-start gap-2">
                      {expandable ? (
                        expanded ? (
                          <ChevronDown
                            size={12}
                            aria-hidden="true"
                            className="mt-0.5 shrink-0 text-muted-foreground"
                          />
                        ) : (
                          <ChevronRight
                            size={12}
                            aria-hidden="true"
                            className="mt-0.5 shrink-0 text-muted-foreground"
                          />
                        )
                      ) : (
                        <span className="w-3 shrink-0" aria-hidden="true" />
                      )}
                      <ScopeIcon
                        size={14}
                        className={cn(
                          "mt-0.5 shrink-0",
                          current ? "text-primary" : "text-muted-foreground"
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-medium">
                            {scope.businessName}
                          </span>
                          {count !== undefined && (
                            <span
                              aria-label={t("scopeTree.directCountAria", { count })}
                              className="shrink-0 tabular-nums text-[10px] text-muted-foreground"
                            >
                              {count}
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-[10px] leading-4 text-muted-foreground">
                          {scope.description}
                        </span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </nav>

          <section
            aria-label={t("list.aria")}
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          >
            <div className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-5">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-semibold">
                    {recommendationBatchId
                      ? t("recommendationBatch.title")
                      : selectedScope?.businessName || t("header.allDefinitions")}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {loading && !page
                      ? t("list.loading")
                      : t("list.total", { count: page?.total || 0 })}
                  </span>
                </div>
                {!recommendationBatchId && selectedScope?.description && (
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {selectedScope.description}
                  </p>
                )}
                {selectedIds.size ? (
                  <span className="sr-only">
                    {t("list.selectedSuffix", { count: selectedIds.size })}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                aria-label={t("list.refresh")}
                onClick={() => setReloadVersion((current) => current + 1)}
                className="p-2 text-muted-foreground transition-colors hover:text-foreground"
              >
                <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
              </button>
            </div>

            {inventoryRestoreFailures.length ? (
              <div className="mx-5 mt-4 grid shrink-0 gap-2 grid-cols-2">
                {inventoryRestoreFailures.map((failure) => (
                  <div
                    key={failure.sourceId}
                    role="status"
                    aria-label={t("inventoryJob.aria", { source: failure.sourceName })}
                    className="flex items-center justify-between gap-3 border border-border bg-secondary/35 px-4 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <CircleAlert
                        size={15}
                        aria-hidden="true"
                        className="shrink-0 text-warning"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{failure.sourceName}</p>
                        <p className="text-xs text-muted-foreground">
                          {t("inventoryJob.pollFailed")}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => retryInventoryRestore(failure.sourceId)}
                      className="shrink-0 text-sm font-medium text-primary hover:underline"
                    >
                      {t("inventoryJob.retryStatus")}
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            {inventoryJobList.length ? (
              <div className="mx-5 mt-4 grid max-h-48 shrink-0 gap-2 overflow-y-auto grid-cols-2">
                {inventoryJobList.map((job) => {
                  const source = sources.find((item) => item.id === job.source_id);
                  return (
                    <SemanticInventoryProgress
                      key={job.id}
                      job={job}
                      sourceName={
                        source ? projectSourceBusinessName(source) : t("scope.localDatabase")
                      }
                      busyAction={inventoryActionBySource[job.source_id] || null}
                      error={inventoryErrorBySource[job.source_id] || null}
                      onRetry={() => void runInventoryAction(job, "retry")}
                      onRefresh={() => void refreshInventoryJob(job)}
                      onCancel={() => void runInventoryAction(job, "cancel")}
                      onReview={() => reviewInventoryJob(job)}
                    />
                  );
                })}
              </div>
            ) : null}

            {recommendationBatchId && (
              <div
                data-testid="recommendation-batch-filter"
                className="mx-5 mt-4 flex shrink-0 gap-3 rounded-xl border border-primary/25 bg-primary/[0.035] px-4 py-3 items-center justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-sm font-semibold">
                      {t("recommendationBatch.title")}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {recommendationBatch?.generated_by === "preflight"
                        ? t("recommendationBatch.generatedByPreflight")
                        : t("recommendationBatch.generatedByAi")}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("recommendationBatch.summary", {
                      count: recommendationBatch?.items.length ?? page?.total ?? 0,
                    })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={showAllDefinitions}
                  className="shrink-0 text-left text-sm font-medium text-primary hover:underline"
                >
                  {t("recommendationBatch.showAll")}
                </button>
              </div>
            )}

            {(validationJob || validationJobError) && (
              <div
                role="status"
                aria-label={t("validationJob.aria")}
                className="mx-5 mt-4 shrink-0 border border-border bg-secondary/35 px-4 py-3"
              >
                {validationJob && (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {(validationJob.status === "queued" ||
                          validationJob.status === "running") && (
                          <Loader2 size={15} className="animate-spin text-primary" />
                        )}
                        {validationJob.status === "queued"
                          ? t("validationJob.queued")
                          : validationJob.status === "running"
                            ? t("validationJob.running")
                            : validationJob.status === "failed"
                              ? t("validationJob.failed")
                              : blockedValidationItems.length
                                ? t("validationJob.completedWithBlocks", {
                                    count: blockedValidationItems.length,
                                  })
                                : t("validationJob.completed")}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {t("validationJob.progress", {
                          done: validationProcessed,
                          total: validationJob.progress.total,
                        })}
                      </span>
                    </div>
                    {validationJob.progress.total > 0 && (
                      <div className="mt-3 h-1 bg-border" aria-hidden="true">
                        <div
                          className="h-full bg-primary transition-[width]"
                          style={{
                            width: `${Math.min(
                              100,
                              (validationProcessed / validationJob.progress.total) * 100
                            )}%`,
                          }}
                        />
                      </div>
                    )}
                    {activeBlockedValidation && (
                      <div className="mt-3 border-l-2 border-warning pl-3 text-xs leading-5">
                        <p className="font-medium text-foreground">
                          {t("validationJob.blockedReason", {
                            reason:
                              validationItemReason(activeBlockedValidation, t) ||
                              t("validationJob.unknownReason"),
                          })}
                        </p>
                        <p className="mt-1 text-muted-foreground">
                          {t("validationJob.blockedHint")}
                        </p>
                      </div>
                    )}
                  </>
                )}
                {validationJobError && (
                  <div className="mt-2 flex items-center justify-between gap-3 text-xs text-destructive">
                    <span>{validationJobError}</span>
                    <button
                      type="button"
                      onClick={() => setValidationPollVersion((current) => current + 1)}
                      className="shrink-0 font-medium hover:underline"
                    >
                      {t("validationJob.retry")}
                    </button>
                  </div>
                )}
              </div>
            )}

            {error && (
              <div role="alert" className="mx-5 mt-4 flex shrink-0 items-center gap-2 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive">
                <CircleAlert size={15} />
                <span className="flex-1">{error}</span>
                <button type="button" onClick={() => setReloadVersion((current) => current + 1)} className="font-medium">
                  {t("actions.retry")}
                </button>
              </div>
            )}
            {feedback && (
              <div role="status" className="mx-5 mt-4 flex shrink-0 items-center gap-2 bg-success/[0.06] px-3 py-2 text-sm text-success">
                <Check size={15} />
                {feedback}
              </div>
            )}

            <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-5 py-2">
              <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 text-xs text-muted-foreground has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-40">
                <input type="checkbox" aria-label={t("list.selectPage")} checked={allPageSelected}
                  aria-checked={somePageSelected ? "mixed" : allPageSelected}
                  ref={element => { if (element) element.indeterminate = somePageSelected; }}
                  disabled={loading || !!batchAction || !selectableEntries.length || pageSelectionExceedsLimit}
                  onChange={togglePageSelection} className="accent-primary" />
                {t("list.selectPage")}
              </label>
              {selection.size > 0 && <span role="status" className="text-[11px] tabular-nums text-muted-foreground">{t("selection.capacity", { count: selection.size, limit: SEMANTIC_SELECTION_LIMIT })}</span>}
              {pageSelectionExceedsLimit && <span className="text-[11px] text-muted-foreground">{t("selection.pageLimit")}</span>}
            </div>

            <div
              data-testid="semantic-table-list"
              className="min-h-0 flex-1 overflow-auto overscroll-contain"
            >
              <table className="w-full min-w-[680px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-border text-[11px] font-medium text-muted-foreground">
                    <th className="w-12 px-4 py-3"><span className="sr-only">{t("selection.items")}</span></th>
                    <th className="px-3 py-3">{t("list.columnBusinessMeaning")}</th>
                    <th className="w-56 px-3 py-3">{t("list.columnScope")}</th>
                    <th className="w-32 px-3 py-3">{t("list.columnState")}</th>
                    <th className="w-12 px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {loading && !page ? (
                    <tr>
                      <td colSpan={5} className="h-56 text-center text-sm text-muted-foreground">
                        <Loader2 size={18} className="mx-auto mb-2 animate-spin" />
                        {t("list.loading")}
                      </td>
                    </tr>
                  ) : page?.items.length ? (
                    displayEntries.map((entry) => {
                      const selected = selectedIds.has(entry.id);
                      const active = activeId === entry.id;
                      const display = userFacingDisplayContent(entry, locale);
                      const breadcrumb = scopeBreadcrumb(entry, selectedScope, browserScopes, t);
                      return (
                        <tr
                          key={entry.id}
                          ref={node => { if (node) detailTriggers.current.set(`table:${entry.id}`, node); else detailTriggers.current.delete(`table:${entry.id}`); }}
                          aria-selected={active}
                          tabIndex={0}
                          onClick={() => openDetails(entry.id)}
                          onKeyDown={(event) => {
                            if (event.currentTarget !== event.target) return;
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              openDetails(entry.id);
                            }
                          }}
                          className={cn(
                            "cursor-pointer border-b border-border/80 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40",
                            active && "bg-primary/[0.045]"
                          )}
                        >
                          <td className="px-4 py-3 text-center" onClick={(event) => event.stopPropagation()}>
                            <input
                              type="checkbox"
                              aria-label={t("list.selectEntry", {
                                title: entryTitle(entry, t, locale),
                              })}
                              checked={selected}
                              disabled={
                                !!batchAction || (!selected && selection.size >= SEMANTIC_SELECTION_LIMIT) ||
                                entryValidationPending(entry.id) ||
                                !selectableEntries.some((item) => item.id === entry.id)
                              }
                              onChange={() => toggleSelection(entry.id)}
                              className="accent-primary disabled:opacity-40"
                            />
                          </td>
                          <td className="max-w-0 px-3 py-3">
                            <div className="block w-full min-w-0 text-left">
                              <span className="flex min-w-0 items-center gap-2">
                                {recommendationBatchId ? (
                                  <span className="shrink-0 border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                    {recommendationGroupLabel(entry, t)}
                                  </span>
                                ) : null}
                                <span className="block min-w-0 truncate text-sm font-medium text-foreground">
                                  {entryTitle(entry, t, locale)}
                                </span>
                              </span>
                              {recommendationBatchId && looksLikeUntranslatedField(entry, locale) ? (
                                <span className="mt-1 block truncate text-xs text-warning">
                                  {t("recommendationBatch.namingIncomplete")}
                                </span>
                              ) : null}
                              {(display.exampleQuestions[0] ||
                                (looksLikeUntranslatedField(entry, locale)
                                  ? display.description || untranslatedFieldPlaceholder(entry, t)
                                  : null)) && (
                                <span className="mt-1 block truncate text-xs text-muted-foreground">
                                  {display.exampleQuestions[0]
                                    ? `“${display.exampleQuestions[0]}”`
                                    : display.description || untranslatedFieldPlaceholder(entry, t)}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-3 text-xs leading-5 text-muted-foreground">
                            {breadcrumb}
                          </td>
                          <td className={cn("px-3 py-3 text-xs font-medium", governanceTone(entry))}>
                            {governanceLabel(entry, t)}
                          </td>
                          <td className="px-3 py-3 text-muted-foreground">
                            <button
                              type="button"
                              aria-label={t("list.viewEntry", {
                                title: entryTitle(entry, t, locale),
                              })}
                              onClick={() => openDetails(entry.id)}
                              className="-m-2 inline-flex p-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                            >
                              <ChevronRight size={15} />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={5} className="h-56 text-center">
                        <BookOpenText size={20} className="mx-auto mb-3 text-muted-foreground" />
                        <div className="text-sm font-medium">{t("list.emptyTitle")}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {selectedScope?.kind === "source" && selectedScope.childCount > 0
                            ? t("scopeTree.chooseTablePrompt")
                            : t("list.emptyDescription")}
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div
              className={cn(
                "flex min-h-16 shrink-0 items-center justify-between border-t border-border px-5",
                selectedEntries.length > 0 && "mb-16"
              )}
            >
              <div className="text-xs text-muted-foreground">
                {t("pagination.position", { current: currentPage, total: pageCount })}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={t("pagination.previous")}
                  disabled={!page || page.offset === 0 || loading}
                  onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}
                  className="p-2 text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  type="button"
                  aria-label={t("pagination.next")}
                  disabled={!page?.has_more || loading}
                  onClick={() => setOffset(page?.next_offset ?? offset + PAGE_SIZE)}
                  className="p-2 text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </section>

          <SemanticDetailPanel covered={editorEntry !== undefined || governanceDialogOpen || historyEntry !== null || selectionOpen} focusRequest={detailFocusRequest}
            title={activeEntry ? entryTitle(activeEntry, t, locale) : t("details.selectPrompt")}
            index={displayEntries.findIndex(entry => entry.id === activeId)} count={displayEntries.length}
            busy={loading || Boolean(batchAction)} onReturnFocus={returnToDetailsList}
            onNavigate={direction => {
              const index = displayEntries.findIndex(entry => entry.id === activeId);
              const next = index >= 0 ? displayEntries[index + direction] : null;
              if (next && !loading && !batchAction) openDetails(next.id);
            }}>
            {activeEntry ? (
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {scopeBreadcrumb(activeEntry, selectedScope, browserScopes, t)}
                    </p>
                  </div>
                  <span className={cn("shrink-0 text-xs font-medium", governanceTone(activeEntry))}>
                    {governanceLabel(activeEntry, t)}
                  </span>
                </div>

                {error && <p role="alert" className="mt-4 bg-destructive/[0.06] px-3 py-2 text-xs leading-5 text-destructive">{error}</p>}
                {feedback && <p role="status" className="mt-4 bg-success/[0.06] px-3 py-2 text-xs leading-5 text-success">{feedback}</p>}

                <div className="mt-6 space-y-5 border-y border-border py-5">
                  <div>
                    <div className="text-[10px] font-medium text-muted-foreground">
                      {t("details.purpose")}
                    </div>
                    <p className="mt-1 text-sm leading-6">
                      {entryDescription(activeEntry, t, locale) ||
                        t("details.descriptionUnavailable")}
                    </p>
                  </div>
                  {activeDisplay?.formulaSummary ? (
                    <div>
                      <div className="text-[10px] font-medium text-muted-foreground">
                        {t("details.formula")}
                      </div>
                      <div className="mt-2 text-base font-medium leading-6">
                        {activeDisplay.formulaSummary}
                      </div>
                    </div>
                  ) : null}
                  {activeDisplay?.exampleQuestions[0] ? (
                    <div>
                      <div className="text-[10px] font-medium text-muted-foreground">
                        {t("details.example")}
                      </div>
                      <p className="mt-2 border-l border-border pl-3 text-sm leading-6">
                        {activeDisplay.exampleQuestions[0]}
                      </p>
                    </div>
                  ) : null}
                  {activeDisplay?.synonyms.length ? (
                    <div>
                      <div className="text-[10px] font-medium text-muted-foreground">
                        {t("details.synonyms")}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {activeDisplay.synonyms.map((synonym) => (
                          <span
                            key={synonym}
                            className="border border-border bg-muted/45 px-2 py-1 text-xs text-foreground/80"
                          >
                            {synonym}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="mt-6 space-y-2">
                  <Button variant="outline"  disabled={loading || Boolean(batchAction) || !activeEntry.active_revision_id}
                    onClick={() => setHistoryEntry({ id: activeEntry.id, label: entryTitle(activeEntry, t, locale) })}
                    className="w-full">
                    <History size={14} />{t("actions.history")}
                  </Button>
                  {(canQueueValidation(activeEntry) || entryValidationPending(activeEntry.id)) && (
                    <Button variant="primary"
                      
                      disabled={
                        loading ||
                        Boolean(batchAction) ||
                        validationInProgress ||
                        entryValidationPending(activeEntry.id)
                      }
                      onClick={() => void runBatch("queue_validation", [activeEntry])}
                      className="w-full"
                    >
                      <ShieldCheck size={15} />
                      {t("actions.systemValidate")}
                    </Button>
                  )}
                  {canRemember(activeEntry) && (
                    <Button variant="primary"
                      
                      disabled={
                        loading ||
                        Boolean(batchAction) ||
                        entryValidationPending(activeEntry.id)
                      }
                      onClick={() => void runBatch("remember", [activeEntry])}
                      className="w-full"
                    >
                      <Check size={15} />
                      {t("actions.adopt")}
                    </Button>
                  )}
                  {canIgnore(activeEntry) && (
                    <Button variant="ghost"
                      
                      disabled={
                        loading ||
                        Boolean(batchAction) ||
                        entryValidationPending(activeEntry.id)
                      }
                      onClick={() => void runBatch("ignore", [activeEntry])}
                      className="w-full"
                    >
                      {t("actions.ignore")}
                    </Button>
                  )}
                  <Button variant="outline"
                    
                    disabled={
                      !activeEntry.active_revision_id ||
                      activeEntry.is_active === false ||
                      loading ||
                      Boolean(batchAction) ||
                      entryValidationPending(activeEntry.id)
                    }
                    onClick={() => openEditor(activeEntry)}
                    className="w-full"
                  >
                    <PencilLine size={14} />
                    {t("actions.editDefinition")}
                  </Button>
                  {canAttest(activeEntry) && (
                    <Button variant="outline"
                      
                      disabled={
                        loading ||
                        Boolean(batchAction) ||
                        entryValidationPending(activeEntry.id)
                      }
                      onClick={() => void runBatch("attest", [activeEntry])}
                      className="w-full"
                    >
                      <UserCheck size={15} />
                      {t("actions.manualReview")}
                    </Button>
                  )}
                  {canRestore(activeEntry) && (
                    <Button variant="outline"
                      
                      disabled={loading || Boolean(batchAction)}
                      onClick={() => void runBatch("restore", [activeEntry])}
                      className="w-full"
                    >
                      <RefreshCw size={14} />
                      {t("actions.restore")}
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-56 items-center justify-center p-6 text-center text-sm text-muted-foreground">
                {t("details.selectPrompt")}
              </div>
            )}
          </SemanticDetailPanel>
        </div>
      </main>

      <SemanticGovernanceDialog
        open={governanceDialogOpen}
        projectId={projectId}
        sources={sources}
        onClose={closeGovernanceDialog}
        onGenerated={handleRecommendationsGenerated}
        onInventoryStarted={handleInventoryStarted}
        onCatalogRefreshed={handleCatalogRefreshed}
      />

      {historyEntry && <SemanticHistoryDialog key={`${projectId}:${historyEntry.id}`} projectId={projectId} entryId={historyEntry.id} label={historyEntry.label}
        present={entry => historyPresentation(entry, t, locale)} onClose={() => setHistoryEntry(null)} onRestored={entry => {
          showAllDefinitions();
          setSearch(rawPresentationBusinessName(entry) ?? "");
          setPage(current => current ? { ...current, items: current.items.map(item => item.id === entry.id ? entry : item) } : current);
          setActiveId(entry.id); setFeedback(t("feedback.historyRestored")); setSelection(current => removeSemanticSelection(current, [entry.id]));
          setReloadVersion(value => value + 1); void refreshProjectState();
        }} />}

      {editorEntry !== undefined && (
          <SemanticDefinitionEditor editing={Boolean(editorEntry)} busy={savingEditor} dirty={editorDirty}
            saveBlocked={Boolean(editorRecovery) || discardEditorOpen} writingRef={editorSavingRef}
            initialFocusRef={editorNameRef} onClose={closeEditor} onSubmit={saveEditor}
            confirmation={discardEditorOpen && <DiscardChangesDialog title={t("editor.discardTitle")} description={t("editor.discardDescription")}
              continueLabel={t("editor.continueEditing")} discardLabel={t("editor.discardAndClose")}
              disabled={savingEditor} fallbackFocus={editorNameRef} onContinue={() => setDiscardEditorOpen(false)} onDiscard={discardEditor} />}>
              {editorRecovery && <SemanticSaveRecovery target={editorRecovery.target} conflict={editorRecovery.conflict}
                draft={{ title: editorDraft.businessName, description: editorDraft.value }} present={entry => historyPresentation(entry, t, locale)}
                fallbackFocus={editorNameRef} onRetry={() => { setEditorRecovery(null); setEditorError(null); editorNameRef.current?.focus(); }}
                onLoad={entry => {
                  if (editorSavingRef.current) return;
                  const draft = draftForEntry(entry);
                  editorBaseline.current = draft;
                  setEditorEntry(entry); setEditorDraft(draft); setEditorRecovery(null); setEditorError(null);
                  setDiscardEditorOpen(false);
                  editorNameRef.current?.focus({ preventScroll: true });
                  setPage(current => current ? { ...current, items: current.items.map(item => item.id === entry.id ? entry : item) } : current);
                }} />}
              <fieldset disabled={savingEditor} className="min-w-0 space-y-5 px-6 py-6 disabled:opacity-70">
                {editorError && !editorRecovery && (
                  <div role="alert" className="flex items-start gap-2 bg-destructive/[0.06] px-3 py-2.5 text-sm text-destructive">
                    <CircleAlert size={15} className="mt-0.5 shrink-0" />
                    <span>{editorError}</span>
                  </div>
                )}

                <label className="block space-y-2 text-sm font-medium">
                  <span>{t("editor.owningScope")}</span>
                  <select
                    aria-label={t("editor.owningScope")}
                    value={editorDraft.scopeKey}
                    onChange={(event) => {
                      const nextScope = browserScopes.find(
                        (scope) => scope.key === event.target.value
                      );
                      setEditorDraft((current) => ({
                        ...current,
                        scopeKey: event.target.value,
                        ...(!editorEntry && nextScope?.sourceId
                          ? {
                              bindingSourceId: nextScope.sourceId,
                              bindingTable: nextScope.tableOrView || "",
                              bindingColumn: "",
                            }
                          : {}),
                      }));
                    }}
                    className={cn(fieldStyles.control, "font-normal")}
                  >
                    {editorDraft.scopeKey === "preserve" && editorEntry && (
                      <option value="preserve">
                        {t("editor.preserveScope", {
                          scope: semanticSourceLabel(editorEntry, t, locale),
                        })}
                      </option>
                    )}
                    {browserScopes.map((scope) => (
                      <option key={scope.key} value={scope.key}>
                        {`${"— ".repeat(Math.max(0, scope.depth))}${scope.businessName}`}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-2 text-sm font-medium">
                  <span>{t("editor.name")}</span>
                  <input
                    ref={editorNameRef}
                    aria-label={t("editor.name")}
                    value={editorDraft.businessName}
                    onChange={(event) => updateEditorDraft("businessName", event.target.value)}
                    maxLength={160}
                    placeholder={t("editor.namePlaceholder")}
                    className={cn(fieldStyles.control, "font-normal")}
                  />
                </label>

                <label className="block space-y-2 text-sm font-medium">
                  <span>{t("editor.businessDefinition")}</span>
                  <textarea
                    aria-label={t("editor.businessDefinition")}
                    value={editorDraft.value}
                    onChange={(event) => updateEditorDraft("value", event.target.value)}
                    rows={3}
                    placeholder={t("editor.businessDefinitionPlaceholder")}
                    className={cn(fieldStyles.control, "resize-y font-normal leading-6")}
                  />
                </label>

                <label className="block space-y-2 text-sm font-medium">
                  <span>{t("editor.synonyms")}</span>
                  <textarea
                    aria-label={t("editor.synonyms")}
                    value={editorDraft.synonymsText}
                    onChange={(event) => updateEditorDraft("synonymsText", event.target.value)}
                    rows={2}
                    placeholder={t("editor.synonymsPlaceholder")}
                    className={cn(fieldStyles.control, "resize-y font-normal leading-6")}
                  />
                  <span className="block text-xs font-normal leading-5 text-muted-foreground">
                    {t("editor.synonymsHint")}
                  </span>
                </label>

                <div className="grid gap-4 grid-cols-2">
                  <label className="space-y-2 text-sm font-medium">
                    <span>{t("editor.definitionType")}</span>
                    <select
                      aria-label={t("editor.definitionType")}
                      value={editorDraft.entryType}
                      disabled={editorDraft.entryType === "scope_presentation"}
                      onChange={(event) =>
                        updateEditorDraft(
                          "entryType",
                          event.target.value as SemanticEntry["entry_type"]
                        )
                      }
                      className={cn(fieldStyles.control, "font-normal")}
                    >
                      {editorDraft.entryType === "scope_presentation" ? (
                        <option value="scope_presentation">
                          {semanticTypeLabel("scope_presentation", t)}
                        </option>
                      ) : null}
                      {EDITABLE_TYPE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {semanticTypeLabel(option, t)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-2 text-sm font-medium">
                    <span>{t("editor.adoptionState")}</span>
                    <select
                      aria-label={t("editor.adoptionState")}
                      value={editorDraft.state}
                      onChange={(event) =>
                        updateEditorDraft("state", event.target.value as SemanticEntry["state"])
                      }
                      className={cn(fieldStyles.control, "font-normal")}
                    >
                      {EDITABLE_STATE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {t(`editorState.${option}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {editorIsDerivedMetric ? (
                  <div className="border-y border-border py-4">
                    <div className="text-xs font-medium text-muted-foreground">
                      {t("editor.derivedFormula")}
                    </div>
                    <div className="mt-2 text-sm font-medium leading-6">
                      {editorDerivedFormula || t("editor.derivedFormulaUnavailable")}
                    </div>
                  </div>
                ) : editorDraft.entryType === "metric" ||
                  editorDraft.entryType === "dimension" ? (
                  <fieldset className="space-y-4 border-t border-border pt-5">
                    <legend className="text-sm font-semibold">
                      {editorDraft.entryType === "metric"
                        ? t("editor.metricBinding")
                        : t("editor.dimensionBinding")}
                    </legend>
                    <div className="grid gap-3 grid-cols-3">
                      <label className="space-y-1.5 text-xs font-medium">
                        <span>{t("editor.dataSource")}</span>
                        <select
                          aria-label={t("editor.bindingDataSource")}
                          value={editorDraft.bindingSourceId}
                          onChange={(event) =>
                            setEditorDraft((current) => ({
                              ...current,
                              bindingSourceId: event.target.value,
                              bindingTable: "",
                              bindingColumn: "",
                            }))
                          }
                          className={cn(fieldStyles.control, "font-normal")}
                        >
                          <option value="">{t("editor.select")}</option>
                          {sources.map((source) => (
                            <option key={source.id} value={source.id}>
                              {source.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-1.5 text-xs font-medium">
                        <span>{t("editor.tableOrView")}</span>
                        <select
                          aria-label={t("editor.bindingTableOrView")}
                          value={editorDraft.bindingTable}
                          onChange={(event) =>
                            setEditorDraft((current) => ({
                              ...current,
                              bindingTable: event.target.value,
                              bindingColumn: "",
                            }))
                          }
                          className={cn(fieldStyles.control, "font-normal")}
                        >
                          <option value="">{t("editor.select")}</option>
                          {editorBindingTables.map((table) => (
                            <option key={table.name} value={table.name}>
                              {table.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-1.5 text-xs font-medium">
                        <span>
                          {editorDraft.entryType === "metric"
                            ? t("editor.valueField")
                            : t("editor.groupingField")}
                        </span>
                        <select
                          aria-label={
                            editorDraft.entryType === "metric"
                              ? t("editor.valueField")
                              : t("editor.groupingField")
                          }
                          value={editorDraft.bindingColumn}
                          onChange={(event) =>
                            updateEditorDraft("bindingColumn", event.target.value)
                          }
                          className={cn(fieldStyles.control, "font-normal")}
                        >
                          <option value="">{t("editor.select")}</option>
                          {editorBindingColumns.map((column) => (
                            <option key={column.name} value={column.name}>
                              {column.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {editorDraft.entryType === "metric" ? (
                      <label className="block max-w-xs space-y-1.5 text-xs font-medium">
                        <span>{t("editor.aggregation")}</span>
                        <select
                          aria-label={t("editor.aggregation")}
                          value={editorDraft.metricOperation}
                          onChange={(event) =>
                            updateEditorDraft(
                              "metricOperation",
                              event.target.value as "sum" | "avg"
                            )
                          }
                          className={cn(fieldStyles.control, "font-normal")}
                        >
                          <option value="sum">{t("editor.aggregationSum")}</option>
                          <option value="avg">{t("editor.aggregationAverage")}</option>
                        </select>
                      </label>
                    ) : (
                      <label className="block max-w-xs space-y-1.5 text-xs font-medium">
                        <span>{t("editor.dimensionRole")}</span>
                        <select
                          aria-label={t("editor.dimensionRole")}
                          value={editorDraft.dimensionRole}
                          onChange={(event) =>
                            updateEditorDraft(
                              "dimensionRole",
                              event.target.value as SemanticEditorDraft["dimensionRole"]
                            )
                          }
                          className={cn(fieldStyles.control, "font-normal")}
                        >
                          <option value="time">{t("editor.dimensionTime")}</option>
                          <option value="category">{t("editor.dimensionCategory")}</option>
                          <option value="identifier">{t("editor.dimensionIdentifier")}</option>
                        </select>
                      </label>
                    )}
                  </fieldset>
                ) : null}

                {editorDraft.entryType === "relationship" ? (
                  <div className="space-y-5 border-t border-border pt-5">
                    <div>
                      <h3 className="text-sm font-semibold">{t("editor.relationshipFields")}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("editor.relationshipFieldsDescription")}
                      </p>
                    </div>

                    {(["left", "right"] as const).map((side) => {
                      const isLeft = side === "left";
                      const sourceValue = isLeft
                        ? editorDraft.leftSourceId
                        : editorDraft.rightSourceId;
                      const tableValue = isLeft ? editorDraft.leftTable : editorDraft.rightTable;
                      const columnValue = isLeft ? editorDraft.leftColumn : editorDraft.rightColumn;
                      const tables = isLeft ? editorLeftTables : editorRightTables;
                      const columns = isLeft ? editorLeftColumns : editorRightColumns;
                      const sideLabel = isLeft ? t("editor.left") : t("editor.right");
                      return (
                        <fieldset key={side} className="grid gap-3 grid-cols-3">
                          <legend className="mb-2 text-xs font-medium text-muted-foreground">{sideLabel}</legend>
                          <label className="space-y-1.5 text-xs font-medium">
                            <span>{t("editor.dataSource")}</span>
                            <select
                              aria-label={t("editor.sideDataSource", { side: sideLabel })}
                              value={sourceValue}
                              onChange={(event) =>
                                setEditorDraft((current) => ({
                                  ...current,
                                  [isLeft ? "leftSourceId" : "rightSourceId"]: event.target.value,
                                  [isLeft ? "leftTable" : "rightTable"]: "",
                                  [isLeft ? "leftColumn" : "rightColumn"]: "",
                                }))
                              }
                              className={cn(fieldStyles.control, "font-normal")}
                            >
                              <option value="">{t("editor.select")}</option>
                              {sources.map((source) => (
                                <option key={source.id} value={source.id}>
                                  {source.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="space-y-1.5 text-xs font-medium">
                            <span>{t("editor.tableOrView")}</span>
                            <input
                              aria-label={t("editor.sideTableOrView", { side: sideLabel })}
                              list={`semantic-${side}-tables`}
                              value={tableValue}
                              onChange={(event) =>
                                updateEditorDraft(
                                  isLeft ? "leftTable" : "rightTable",
                                  event.target.value
                                )
                              }
                              className={cn(fieldStyles.control, "font-normal")}
                            />
                            <datalist id={`semantic-${side}-tables`}>
                              {tables.map((table) => (
                                <option key={table.name} value={table.name} />
                              ))}
                            </datalist>
                          </label>
                          <label className="space-y-1.5 text-xs font-medium">
                            <span>{t("editor.column")}</span>
                            <input
                              aria-label={t("editor.sideColumn", { side: sideLabel })}
                              list={`semantic-${side}-columns`}
                              value={columnValue}
                              onChange={(event) =>
                                updateEditorDraft(
                                  isLeft ? "leftColumn" : "rightColumn",
                                  event.target.value
                                )
                              }
                              className={cn(fieldStyles.control, "font-normal")}
                            />
                            <datalist id={`semantic-${side}-columns`}>
                              {columns.map((column) => (
                                <option key={column.name} value={column.name} />
                              ))}
                            </datalist>
                          </label>
                        </fieldset>
                      );
                    })}

                    <div className="grid gap-3 grid-cols-3">
                      <label className="space-y-1.5 text-xs font-medium">
                        <span>{t("editor.joinType")}</span>
                        <select
                          aria-label={t("editor.joinType")}
                          value={editorDraft.defaultJoin}
                          onChange={(event) =>
                            updateEditorDraft("defaultJoin", event.target.value as "left" | "inner")
                          }
                          className={cn(fieldStyles.control, "font-normal")}
                        >
                          <option value="left">{t("editor.joinLeft")}</option>
                          <option value="inner">{t("editor.joinInner")}</option>
                        </select>
                      </label>
                      <label className="space-y-1.5 text-xs font-medium">
                        <span>{t("editor.cardinality")}</span>
                        <select
                          aria-label={t("editor.cardinality")}
                          value={editorDraft.cardinality}
                          onChange={(event) =>
                            updateEditorDraft(
                              "cardinality",
                              event.target.value as SemanticEditorDraft["cardinality"]
                            )
                          }
                          className={cn(fieldStyles.control, "font-normal")}
                        >
                          <option value="">{t("editor.cardinalityUnknown")}</option>
                          <option value="one_to_one">{t("editor.oneToOne")}</option>
                          <option value="one_to_many">{t("editor.oneToMany")}</option>
                          <option value="many_to_one">{t("editor.manyToOne")}</option>
                          <option value="many_to_many">{t("editor.manyToMany")}</option>
                        </select>
                      </label>
                      <label className="space-y-1.5 text-xs font-medium">
                        <span>{t("editor.normalization")}</span>
                        <select
                          aria-label={t("editor.normalization")}
                          value={editorDraft.normalization}
                          onChange={(event) =>
                            updateEditorDraft(
                              "normalization",
                              event.target.value as SemanticEditorDraft["normalization"]
                            )
                          }
                          className={cn(fieldStyles.control, "font-normal")}
                        >
                          <option value="auto">{t("editor.normalizationAuto")}</option>
                          <option value="exact">{t("editor.normalizationExact")}</option>
                          <option value="trim_casefold">
                            {t("editor.normalizationTrimCasefold")}
                          </option>
                          <option value="identifier">{t("editor.normalizationIdentifier")}</option>
                        </select>
                      </label>
                    </div>

                    <details className="border-t border-border pt-4">
                      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                        {t("editor.validationBounds")}
                      </summary>
                      <div className="mt-3 grid gap-3 grid-cols-2">
                        <label className="space-y-1.5 text-xs font-medium">
                          <span>{t("editor.minimumLeftMatchRate")}</span>
                          <input
                            aria-label={t("editor.minimumLeftMatchRate")}
                            type="number"
                            min="0"
                            max="1"
                            step="0.01"
                            value={editorDraft.minimumLeftMatchRate}
                            onChange={(event) =>
                              updateEditorDraft("minimumLeftMatchRate", event.target.value)
                            }
                            className={cn(fieldStyles.control, "font-normal")}
                          />
                        </label>
                        <label className="space-y-1.5 text-xs font-medium">
                          <span>{t("editor.maximumExpansionRatio")}</span>
                          <input
                            aria-label={t("editor.maximumExpansionRatio")}
                            type="number"
                            min="1"
                            step="0.01"
                            value={editorDraft.maximumExpansionRatio}
                            onChange={(event) =>
                              updateEditorDraft("maximumExpansionRatio", event.target.value)
                            }
                            className={cn(fieldStyles.control, "font-normal")}
                          />
                        </label>
                      </div>
                    </details>
                  </div>
                ) : null}

              </fieldset>

          </SemanticDefinitionEditor>
      )}

      {selectedEntries.length > 0 && <div className="fixed bottom-2 left-1/2 z-30 flex w-[min(540px,calc(100vw-1rem))] -translate-x-1/2 items-center gap-3 border border-primary/25 bg-foreground px-4 py-3 text-background shadow-2xl">
        <ListChecks size={19} className="shrink-0" />
        <div className="mr-auto min-w-0"><p className="text-sm font-medium">{t("bulk.selected", { count: selectedEntries.length })}</p>
          {selectedElsewhere > 0 && <p className="mt-0.5 text-[11px] opacity-65">{t("selection.elsewhere", { count: selectedElsewhere })}</p>}</div>
        <button type="button" disabled={!!batchAction} onClick={() => setSelectionOpen(true)} className="min-h-10 shrink-0 bg-background px-3 text-xs font-semibold text-foreground disabled:opacity-40">{t("selection.review")}</button>
        <button type="button" disabled={!!batchAction} aria-label={t("bulk.clear")} onClick={() => { setSelection(new Map()); setSelectionOpen(false); detailSearchRef.current?.focus(); }} className="inline-flex size-9 shrink-0 items-center justify-center opacity-70 hover:opacity-100 disabled:opacity-40"><X size={16} /></button>
      </div>}
      {selectionOpen && selection.size > 0 && <SemanticSelectionDialog selection={selection} visibleIds={visibleSelectedIds}
        present={entry => {
          const display = historyPresentation(entry, t, locale);
          const scope = scopeBreadcrumb(entry, undefined, browserScopes, t);
          return { title: display.title, description: display.description ?? "", scope: scope === t("header.allDefinitions") ? semanticSourceLabel(entry, t, locale) : scope };
        }}
        allowed={action => !loading && !selectionNeedsReview && !selectedHasPendingValidation && actionAllowed(action, selectedEntries) && (action !== "queue_validation" || !validationInProgress)}
        busy={!!batchAction} error={error}
        onRemove={id => { if (!batchInFlight.current) { setSelection(current => removeSemanticSelection(current, [id])); if (selection.size === 1) { setSelectionOpen(false); detailSearchRef.current?.focus(); } } }}
        onApply={action => void runBatch(action)} onClose={() => { if (!batchInFlight.current) setSelectionOpen(false); }} />}
    </div>
  );
}
