import type { DataSourceRelationIndex, ProjectDataSource, RelationIndexRefreshResult } from "@/lib/types/api";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

interface SourceTableOption {
  name: string;
  businessName: string;
  summary: string | null;
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

function relationIndexForSource(source: ProjectDataSource): Record<string, unknown> {
  const preanalysis = isRecord(source.profile_data.preanalysis)
    ? source.profile_data.preanalysis
    : {};
  return isRecord(source.profile_data.relation_index)
    ? source.profile_data.relation_index
    : isRecord(preanalysis.relation_index)
      ? preanalysis.relation_index
      : {};
}

function mergedTableRecords(source: ProjectDataSource): Record<string, unknown>[] {
  const relationIndex = relationIndexForSource(source);
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

export function sourceBusinessName(source: ProjectDataSource): string {
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

function tableDisplayName(value: string, locale: string): string {
  const relationName = value.split(".").at(-1) || value;
  if (locale === "en") {
    return relationName
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .split(/[^a-zA-Z0-9\u3400-\u9fff]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }
  const tokens = relationName
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .split(/[^a-zA-Z0-9\u3400-\u9fff]+/)
    .filter(Boolean);
  const year = tokens.find((token) => /^(?:19|20)\d{2}$/.test(token));
  const ignored = new Set(["d", "dim", "f", "fact", "info", "new", "tbl", "table", "v", "view"]);
  const labels: Record<string, string> = {
    center: "中心",
    cust: "客户",
    customer: "客户",
    customers: "客户",
    dict: "字典",
    order: "订单",
    orders: "订单",
    prd: "商品",
    product: "商品",
    products: "商品",
    refund: "退款",
    refunds: "退款",
    region: "地区",
    sales: "销售",
    sku: "商品",
    store: "门店",
    stores: "门店",
  };
  const rendered = tokens
    .filter((token) => token !== year && !ignored.has(token.toLowerCase()))
    .map((token) => {
      if (/[\u3400-\u9fff]/u.test(token)) return token;
      return labels[token.toLowerCase()] || token.toUpperCase();
    })
    .join("");
  if (year && rendered) return `${year} 年${rendered}资料`;
  return rendered ? `${rendered}资料` : "数据表";
}

export function sourceTableOptions(source: ProjectDataSource, locale: string): SourceTableOption[] {
  if (source.kind !== "connection") return [];
  const seen = new Set<string>();
  return mergedTableRecords(source).flatMap((table) => {
    const name = qualifiedRelationName(table);
    if (!name || seen.has(name)) return [];
    seen.add(name);
    const documentedName =
      nonEmptyString(table.business_name) ||
      nonEmptyString(table.display_name) ||
      nonEmptyString(table.comment);
    return [
      {
        name,
        businessName: documentedName || tableDisplayName(name, locale),
        summary:
          nonEmptyString(table.description) ||
          nonEmptyString(table.business_topic) ||
          (documentedName === nonEmptyString(table.comment)
            ? null
            : nonEmptyString(table.comment)),
      },
    ];
  });
}

export function parseRelationIndexRefresh(value: unknown): RelationIndexRefreshResult | null {
  if (!isRecord(value) || typeof value.source_id !== "string") return null;
  if (!isRecord(value.relation_index) || !Array.isArray(value.relation_index.relations)) {
    return null;
  }
  return value as unknown as RelationIndexRefreshResult;
}

export function withRelationIndex(
  source: ProjectDataSource,
  relationIndex: DataSourceRelationIndex
): ProjectDataSource {
  const profile = source.profile_data;
  const preanalysis = isRecord(profile.preanalysis) ? profile.preanalysis : {};
  return {
    ...source,
    profile_data: {
      ...profile,
      relation_index: relationIndex,
      preanalysis: {
        ...preanalysis,
        relation_index: relationIndex,
      },
    },
  };
}
