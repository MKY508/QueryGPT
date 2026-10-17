import {
  act,
  cleanup,
  fireEvent,
  render as testingLibraryRender,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockSemanticDialogs, mockSemanticWidth } from "./semantic-dialog-mock";
import {
  ProjectUnderstandingWorkspace,
  relationshipDefinition,
} from "@/components/semantic/ProjectUnderstandingWorkspace";
import { api } from "@/lib/api/client";
import { useProjectStore } from "@/lib/stores/project";
import type {
  ProjectDataSource,
  SemanticEntry,
  SemanticInventoryJob,
  SemanticScopeNode,
  SemanticValidationJob,
} from "@/lib/types/api";
import enMessages from "@/messages/en.json";
import zhMessages from "@/messages/zh.json";

function render(ui: ReactElement, locale: "en" | "zh" = "zh") {
  document.documentElement.lang = locale;
  return testingLibraryRender(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? enMessages : zhMessages}
    >
      {ui}
    </NextIntlClientProvider>
  );
}

const candidate = (id: string, leftTable: string, rightTable: string): SemanticEntry => ({
  id,
  project_id: "project-1",
  key: `relationship_candidate:store_id:${id}`,
  value: `${leftTable}.store_id ↔ ${rightTable}.store_id`,
  entry_type: "relationship",
  state: "candidate",
  confidence: 0.55,
  is_active: true,
  active_revision_id: `revision-${id}`,
  revision_number: 1,
  definition: {
    version: 1,
    business_name: `门店关联 ${id}`,
    description: "按门店编号匹配业务记录",
    left: {
      source_logical_name: "财务库",
      source_kind: "connection",
      table_or_view: leftTable,
      column: "store_id",
      data_type: "integer",
      schema_signature: "a".repeat(64),
    },
    right: {
      source_logical_name: "财务库",
      source_kind: "connection",
      table_or_view: rightTable,
      column: "store_id",
      data_type: "integer",
      schema_signature: "b".repeat(64),
    },
  },
  execution_state: "needs_validation",
  allowed_actions: ["queue_validation", "ignore"],
  validity: "unverified",
  evidence: [{ kind: "matching_column_names" }],
  source_refs: [
    {
      source_id: "source-finance",
      logical_name: "财务库",
      name: "财务库",
      kind: "connection",
      format: "sqlite",
    },
  ],
  source_scope: "local_database",
  source: "inferred",
  created_at: "2026-07-19T00:00:00Z",
  updated_at: "2026-07-19T00:00:00Z",
});

const projectSource = (
  id: string,
  name: string,
  kind: ProjectDataSource["kind"],
  format: string
): ProjectDataSource => ({
  id,
  project_id: "project-1",
  kind,
  name,
  format,
  status: "ready",
  fingerprint: null,
  profile_data: { logical_name: name },
  created_at: "2026-07-19T00:00:00Z",
  updated_at: "2026-07-19T00:00:00Z",
});

describe("ProjectUnderstandingWorkspace", () => {
  let restoreDialogs: () => void;
  beforeEach(() => { restoreDialogs = mockSemanticDialogs(); mockSemanticWidth(true); });
  afterEach(() => {
    cleanup();
    restoreDialogs();
    vi.restoreAllMocks();
    window.sessionStorage.clear();
    window.localStorage.clear();
    useProjectStore.setState({ currentProjectId: null });
  });

  it("shows the full relationship count with governed paging and filtering", async () => {
    const first = candidate("one", "orders", "stores");
    const second = candidate("two", "refunds", "stores");
    const get = vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/api/v1/projects/project-1") {
        return { data: { data: { id: "project-1", name: "财务分析" } } } as never;
      }
      if (url === "/api/v1/projects/project-1/sources") {
        return { data: { data: [] } } as never;
      }
      return {
        data: {
          data: {
            items: [first, second],
            total: 792,
            offset: 0,
            limit: 50,
            has_more: true,
            next_offset: 50,
          },
        },
      } as never;
    });

    render(<ProjectUnderstandingWorkspace projectId="project-1" />);

    expect(await screen.findByText("共 792 条")).toBeInTheDocument();
    expect(screen.getAllByText("门店关联 one").length).toBeGreaterThan(0);
    expect(screen.getByRole("columnheader", { name: "业务名称与含义" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "所在范围" })).toBeInTheDocument();
    expect(screen.queryByText("同名字段")).not.toBeInTheDocument();
    expect(screen.queryByText("来源字段 / 技术绑定")).not.toBeInTheDocument();
    expect(screen.queryByText(/store_id/)).not.toBeInTheDocument();
    expect(screen.queryByText("55%")).not.toBeInTheDocument();
    expect(screen.queryByText("只有验证过的规则才会执行")).not.toBeInTheDocument();
    expect(screen.getByLabelText("内容类型")).toHaveValue("all");
    const initialPageParams = (
      get.mock.calls.find(
        ([url]) => url === "/api/v1/projects/project-1/knowledge/page"
      )?.[1] as { params?: Record<string, unknown> } | undefined
    )?.params;
    expect(initialPageParams).not.toHaveProperty("entry_type");
    expect(initialPageParams).not.toHaveProperty("source_scope");
    expect(initialPageParams).not.toHaveProperty("scope_id");

    fireEvent.change(screen.getByLabelText("内容类型"), {
      target: { value: "business_rule" },
    });
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith(
        "/api/v1/projects/project-1/knowledge/page",
        expect.objectContaining({
          params: expect.objectContaining({
            entry_type: "business_rule",
            business_facing_only: true,
          }),
        })
      )
    );
  });

  it("renders the full workspace chrome in English without translating project data", async () => {
    const entry = {
      ...candidate("english", "orders", "stores"),
      execution_details: {
        code: "semantic_recommendation_needs_validation",
        summary: "这条建议仍需系统验证",
      },
    };
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/api/v1/projects/project-1") {
        return { data: { data: { id: "project-1", name: "财务分析" } } } as never;
      }
      if (url === "/api/v1/projects/project-1/sources") {
        return { data: { data: [] } } as never;
      }
      return {
        data: {
          data: {
            items: [entry],
            total: 1,
            offset: 0,
            limit: 50,
            has_more: false,
            next_offset: null,
          },
        },
      } as never;
    });

    render(<ProjectUnderstandingWorkspace projectId="project-1" />, "en");

    expect(await screen.findByText("1 item")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Project understanding" })).toBeInTheDocument();
    expect(screen.getByLabelText("Search project understanding")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Owning scope" })).toBeInTheDocument();
    expect(screen.queryByText("Matching column names")).not.toBeInTheDocument();
    expect(screen.queryByText("This recommendation still needs system validation")).not.toBeInTheDocument();
    expect(screen.queryByText("这条建议仍需系统验证")).not.toBeInTheDocument();
    expect(screen.queryByText("门店关联 english")).not.toBeInTheDocument();
    expect(screen.getAllByText("Untitled data relationship").length).toBeGreaterThan(0);
    expect(screen.queryByText("What happens after adoption?")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add definition" })).toBeInTheDocument();
    expect(screen.getByLabelText("Previous page")).toBeInTheDocument();
    expect(screen.getByLabelText("Next page")).toBeInTheDocument();
    expect(screen.getAllByText("财务分析").length).toBeGreaterThan(0);
    expect(screen.queryByText(/relationship_candidate/)).not.toBeInTheDocument();
    expect(screen.getByTestId("semantic-scope-tree")).toHaveClass("flex");
  });

  it("localizes an API failure in English without exposing Chinese detail", async () => {
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/api/v1/projects/project-1") {
        return { data: { data: { id: "project-1", name: "财务分析" } } } as never;
      }
      if (url === "/api/v1/projects/project-1/sources") {
        return { data: { data: [] } } as never;
      }
      throw {
        isAxiosError: true,
        message: "Request failed with status code 503",
        response: {
          status: 503,
          data: { detail: "项目理解服务暂时不可用" },
        },
      };
    });

    render(<ProjectUnderstandingWorkspace projectId="project-1" />, "en");

    expect(
      await screen.findByText("This content did not finish loading. Please retry.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/HTTP 503/)).not.toBeInTheDocument();
    expect(screen.queryByText("项目理解服务暂时不可用")).not.toBeInTheDocument();
  });

  it("builds a source-table tree and sends exact source filters on fallback", async () => {
    const sources = [
      projectSource("local-db", "本地财务库", "connection", "sqlite"),
      projectSource("remote-db", "线上订单库", "connection", "postgresql"),
      projectSource("excel-file", "年度预算.xlsx", "file", "xlsx"),
      projectSource("csv-file", "门店清单.csv", "file", "csv"),
      projectSource("parquet-file", "明细.parquet", "file", "parquet"),
      projectSource("json-file", "渠道.json", "file", "json"),
    ];
    const get = vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/api/v1/projects/project-1") {
        return { data: { data: { id: "project-1", name: "财务分析" } } } as never;
      }
      if (url === "/api/v1/projects/project-1/sources") {
        return { data: { data: sources } } as never;
      }
      return {
        data: {
          data: {
            items: [],
            total: 0,
            offset: 0,
            limit: 50,
            has_more: false,
            next_offset: null,
          },
        },
      } as never;
    });
    render(<ProjectUnderstandingWorkspace projectId="project-1" />);
    const tree = await screen.findByRole("tree");
    expect(within(tree).queryByRole("treeitem", { name: /财务分析/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "项目层" })).not.toBeInTheDocument();
    expect(within(tree).getByRole("treeitem", { name: /线上订单库/ })).toBeInTheDocument();
    expect(within(tree).getAllByText("数据源说明与表关系").length).toBeGreaterThan(0);
    const csvSource = within(tree).getByRole("treeitem", { name: /门店清单.csv/ });
    expect(csvSource).toHaveAttribute("aria-expanded", "false");
    expect(
      within(tree)
        .queryAllByRole("treeitem")
        .filter((item) => item.getAttribute("aria-level") === "2")
    ).toHaveLength(0);
    fireEvent.click(csvSource);
    expect(csvSource).toHaveAttribute("aria-expanded", "true");
    const fileView = within(tree)
      .getAllByRole("treeitem")
      .find((item) => item.getAttribute("aria-level") === "2");
    expect(fileView).toBeDefined();
    fireEvent.click(fileView as HTMLElement);
    await waitFor(() => {
      const [, config] = get.mock.calls.at(-1) || [];
      const params = (config as { params?: Record<string, unknown> } | undefined)?.params;
      expect(params).toMatchObject({ source_id: "csv-file", offset: 0 });
      expect(params).not.toHaveProperty("source_scope");
    });

    const allRequestsBeforeRestore = get.mock.calls.length;
    fireEvent.change(screen.getByLabelText("适用数据"), {
      target: { value: "" },
    });
    await waitFor(() => {
      expect(get.mock.calls.length).toBeGreaterThan(allRequestsBeforeRestore);
      const [, config] = get.mock.calls.at(-1) || [];
      const params = (config as { params?: Record<string, unknown> } | undefined)?.params;
      expect(params).not.toHaveProperty("source_scope");
      expect(params).not.toHaveProperty("source_id");
    });
  });

  it("uses server scope ids for exact pages and keeps technical logical names out of breadcrumbs", async () => {
    const source = projectSource("orders-source", "订单数据库", "connection", "postgresql");
    source.profile_data = {
      logical_name: "orders_4f9eeb",
      tables: [{ name: "orders", columns: [{ name: "amount", type: "numeric" }] }],
    };
    const rootPath = {
      id: "scope-root",
      kind: "project" as const,
      stable_key: "project",
      business_name: "财务分析",
      source_logical_name: null,
      table_or_view: null,
    };
    const sourcePath = {
      id: "scope-orders-source",
      kind: "source" as const,
      stable_key: "source:orders_4f9eeb",
      business_name: "订单经营",
      source_logical_name: "orders_4f9eeb",
      table_or_view: null,
    };
    const tablePath = {
      id: "scope-orders-table",
      kind: "table" as const,
      stable_key: "table:orders_4f9eeb:orders",
      business_name: "订单明细",
      source_logical_name: "orders_4f9eeb",
      table_or_view: "orders",
    };
    const scopes: SemanticScopeNode[] = [
      {
        ...rootPath,
        project_id: "project-1",
        parent_id: null,
        description: "项目共用口径",
        is_active: true,
        direct_entry_count: 2,
        child_count: 1,
        path: [rootPath],
        created_at: "2026-07-22T00:00:00Z",
        updated_at: "2026-07-22T00:00:00Z",
      },
      {
        ...sourcePath,
        project_id: "project-1",
        parent_id: rootPath.id,
        description: "订单业务数据",
        is_active: true,
        direct_entry_count: 7,
        child_count: 1,
        path: [rootPath, sourcePath],
        created_at: "2026-07-22T00:00:00Z",
        updated_at: "2026-07-22T00:00:00Z",
      },
      {
        ...tablePath,
        project_id: "project-1",
        parent_id: sourcePath.id,
        description: "每笔订单",
        is_active: true,
        direct_entry_count: 1,
        child_count: 0,
        path: [rootPath, sourcePath, tablePath],
        created_at: "2026-07-22T00:00:00Z",
        updated_at: "2026-07-22T00:00:00Z",
      },
    ];
    const tableMetric: SemanticEntry = {
      ...candidate("orders-amount", "orders", "stores"),
      key: "metric:orders_4f9eeb:amount",
      value: "订单金额合计",
      entry_type: "metric",
      definition: {
        version: 1,
        kind: "aggregate_metric",
        business_name: "订单金额",
        description: "每笔订单金额的合计",
      },
      scope_id: tablePath.id,
      scope_path: [rootPath, sourcePath, tablePath],
      source_refs: [
        {
          source_id: source.id,
          logical_name: "orders_4f9eeb",
          name: "orders_4f9eeb",
          kind: "connection",
          format: "postgresql",
        },
      ],
    };
    const get = vi.spyOn(api, "get").mockImplementation(async (url, config) => {
      if (url === "/api/v1/projects/project-1") {
        return { data: { data: { id: "project-1", name: "财务分析" } } } as never;
      }
      if (url === "/api/v1/projects/project-1/sources") {
        return { data: { data: [source] } } as never;
      }
      if (url === "/api/v1/projects/project-1/semantic-scopes") {
        return { data: { data: scopes } } as never;
      }
      const params = (config as { params?: Record<string, unknown> } | undefined)?.params;
      const items = params?.scope_id === tablePath.id ? [tableMetric] : [];
      return {
        data: {
          data: {
            items,
            total: items.length,
            offset: 0,
            limit: 50,
            has_more: false,
            next_offset: null,
          },
        },
      } as never;
    });

    render(<ProjectUnderstandingWorkspace projectId="project-1" />);
    const sourceNode = await screen.findByRole("treeitem", { name: /订单经营/ });
    expect(sourceNode).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("这一层有 7 条定义")).toBeInTheDocument();
    const initialPageRequest = get.mock.calls.find(
      ([url]) => url === "/api/v1/projects/project-1/knowledge/page"
    );
    expect(
      (initialPageRequest?.[1] as { params?: Record<string, unknown> } | undefined)?.params
    ).not.toHaveProperty("scope_id");

    fireEvent.click(sourceNode);
    const tableNode = await screen.findByRole("treeitem", { name: /订单明细/ });
    fireEvent.click(tableNode);

    expect((await screen.findAllByText("订单金额")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("订单经营 / 订单明细").length).toBeGreaterThan(0);
    expect(screen.queryByText(/orders_4f9eeb/)).not.toBeInTheDocument();
    const tableRequest = get.mock.calls.find(
      ([url, config]) =>
        url === "/api/v1/projects/project-1/knowledge/page" &&
        (config as { params?: Record<string, unknown> } | undefined)?.params?.scope_id ===
          tablePath.id
    );
    expect(tableRequest).toBeDefined();
    expect(
      (tableRequest?.[1] as { params?: Record<string, unknown> } | undefined)?.params
    ).not.toHaveProperty("source_id");
  });

  it("shows governed Chinese scope names and synonyms while keeping bindings folded", async () => {
    const source = projectSource("product-source", "商品原始库", "connection", "postgresql");
    source.profile_data = {
      logical_name: "demo_warehouse",
      tables: [
        {
          schema: "public",
          name: "catalog_items_2024",
          columns: [{ name: "published_at", type: "timestamp" }],
        },
      ],
    };
    const rootPath = {
      id: "scope-root",
      kind: "project" as const,
      stable_key: "project",
      business_name: "商品分析",
      source_logical_name: null,
      table_or_view: null,
    };
    const sourcePath = {
      id: "scope-products",
      kind: "source" as const,
      stable_key: "source:demo_warehouse",
      business_name: "商品资料库",
      synonyms: ["商品母库"],
      source_logical_name: "demo_warehouse",
      table_or_view: null,
    };
    const tablePath = {
      id: "scope-products-2024",
      kind: "table" as const,
      stable_key: "table:demo_warehouse:public.catalog_items_2024",
      business_name: "2024 年商品主数据",
      synonyms: ["2024 商品表"],
      source_logical_name: "demo_warehouse",
      table_or_view: "public.catalog_items_2024",
    };
    const scopes: SemanticScopeNode[] = [
      {
        ...rootPath,
        project_id: "project-1",
        parent_id: null,
        description: "项目通用定义",
        is_active: true,
        direct_entry_count: 0,
        child_count: 1,
        path: [rootPath],
        created_at: "2026-07-22T00:00:00Z",
        updated_at: "2026-07-22T00:00:00Z",
      },
      {
        ...sourcePath,
        project_id: "project-1",
        parent_id: rootPath.id,
        description: "商品相关业务数据",
        is_active: true,
        direct_entry_count: 0,
        child_count: 1,
        path: [rootPath, sourcePath],
        created_at: "2026-07-22T00:00:00Z",
        updated_at: "2026-07-22T00:00:00Z",
      },
      {
        ...tablePath,
        project_id: "project-1",
        parent_id: sourcePath.id,
        description: "记录 2024 年商品资料",
        is_active: true,
        direct_entry_count: 2,
        child_count: 0,
        path: [rootPath, sourcePath, tablePath],
        created_at: "2026-07-22T00:00:00Z",
        updated_at: "2026-07-22T00:00:00Z",
      },
    ];
    const scopeSuggestion: SemanticEntry = {
      ...candidate("scope-name", "products", "products"),
      key: "scope_presentation:demo_warehouse:public.catalog_items_2024",
      value: "记录 2024 年商品资料",
      entry_type: "scope_presentation",
      definition: {
        version: 1,
        kind: "scope_presentation",
        scope_kind: "table",
        source_logical_name: "demo_warehouse",
        source_kind: "connection",
        table_or_view: "public.catalog_items_2024",
        business_name: "2024 年商品主数据",
        description: "记录 2024 年商品资料",
        synonyms: ["2024 商品表", "年度商品资料"],
        example_questions: [],
      },
      scope_id: tablePath.id,
      scope_path: [rootPath, sourcePath, tablePath],
      allowed_actions: ["attest", "ignore"],
    };
    const publishedAt: SemanticEntry = {
      ...candidate("published-at", "products", "products"),
      key: "dimension:demo_warehouse:published_at",
      value: "商品首次发布的时间",
      entry_type: "dimension",
      definition: {
        version: 1,
        kind: "dimension",
        role: "time",
        source: {
          source_logical_name: "demo_warehouse",
          source_kind: "connection",
          table_or_view: "public.catalog_items_2024",
          action_column: "published_at",
          canonical_type: "datetime",
          schema_signature: "a".repeat(64),
        },
        business_name: "发布时间",
        description: "商品首次发布的时间",
        synonyms: ["表格时间", "发布日期", "published at"],
        example_questions: ["按表格时间看商品发布趋势"],
      },
      scope_id: tablePath.id,
      scope_path: [rootPath, sourcePath, tablePath],
      allowed_actions: ["attest", "ignore"],
    };
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/api/v1/projects/project-1") {
        return { data: { data: { id: "project-1", name: "商品分析" } } } as never;
      }
      if (url === "/api/v1/projects/project-1/sources") {
        return { data: { data: [source] } } as never;
      }
      if (url === "/api/v1/projects/project-1/semantic-scopes") {
        return { data: { data: scopes } } as never;
      }
      return {
        data: {
          data: {
            items: [scopeSuggestion, publishedAt],
            total: 2,
            offset: 0,
            limit: 50,
            has_more: false,
            next_offset: null,
          },
        },
      } as never;
    });

    render(<ProjectUnderstandingWorkspace projectId="project-1" />);

    const sourceNode = await screen.findByRole("treeitem", { name: /商品资料库/ });
    fireEvent.click(sourceNode);
    expect(await screen.findByRole("treeitem", { name: /2024 年商品主数据/ })).toBeInTheDocument();
    expect(screen.getAllByText("待人工核对").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "人工核对" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "验证" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("row", { name: /发布时间/ }));
    expect(screen.getAllByText("表格时间").length).toBeGreaterThan(0);
    expect(screen.getAllByText("发布日期").length).toBeGreaterThan(0);
    expect(screen.queryByText("来源字段 / 技术绑定")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看 2024 年商品主数据" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByLabelText("定义类型")).toBeDisabled();
    expect(screen.getByLabelText("定义类型")).toHaveValue("scope_presentation");
  });

  it("hides untranslated descriptions and examples behind honest Chinese placeholders", async () => {
    const untranslatedEntry = (
      id: string,
      state: SemanticEntry["state"]
    ): SemanticEntry => ({
      ...candidate(id, "products", "products"),
      key: `dimension:demo_warehouse:${id}`,
      value: "Listing timestamp used for product reporting",
      entry_type: "dimension",
      state,
      definition: {
        version: 1,
        kind: "dimension",
        role: "time",
        source: {
          source_logical_name: "demo_warehouse",
          source_kind: "connection",
          table_or_view: "products",
          action_column: id,
          canonical_type: "datetime",
          schema_signature: "a".repeat(64),
        },
        business_name: id,
        description: "Timestamp used to group product listings by reporting period.",
        example_questions: ["Show product listings by month."],
      },
      allowed_actions: state === "candidate" ? ["attest", "ignore"] : [],
    });
    const candidateEntry = untranslatedEntry("published_at", "candidate");
    const adoptedEntry = untranslatedEntry("archived_at", "confirmed");
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/api/v1/projects/project-1") {
        return { data: { data: { id: "project-1", name: "商品分析" } } } as never;
      }
      if (url === "/api/v1/projects/project-1/sources") {
        return { data: { data: [] } } as never;
      }
      if (url === "/api/v1/projects/project-1/semantic-scopes") {
        return { data: { data: [] } } as never;
      }
      return {
        data: {
          data: {
            items: [candidateEntry, adoptedEntry],
            total: 2,
            offset: 0,
            limit: 50,
            has_more: false,
            next_offset: null,
          },
        },
      } as never;
    });

    render(<ProjectUnderstandingWorkspace projectId="project-1" />);

    expect((await screen.findAllByText("发布时间")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("ARCHIVED AT").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("名称和业务含义待核对。").length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText("名称和业务含义尚未补充。").length
    ).toBeGreaterThan(0);
    expect(
      screen.queryByText("Timestamp used to group product listings by reporting period.")
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Show product listings by month.")).not.toBeInTheDocument();

    const adoptedSummary = screen
      .getAllByText("名称和业务含义尚未补充。")
      .find((element) => element.closest("tr"));
    expect(adoptedSummary).toBeDefined();
    fireEvent.click(adoptedSummary?.closest("tr") as HTMLElement);
    const details = screen.getByTestId("semantic-detail-panel");
    expect(
      within(details).getByText("名称和业务含义尚未补充。")
    ).toBeInTheDocument();
    expect(
      within(details).queryByText(
        "Timestamp used to group product listings by reporting period."
      )
    ).not.toBeInTheDocument();
    expect(within(details).queryByText("Show product listings by month.")).not.toBeInTheDocument();
  });

  it("shows applicable data separately from how a definition was added", async () => {
    const rule: SemanticEntry = {
      ...candidate("remote-rule", "orders", "stores"),
      key: "rule:recognized_revenue",
      value: "只统计已审核订单",
      entry_type: "business_rule",
      definition: null,
      source_scope: "remote_database",
      source_refs: [
        {
          source_id: "remote-db",
          logical_name: "线上订单库",
          name: "线上订单库",
          kind: "connection",
          format: "postgresql",
        },
      ],
      source: "user",
    };
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/api/v1/projects/project-1") {
        return { data: { data: { id: "project-1", name: "财务分析" } } } as never;
      }
      if (url === "/api/v1/projects/project-1/sources") {
        return { data: { data: [] } } as never;
      }
      return {
        data: {
          data: {
            items: [rule],
            total: 1,
            offset: 0,
            limit: 50,
            has_more: false,
            next_offset: null,
          },
        },
      } as never;
    });

    render(<ProjectUnderstandingWorkspace projectId="project-1" />);

    expect((await screen.findAllByText("财务分析")).length).toBeGreaterThan(0);
    const details = screen.getByTestId("semantic-detail-panel");
    expect(within(details).getByText("全部定义")).toBeInTheDocument();
    expect(within(details).queryByText(/remote-db/)).not.toBeInTheDocument();
    expect(within(details).queryByText("添加方式")).not.toBeInTheDocument();
    expect(within(details).queryByText("技术标识")).not.toBeInTheDocument();
  });

  it("starts table organization explicitly, reviews its batch, and declines one suggestion", async () => {
    const governanceSource: ProjectDataSource = {
      ...projectSource("db-ready", "经营库", "connection", "postgresql"),
      profile_data: {
        logical_name: "经营库",
        tables: [
          { name: "orders", columns: [{ name: "amount", type: "numeric" }] },
          { name: "refunds", columns: [{ name: "amount", type: "numeric" }] },
        ],
      },
    };
    const suggestion: SemanticEntry = {
      ...candidate("ai-sales", "orders", "stores"),
      key: "metric_candidate:db-ready:amount",
      value: "订单金额合计",
      entry_type: "metric",
      definition: {
        version: 1,
        kind: "aggregate_metric",
        operation: "sum",
        source: {
          source_logical_name: "经营库",
          source_kind: "connection",
          table_or_view: "orders",
          action_column: "amount",
          canonical_type: "number",
          schema_signature: "a".repeat(64),
        },
        null_policy: "ignore",
        business_name: "销售额",
        description: "订单金额的合计",
        example_questions: ["本月销售额是多少？"],
      },
      allowed_actions: ["queue_validation", "ignore"],
    };
    const tablePurpose: SemanticEntry = {
      ...candidate("ai-table-purpose", "orders", "orders"),
      key: "scope_presentation:db-ready:orders",
      value: "记录订单经营明细",
      entry_type: "scope_presentation",
      definition: {
        version: 1,
        kind: "scope_presentation",
        scope_kind: "table",
        source_logical_name: "经营库",
        source_kind: "connection",
        table_or_view: "orders",
        business_name: "订单明细",
        description: "记录订单经营明细",
        synonyms: ["订单表"],
        example_questions: [],
      },
      allowed_actions: ["attest", "ignore"],
    };
    const orderDate: SemanticEntry = {
      ...candidate("ai-order-date", "orders", "orders"),
      key: "dimension:db-ready:order_date",
      value: "订单发生日期",
      entry_type: "dimension",
      definition: {
        version: 1,
        kind: "dimension",
        role: "time",
        source: {
          source_logical_name: "经营库",
          source_kind: "connection",
          table_or_view: "orders",
          action_column: "order_date",
          canonical_type: "datetime",
          schema_signature: "a".repeat(64),
        },
        business_name: "order date",
        description: "订单发生日期",
        synonyms: ["订单时间"],
        example_questions: [],
      },
      allowed_actions: ["attest", "ignore"],
    };
    const dataRelationship = candidate("ai-relationship", "orders", "stores");
    const batchSuggestions = [dataRelationship, suggestion, orderDate, tablePurpose];
    const completedInventoryJob: SemanticInventoryJob = {
      id: "inventory-job-1",
      project_id: "project-1",
      source_id: "db-ready",
      status: "completed",
      depth: "structure",
      locale: "zh",
      tables: ["orders"],
      progress: {
        total: 1,
        queued: 0,
        running: 0,
        succeeded: 1,
        failed: 0,
        cancelled: 0,
      },
      items: [
        {
          id: "inventory-item-1",
          table: "orders",
          status: "succeeded",
          phase: "complete",
          attempt_count: 1,
          retryable: false,
          recommendation_batch_id: "batch-ai-1",
          candidate_count: batchSuggestions.length,
        },
      ],
      created_at: "2026-07-22T00:00:00Z",
      completed_at: "2026-07-22T00:00:01Z",
    };
    const get = vi.spyOn(api, "get").mockImplementation(async (url, config) => {
      if (url === "/api/v1/projects/project-1") {
        return { data: { data: { id: "project-1", name: "财务分析" } } } as never;
      }
      if (url === "/api/v1/projects/project-1/sources") {
        return { data: { data: [governanceSource] } } as never;
      }
      const params = (config as { params?: Record<string, unknown> } | undefined)?.params;
      const filtered = params?.recommendation_batch_id === "batch-ai-1";
      return {
        data: {
          data: {
            items: filtered ? batchSuggestions : [],
            total: filtered ? batchSuggestions.length : 0,
            offset: 0,
            limit: 50,
            has_more: false,
            next_offset: null,
          },
        },
      } as never;
    });
    const post = vi.spyOn(api, "post").mockImplementation(async (url) => {
      if (url.endsWith("/sources/db-ready/relation-index")) {
        return {
          data: {
            data: {
              source_id: "db-ready",
              relation_index: {
                relations: [
                  { name: "orders", kind: "table", comment: "订单" },
                  { name: "refunds", kind: "table", comment: "退款" },
                ],
                relations_loaded: 2,
                relations_total: 2,
                relations_total_at_least: 2,
                complete: true,
                truncated: false,
                unread_relations_at_least: 0,
              },
              semantic_scope_table_count: 2,
            },
          },
        } as never;
      }
      if (url.endsWith("/sources/db-ready/semantic-inventory-jobs")) {
        return {
          data: { data: completedInventoryJob },
        } as never;
      }
      return {
        data: {
          data: {
            action: "ignore",
            items: [{ ...suggestion, is_active: false, validity: "stale", active_revision_id: "ignored-suggestion", revision_number: 2 }],
            queued_entry_ids: [],
          },
        },
      } as never;
    });

    render(<ProjectUnderstandingWorkspace projectId="project-1" />);
    await screen.findByText("共 0 条");
    expect(post).not.toHaveBeenCalled();
    const governanceButton = screen.getByRole("button", {
      name: "智能整理项目理解",
    });
    fireEvent.click(governanceButton);
    await screen.findByText("数据库 · 2 张表");
    await waitFor(() => {
      expect(
        get.mock.calls.filter(([url]) => url === "/api/v1/projects/project-1/sources")
      ).toHaveLength(2);
      expect(
        get.mock.calls.filter(
          ([url]) => url === "/api/v1/projects/project-1/semantic-scopes"
        )
      ).toHaveLength(2);
    });
    expect(
      post.mock.calls.filter(([url]) => url.endsWith("/knowledge/recommendations"))
    ).toHaveLength(0);
    fireEvent.click(await screen.findByLabelText("选择数据来源 经营库"));
    fireEvent.click(screen.getByLabelText("选择表 · 深入整理"));
    fireEvent.click(screen.getByLabelText("选择 经营库 中的表 订单"));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "智能整理项目理解" })).getByRole(
        "button",
        { name: "开始整理" }
      )
    );

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/api/v1/projects/project-1/sources/db-ready/semantic-inventory-jobs",
        { locale: "zh", tables: ["orders"], depth: "structure" }
      )
    );
    await waitFor(() => expect(governanceButton).toHaveFocus());
    expect(
      screen.getByRole("status", { name: "经营库 的整理进度" })
    ).toHaveTextContent("表用途和关联已整理");
    fireEvent.click(screen.getByRole("button", { name: "审阅结果" }));
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(
        "/api/v1/projects/project-1/knowledge/page",
        expect.objectContaining({
          params: expect.objectContaining({
            recommendation_batch_id: "batch-ai-1",
            state: "candidate",
          }),
        })
      )
    );
    const batchRequest = get.mock.calls.find(
      ([url, config]) =>
        url === "/api/v1/projects/project-1/knowledge/page" &&
        (config as { params?: Record<string, unknown> } | undefined)?.params
          ?.recommendation_batch_id === "batch-ai-1"
    );
    expect(
      (batchRequest?.[1] as { params?: Record<string, unknown> } | undefined)?.params
    ).not.toHaveProperty("entry_type");
    expect(screen.getByTestId("recommendation-batch-filter")).toHaveTextContent(
      "本次整理结果"
    );
    expect(screen.getByTestId("recommendation-batch-filter")).toHaveTextContent(
      "已补充业务名称、用途和可用定义"
    );
    expect(screen.getAllByText("业务名称待确认").length).toBeGreaterThan(0);
    expect(screen.queryByText("order date")).not.toBeInTheDocument();
    expect((await screen.findAllByText("销售额")).length).toBeGreaterThan(0);
    const recommendationCards = Array.from(
      screen.getByTestId("semantic-table-list").querySelectorAll("tbody tr")
    ).map((card) => card.textContent || "");
    expect(recommendationCards.some((card) => card.includes("字段中文化与维度"))).toBe(
      true
    );
    expect(recommendationCards.some((card) => card.includes("指标"))).toBe(true);
    expect(recommendationCards.some((card) => card.includes("关系"))).toBe(true);
    expect(screen.getByRole("treeitem", { name: /订单资料/ })).toHaveAttribute(
      "aria-current",
      "page"
    );

    fireEvent.click(screen.getByRole("row", { name: /销售额/ }));
    expect(screen.getAllByText("订单金额的合计").length).toBeGreaterThan(0);
    expect(screen.getAllByText("本月销售额是多少？").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "不采用" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/api/v1/projects/project-1/knowledge/batch",
        {
          action: "ignore",
          items: [
            {
              entry_id: suggestion.id,
              expected_active_revision_id: suggestion.active_revision_id,
            },
          ],
        }
      )
    );

    const pageCallsBeforeScopeChange = get.mock.calls.length;
    fireEvent.click(screen.getByRole("treeitem", { name: /经营库/ }));
    await waitFor(() =>
      expect(get.mock.calls.length).toBeGreaterThan(pageCallsBeforeScopeChange)
    );
    expect(screen.queryByTestId("recommendation-batch-filter")).not.toBeInTheDocument();
    const [, allDefinitionsConfig] = get.mock.calls.at(-1) || [];
    expect(
      (allDefinitionsConfig as { params?: Record<string, unknown> } | undefined)?.params
    ).not.toHaveProperty("recommendation_batch_id");
  });

  it("resumes database organization, polls table progress, and retries only failures", async () => {
    const database: ProjectDataSource = {
      ...projectSource("db-ready", "经营库", "connection", "postgresql"),
      profile_data: {
        logical_name: "经营库",
        tables: [
          { name: "public.orders", columns: [{ name: "id", type: "integer" }] },
          { name: "private.ledger", columns: [{ name: "id", type: "integer" }] },
        ],
      },
    };
    const runningJob: SemanticInventoryJob = {
      id: "inventory-resume-1",
      project_id: "project-1",
      source_id: "db-ready",
      status: "running",
      depth: "structure",
      locale: "zh",
      tables: [],
      progress: {
        total: 2,
        queued: 1,
        running: 1,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
      },
      items: [
        {
          id: "running-orders",
          table: "public.orders",
          status: "running",
          phase: "recommend",
          attempt_count: 1,
          retryable: true,
          candidate_count: 0,
        },
        {
          id: "queued-ledger",
          table: "private.ledger",
          status: "queued",
          phase: "structure",
          attempt_count: 0,
          retryable: true,
          candidate_count: 0,
        },
      ],
      created_at: "2026-07-22T00:00:00Z",
      started_at: "2026-07-22T00:00:00Z",
    };
    const partialJob: SemanticInventoryJob = {
      ...runningJob,
      status: "completed_with_errors",
      progress: {
        total: 2,
        queued: 0,
        running: 0,
        succeeded: 1,
        failed: 1,
        cancelled: 0,
      },
      items: [
        {
          ...runningJob.items[0],
          status: "succeeded",
          phase: "complete",
          retryable: false,
          recommendation_batch_id: "batch-orders",
          candidate_count: 3,
        },
        {
          ...runningJob.items[1],
          status: "failed",
          attempt_count: 1,
          code: "inventory_permission_denied",
          message: "permission denied on schema private",
        },
      ],
      completed_at: "2026-07-22T00:00:02Z",
    };
    const retriedJob: SemanticInventoryJob = {
      ...partialJob,
      status: "queued",
      progress: {
        total: 2,
        queued: 1,
        running: 0,
        succeeded: 1,
        failed: 0,
        cancelled: 0,
      },
      items: [
        partialJob.items[0],
        {
          ...partialJob.items[1],
          status: "queued",
          phase: "structure",
          code: null,
          message: null,
        },
      ],
      completed_at: null,
    };

    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/api/v1/projects/project-1") {
        return { data: { data: { id: "project-1", name: "财务分析" } } } as never;
      }
      if (url === "/api/v1/projects/project-1/sources") {
        return { data: { data: [database] } } as never;
      }
      if (url === "/api/v1/projects/project-1/semantic-scopes") {
        return { data: { data: [] } } as never;
      }
      if (url.endsWith("/semantic-inventory-jobs/current")) {
        return { data: { data: runningJob } } as never;
      }
      if (url.endsWith("/semantic-inventory-jobs/inventory-resume-1")) {
        return { data: { data: partialJob } } as never;
      }
      return {
        data: {
          data: {
            items: [],
            total: 0,
            offset: 0,
            limit: 50,
            has_more: false,
            next_offset: null,
          },
        },
      } as never;
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({
      data: { data: retriedJob },
    } as never);

    render(<ProjectUnderstandingWorkspace projectId="project-1" />);

    expect(
      await screen.findByRole("status", { name: "经营库 的整理进度" })
    ).toHaveTextContent("正在整理");
    expect(
      await screen.findByText("1 张表需要重试：private.ledger", undefined, {
        timeout: 2500,
      })
    ).toBeInTheDocument();
    expect(screen.queryByText("permission denied on schema private")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试未完成的表" }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/api/v1/projects/project-1/sources/db-ready/semantic-inventory-jobs/inventory-resume-1/retry"
      )
    );
  });

  it("shows a recoverable status when the saved database run is temporarily unavailable", async () => {
    const database = projectSource(
      "db-ready",
      "经营库",
      "connection",
      "postgresql"
    );
    const queuedJob: SemanticInventoryJob = {
      id: "inventory-restored",
      project_id: "project-1",
      source_id: "db-ready",
      status: "queued",
      depth: "structure",
      locale: "zh",
      tables: ["orders"],
      progress: {
        total: 1,
        queued: 1,
        running: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
      },
      items: [
        {
          id: "inventory-restored-item",
          table: "orders",
          status: "queued",
          phase: "structure",
          attempt_count: 0,
          retryable: true,
          candidate_count: 0,
        },
      ],
      created_at: "2026-07-22T00:00:00Z",
    };
    let restoreAttempts = 0;
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/api/v1/projects/project-1") {
        return { data: { data: { id: "project-1", name: "财务分析" } } } as never;
      }
      if (url === "/api/v1/projects/project-1/sources") {
        return { data: { data: [database] } } as never;
      }
      if (url === "/api/v1/projects/project-1/semantic-scopes") {
        return { data: { data: [] } } as never;
      }
      if (url.endsWith("/semantic-inventory-jobs/current")) {
        restoreAttempts += 1;
        if (restoreAttempts === 1) throw new Error("temporary failure");
        return { data: { data: queuedJob } } as never;
      }
      return {
        data: {
          data: {
            items: [],
            total: 0,
            offset: 0,
            limit: 50,
            has_more: false,
            next_offset: null,
          },
        },
      } as never;
    });

    render(<ProjectUnderstandingWorkspace projectId="project-1" />);

    const unavailable = await screen.findByRole("status", {
      name: "经营库 的整理进度",
    });
    expect(unavailable).toHaveTextContent("暂时无法读取整理进度");
    fireEvent.click(within(unavailable).getByRole("button", { name: "重新读取" }));

    await waitFor(() => expect(restoreAttempts).toBe(2));
    expect(
      await screen.findByRole("status", { name: "经营库 的整理进度" })
    ).toHaveTextContent("等待整理");
  });

  it("renders a derived metric as business copy and a human formula instead of JSON", async () => {
    const derivedMetric: SemanticEntry = {
      ...candidate("gross-profit", "orders", "stores"),
      key: "derived_metric:gross_profit",
      value: "销售额减成本后逐行汇总",
      entry_type: "metric",
      definition: {
        version: 1,
        kind: "derived_metric",
        aggregate: "sum",
        business_name: "毛利",
        description:
          "逐行按 sales_amount − cost_amount 计算，公式由系统固定生成。",
        example_questions: ["本月毛利是多少？"],
        formula: {
          kind: "metric_formula",
          output_column: "gross_profit",
          expression: {
            op: "subtract",
            left: { op: "column", name: "sales_amount" },
            right: { op: "column", name: "cost_amount" },
          },
          evaluation_order: "row_then_aggregate",
          null_policy: "propagate",
          divide_by_zero: "error",
        },
        sources: [
          {
            source_logical_name: "经营库",
            source_kind: "connection",
            table_or_view: "orders",
            action_column: "sales_amount",
            canonical_type: "number",
            schema_signature: "a".repeat(64),
          },
          {
            source_logical_name: "经营库",
            source_kind: "connection",
            table_or_view: "orders",
            action_column: "cost_amount",
            canonical_type: "number",
            schema_signature: "a".repeat(64),
          },
        ],
      },
      allowed_actions: ["queue_validation", "ignore"],
    };
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/api/v1/projects/project-1") {
        return { data: { data: { id: "project-1", name: "财务分析" } } } as never;
      }
      if (url === "/api/v1/projects/project-1/sources") {
        return { data: { data: [] } } as never;
      }
      return {
        data: {
          data: {
            items: [derivedMetric],
            total: 1,
            offset: 0,
            limit: 50,
            has_more: false,
            next_offset: null,
          },
        },
      } as never;
    });
    const put = vi.spyOn(api, "put").mockResolvedValue({
      data: { data: { ...derivedMetric, source: "user" } },
    } as never);

    render(<ProjectUnderstandingWorkspace projectId="project-1" />);

    expect((await screen.findAllByText("毛利")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("销售额减成本后逐行汇总").length).toBeGreaterThan(0);
    expect(
      screen.queryByText("逐行按 sales_amount − cost_amount 计算，公式由系统固定生成。")
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("本月毛利是多少？").length).toBeGreaterThan(0);
    expect(screen.getAllByText("销售额 − 成本").length).toBeGreaterThan(0);
    expect(screen.queryByText("来源字段 / 技术绑定")).not.toBeInTheDocument();
    expect(screen.queryByText("经营库.orders.sales_amount")).not.toBeInTheDocument();
    expect(screen.queryByText(/"op"\s*:/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(
      screen.queryByText("这类组合指标会保留原公式；这里只维护业务名称、说明和所属层级。")
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("扩展定义")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        `/api/v1/projects/project-1/knowledge/${derivedMetric.id}`,
        expect.objectContaining({
          entry_type: "metric",
          definition: expect.objectContaining({ kind: "derived_metric" }),
        })
      )
    );
  });

  it("offers validation in bulk without offering unsafe candidate approval", async () => {
    const first = { ...candidate("one", "orders", "stores"), is_active: true };
    const second = { ...candidate("two", "refunds", "stores"), is_active: true };
    let resolveValidationJob: ((value: unknown) => void) | null = null;
    let queued = false;
    const get = vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/api/v1/projects/project-1") {
        return { data: { data: { id: "project-1", name: "财务分析" } } } as never;
      }
      if (url === "/api/v1/projects/project-1/sources") {
        return { data: { data: [] } } as never;
      }
      if (
        url ===
        "/api/v1/projects/project-1/knowledge/validation-jobs/validation-job-1"
      ) {
        return await new Promise((resolve) => {
          resolveValidationJob = resolve;
        });
      }
      return {
        data: {
          data: {
            items: queued
              ? [first, second].map((entry) => ({ ...entry, allowed_actions: [] }))
              : [first, second],
            total: 792,
            offset: 0,
            limit: 50,
            has_more: true,
            next_offset: 50,
          },
        },
      } as never;
    });
    const post = vi.spyOn(api, "post").mockImplementation(async () => {
      queued = true;
      return {
        data: {
          data: {
            action: "queue_validation",
            items: [first, second].map((entry) => ({ ...entry, allowed_actions: [] })),
            queued_entry_ids: [first.id, second.id],
            validation_job_id: "validation-job-1",
            validation_status: "queued",
          },
        },
      } as never;
    });

    render(<ProjectUnderstandingWorkspace projectId="project-1" />);
    await screen.findByText("共 792 条");

    fireEvent.click(screen.getByLabelText("选择本页"));
    fireEvent.click(screen.getByRole("button", { name: "查看并处理" }));
    const selection = within(screen.getByRole("dialog", { name: "已选清单" }));
    const validate = selection.getByRole("radio", { name: "验证" });
    const remember = selection.getByRole("radio", { name: "采纳" });
    expect(validate).toBeEnabled();
    expect(remember).toBeDisabled();

    await act(async () => fireEvent.click(validate));
    expect(post).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(selection.getByRole("button", { name: "验证 2 条" })));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/api/v1/projects/project-1/knowledge/batch",
        expect.objectContaining({
          action: "queue_validation",
          items: [
            { entry_id: first.id, expected_active_revision_id: first.active_revision_id },
            { entry_id: second.id, expected_active_revision_id: second.active_revision_id },
          ],
        })
      )
    );
    expect(window.sessionStorage.getItem("receiptbi-pending-task")).toBeNull();
    expect(screen.getByRole("heading", { name: "项目理解" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "系统验证进度" })).toHaveTextContent(
      "系统验证已排队"
    );
    expect(screen.getByRole("button", { name: "验证" })).toBeDisabled();
    const details = within(
      screen.getByTestId("semantic-detail-panel")
    );
    expect(details.getByRole("button", { name: "验证" })).toBeDisabled();
    expect(details.getByRole("button", { name: "编辑" })).toBeDisabled();

    await act(async () => {
      resolveValidationJob?.({
        data: {
          data: {
            id: "validation-job-1",
            project_id: "project-1",
            status: "completed",
            progress: {
              total: 2,
              queued: 0,
              running: 0,
              verified: 2,
              blocked: 0,
              failed: 0,
            },
            items: [first, second].map((entry) => ({
              id: `job-item-${entry.id}`,
              entry_id: entry.id,
              semantic_revision_id: String(entry.active_revision_id),
              definition_hash: "a".repeat(64),
              status: "verified",
            })),
            created_at: "2026-07-22T00:00:00Z",
            completed_at: "2026-07-22T00:00:01Z",
          },
        },
      });
    });
    expect(await screen.findByText("系统验证已完成")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith(
      "/api/v1/projects/project-1/knowledge/validation-jobs/validation-job-1"
    );
  });

  it("keeps validation transport details out of the workspace", async () => {
    const entry = candidate("poll-failure", "orders", "stores");
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/api/v1/projects/project-1") {
        return { data: { data: { id: "project-1", name: "财务分析" } } } as never;
      }
      if (url === "/api/v1/projects/project-1/sources") {
        return { data: { data: [] } } as never;
      }
      if (
        url ===
        "/api/v1/projects/project-1/knowledge/validation-jobs/validation-job-failure"
      ) {
        throw {
          isAxiosError: true,
          response: {
            status: 503,
            data: { detail: "internal validation worker unavailable" },
          },
        };
      }
      return {
        data: {
          data: {
            items: [entry],
            total: 1,
            offset: 0,
            limit: 50,
            has_more: false,
            next_offset: null,
          },
        },
      } as never;
    });
    vi.spyOn(api, "post").mockResolvedValue({
      data: {
        data: {
          action: "queue_validation",
          items: [{ ...entry, allowed_actions: [] }],
          queued_entry_ids: [entry.id],
          validation_job_id: "validation-job-failure",
          validation_status: "queued",
        },
      },
    } as never);

    render(<ProjectUnderstandingWorkspace projectId="project-1" />);
    await screen.findByText("共 1 条");
    fireEvent.click(screen.getByRole("button", { name: "验证" }));

    expect(await screen.findByText("暂时无法读取验证进度。")).toBeInTheDocument();
    expect(
      screen.queryByText(/HTTP 503|internal validation worker unavailable/)
    ).not.toBeInTheDocument();
  });

  it("recovers a long-running validation job, keeps polling on 409, and follows a replacement id", async () => {
    const entry = candidate("recover", "orders", "stores");
    let now = 0;
    const validationPolls: Array<() => void> = [];
    const nativeSetTimeout = globalThis.setTimeout;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.spyOn(globalThis, "setTimeout").mockImplementation(
      ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        if (timeout === 800 && typeof handler === "function") {
          validationPolls.push(() => handler(...args));
          return 1;
        }
        return nativeSetTimeout(handler, timeout, ...args);
      }) as typeof setTimeout
    );

    const job = (
      id: string,
      status: SemanticValidationJob["status"]
    ): SemanticValidationJob => ({
      id,
      project_id: "project-1",
      status,
      progress: {
        total: 1,
        queued: status === "queued" ? 1 : 0,
        running: status === "running" ? 1 : 0,
        verified: status === "completed" ? 1 : 0,
        blocked: 0,
        failed: 0,
      },
      items: [
        {
          id: `item-${id}`,
          entry_id: entry.id,
          semantic_revision_id: String(entry.active_revision_id),
          definition_hash: "a".repeat(64),
          status:
            status === "queued"
              ? "queued"
              : status === "running"
                ? "running"
                : "verified",
        },
      ],
      created_at: "2026-07-22T00:00:00Z",
      completed_at: status === "completed" ? "2026-07-22T00:00:01Z" : null,
    });

    const get = vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/api/v1/projects/project-1") {
        return { data: { data: { id: "project-1", name: "财务分析" } } } as never;
      }
      if (url === "/api/v1/projects/project-1/sources") {
        return { data: { data: [] } } as never;
      }
      if (
        url ===
        "/api/v1/projects/project-1/knowledge/validation-jobs/validation-job-old"
      ) {
        return { data: { data: job("validation-job-old", "running") } } as never;
      }
      if (
        url ===
        "/api/v1/projects/project-1/knowledge/validation-jobs/validation-job-new"
      ) {
        return { data: { data: job("validation-job-new", "completed") } } as never;
      }
      return {
        data: {
          data: {
            items: [entry],
            total: 1,
            offset: 0,
            limit: 50,
            has_more: false,
            next_offset: null,
          },
        },
      } as never;
    });
    let recoveryAttempts = 0;
    const post = vi.spyOn(api, "post").mockImplementation(async (url) => {
      if (
        url ===
        "/api/v1/projects/project-1/knowledge/validation-jobs/validation-job-old/retry"
      ) {
        recoveryAttempts += 1;
        if (recoveryAttempts === 1) {
          throw {
            isAxiosError: true,
            response: {
              status: 409,
              data: {
                detail: {
                  code: "semantic_validation_job_active",
                  details: { lease_expires_at: "internal-only" },
                },
              },
            },
          };
        }
        return { data: { data: job("validation-job-new", "queued") } } as never;
      }
      return {
        data: {
          data: {
            action: "queue_validation",
            items: [{ ...entry, allowed_actions: [] }],
            queued_entry_ids: [entry.id],
            validation_job_id: "validation-job-old",
            validation_status: "queued",
          },
        },
      } as never;
    });

    render(<ProjectUnderstandingWorkspace projectId="project-1" />);
    await screen.findByText("共 1 条");
    fireEvent.click(screen.getByRole("button", { name: "验证" }));
    await waitFor(() => expect(validationPolls).toHaveLength(1));

    now = 35_000;
    await act(async () => validationPolls.shift()?.());
    await waitFor(() => expect(recoveryAttempts).toBe(1));
    expect(screen.getByRole("status", { name: "系统验证进度" })).toHaveTextContent(
      "正在用真实数据做系统验证"
    );
    expect(screen.queryByText(/HTTP 409|internal-only/)).not.toBeInTheDocument();
    expect(validationPolls).toHaveLength(1);

    now = 70_000;
    await act(async () => validationPolls.shift()?.());
    expect(await screen.findByText("系统验证已完成")).toBeInTheDocument();
    expect(recoveryAttempts).toBe(2);
    expect(post).toHaveBeenCalledWith(
      "/api/v1/projects/project-1/knowledge/validation-jobs/validation-job-old/retry"
    );
    expect(get).toHaveBeenCalledWith(
      "/api/v1/projects/project-1/knowledge/validation-jobs/validation-job-new"
    );
  });

  it("localizes a blocked validation code and keeps edit/manual review available", async () => {
    const blockedCandidate: SemanticEntry = {
      ...candidate("blocked", "orders", "stores"),
      allowed_actions: ["queue_validation", "ignore", "attest"],
      execution_details: {
        code: "metric_binding_not_numeric",
        summary: "后端返回的中文验证说明",
      },
    };
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/api/v1/projects/project-1") {
        return { data: { data: { id: "project-1", name: "Finance" } } } as never;
      }
      if (url === "/api/v1/projects/project-1/sources") {
        return { data: { data: [] } } as never;
      }
      if (
        url ===
        "/api/v1/projects/project-1/knowledge/validation-jobs/validation-job-blocked"
      ) {
        return {
          data: {
            data: {
              id: "validation-job-blocked",
              project_id: "project-1",
              status: "completed",
              progress: {
                total: 1,
                queued: 0,
                running: 0,
                verified: 0,
                blocked: 1,
                failed: 0,
              },
              items: [
                {
                  id: "blocked-item",
                  entry_id: blockedCandidate.id,
                  semantic_revision_id: blockedCandidate.active_revision_id,
                  definition_hash: "a".repeat(64),
                  status: "blocked",
                  code: "metric_binding_not_numeric",
                  details: { message: "指标字段不是数值字段" },
                },
              ],
              created_at: "2026-07-22T00:00:00Z",
              completed_at: "2026-07-22T00:00:01Z",
            },
          },
        } as never;
      }
      return {
        data: {
          data: {
            items: [blockedCandidate],
            total: 1,
            offset: 0,
            limit: 50,
            has_more: false,
            next_offset: null,
          },
        },
      } as never;
    });
    vi.spyOn(api, "post").mockResolvedValue({
      data: {
        data: {
          action: "queue_validation",
          items: [blockedCandidate],
          queued_entry_ids: [blockedCandidate.id],
          validation_job_id: "validation-job-blocked",
          validation_status: "queued",
        },
      },
    } as never);

    render(<ProjectUnderstandingWorkspace projectId="project-1" />, "en");
    await screen.findByText("1 item");
    fireEvent.click(screen.getByRole("button", { name: "Validate" }));

    expect(
      await screen.findByText("More information is needed")
    ).toBeInTheDocument();
    expect(screen.queryByText("指标字段不是数值字段")).not.toBeInTheDocument();
    expect(screen.queryByText("后端返回的中文验证说明")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Manual review" })).toBeEnabled();
  });

  it("opens details from the whole row or arrow while checkboxes only batch-select", async () => {
    const first = candidate("one", "orders", "stores");
    const second = candidate("two", "refunds", "stores");
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/api/v1/projects/project-1") {
        return { data: { data: { id: "project-1", name: "财务分析" } } } as never;
      }
      if (url === "/api/v1/projects/project-1/sources") {
        return { data: { data: [] } } as never;
      }
      return {
        data: {
          data: {
            items: [first, second],
            total: 2,
            offset: 0,
            limit: 50,
            has_more: false,
            next_offset: null,
          },
        },
      } as never;
    });

    render(<ProjectUnderstandingWorkspace projectId="project-1" />);
    await screen.findByText("共 2 条");

    const firstRow = screen.getByRole("row", { name: /门店关联 one/ });
    const secondRow = screen.getByRole("row", { name: /门店关联 two/ });
    expect(firstRow).toHaveAttribute("aria-selected", "true");
    expect(secondRow).toHaveAttribute("aria-selected", "false");

    fireEvent.click(screen.getByLabelText("选择 门店关联 two"));
    expect(firstRow).toHaveAttribute("aria-selected", "true");
    expect(secondRow).toHaveAttribute("aria-selected", "false");
    expect(screen.getByText("已选 1 条")).toBeInTheDocument();

    fireEvent.click(secondRow);
    expect(secondRow).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("complementary", { name: "门店关联 two" })
    ).toBeVisible();

    fireEvent.click(within(firstRow).getByRole("button", { name: "查看 门店关联 one" }));
    expect(firstRow).toHaveAttribute("aria-selected", "true");
  });

  it("keeps the desktop tree, single table and inspector independent of viewport mode", async () => {
    const first = candidate("one", "orders", "stores");
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/api/v1/projects/project-1") {
        return { data: { data: { id: "project-1", name: "财务分析" } } } as never;
      }
      if (url === "/api/v1/projects/project-1/sources") {
        return { data: { data: [] } } as never;
      }
      return {
        data: {
          data: {
            items: [first],
            total: 1,
            offset: 0,
            limit: 50,
            has_more: false,
            next_offset: null,
          },
        },
      } as never;
    });

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 940 });
    mockSemanticWidth(false);
    const { container } = render(
      <ProjectUnderstandingWorkspace projectId="project-1" />
    );
    await screen.findByText("共 1 条");

    expect(container.firstElementChild).toHaveClass("h-dvh", "overflow-hidden");
    expect(screen.getByRole("region", { name: "项目理解列表" })).toHaveClass(
      "overflow-hidden"
    );
    expect(screen.getByTestId("semantic-detail-panel")).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("semantic-browser-layout")).toHaveClass("grid-cols-[200px_minmax(0,1fr)_320px]");
    expect(screen.getByTestId("semantic-scope-tree")).toBeVisible();
    expect(screen.getByTestId("semantic-table-list")).toBeVisible();
    expect(screen.queryByTestId("semantic-card-list")).not.toBeInTheDocument();
  });

  it("uses server-authorized actions for mixed candidate states", async () => {
    const verified: SemanticEntry = {
      ...candidate("verified", "orders", "stores"),
      validity: "active",
      execution_state: "verified",
      allowed_actions: ["ignore", "remember"],
    };
    const definitionMissing: SemanticEntry = {
      ...candidate("missing", "refunds", "stores"),
      definition: null,
      allowed_actions: ["ignore"],
    };
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/api/v1/projects/project-1") {
        return { data: { data: { id: "project-1", name: "财务分析" } } } as never;
      }
      if (url === "/api/v1/projects/project-1/sources") {
        return { data: { data: [] } } as never;
      }
      return {
        data: {
          data: {
            items: [verified, definitionMissing],
            total: 2,
            offset: 0,
            limit: 50,
            has_more: false,
            next_offset: null,
          },
        },
      } as never;
    });

    render(<ProjectUnderstandingWorkspace projectId="project-1" />);
    await screen.findByText("共 2 条");

    expect(screen.getByLabelText("搜索项目理解")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /筛选/ })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(screen.queryByRole("button", { name: "系统验证" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "采纳" })).toBeInTheDocument();
    expect(screen.queryByText("用于后续调查")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("选择本页"));
    fireEvent.click(screen.getByRole("button", { name: "查看并处理" }));
    const selection = within(screen.getByRole("dialog", { name: "已选清单" }));
    expect(selection.getByRole("radio", { name: "采纳" })).toBeDisabled();
    expect(selection.getByRole("radio", { name: "忽略" })).toBeEnabled();
  });

  it("keeps manual attestation distinct from remembering and refreshes project state", async () => {
    const attestable: SemanticEntry = {
      ...candidate("attestable", "orders", "stores"),
      allowed_actions: ["attest"],
    };
    const refreshCurrent = vi
      .spyOn(useProjectStore.getState(), "refreshCurrent")
      .mockResolvedValue();
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/api/v1/projects/project-1") {
        return { data: { data: { id: "project-1", name: "财务分析" } } } as never;
      }
      if (url === "/api/v1/projects/project-1/sources") {
        return { data: { data: [] } } as never;
      }
      return {
        data: {
          data: {
            items: [attestable],
            total: 1,
            offset: 0,
            limit: 50,
            has_more: false,
            next_offset: null,
          },
        },
      } as never;
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({
      data: {
        data: {
          action: "attest",
          items: [
            {
              ...attestable,
              active_revision_id: "attested-head",
              revision_number: 2,
              execution_state: "verified",
              validity: "active",
              allowed_actions: ["remember"],
            },
          ],
          queued_entry_ids: [],
        },
      },
    } as never);

    render(<ProjectUnderstandingWorkspace projectId="project-1" />);
    await screen.findByText("共 1 条");
    fireEvent.click(screen.getByRole("button", { name: "人工核对" }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/api/v1/projects/project-1/knowledge/batch",
        {
          action: "attest",
          items: [
            {
              entry_id: attestable.id,
              expected_active_revision_id: attestable.active_revision_id,
            },
          ],
        }
      )
    );
    expect(refreshCurrent).toHaveBeenCalledTimes(1);
    expect(
      await within(screen.getByRole("region", { name: zhMessages.projectUnderstanding.list.aria })).findByText(/采用后即可用于后续调查/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/^已记住 1 条/)).not.toBeInTheDocument();
  });

  it("restores an ignored candidate against its visible revision", async () => {
    const ignored: SemanticEntry = {
      ...candidate("ignored", "orders", "stores"),
      is_active: false,
      validity: "stale",
      allowed_actions: ["restore"],
    };
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/api/v1/projects/project-1") {
        return { data: { data: { id: "project-1", name: "财务分析" } } } as never;
      }
      if (url === "/api/v1/projects/project-1/sources") {
        return { data: { data: [] } } as never;
      }
      return {
        data: {
          data: {
            items: [ignored],
            total: 1,
            offset: 0,
            limit: 50,
            has_more: false,
            next_offset: null,
          },
        },
      } as never;
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({
      data: {
        data: {
          action: "restore",
          items: [{ ...ignored, is_active: true, validity: "unverified", active_revision_id: "restored-head", revision_number: 2 }],
          queued_entry_ids: [],
        },
      },
    } as never);

    render(<ProjectUnderstandingWorkspace projectId="project-1" />);
    await screen.findByText("共 1 条");
    expect(screen.getByRole("button", { name: "编辑" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重新考虑" }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/api/v1/projects/project-1/knowledge/batch",
        {
          action: "restore",
          items: [
            {
              entry_id: ignored.id,
              expected_active_revision_id: ignored.active_revision_id,
            },
          ],
        }
      )
    );
  });

  it("edits one business description against the visible revision", async () => {
    const first = candidate("one", "orders", "stores");
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/api/v1/projects/project-1") {
        return { data: { data: { id: "project-1", name: "财务分析" } } } as never;
      }
      if (url === "/api/v1/projects/project-1/sources") {
        return { data: { data: [] } } as never;
      }
      return {
        data: {
          data: {
            items: [first],
            total: 1,
            offset: 0,
            limit: 50,
            has_more: false,
            next_offset: null,
          },
        },
      } as never;
    });
    const put = vi.spyOn(api, "put").mockResolvedValue({
      data: { data: { ...first, value: "订单按门店编号关联" } },
    } as never);

    render(<ProjectUnderstandingWorkspace projectId="project-1" />);
    await screen.findByText("共 1 条");
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText("业务定义"), {
      target: { value: "订单按门店编号关联" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        `/api/v1/projects/project-1/knowledge/${first.id}`,
        expect.objectContaining({
          expected_active_revision_id: first.active_revision_id,
          key: first.key,
          value: "订单按门店编号关联",
          entry_type: "relationship",
          state: "candidate",
          source: "user",
          confidence: first.confidence,
          definition: expect.objectContaining({
            left: expect.objectContaining({ table_or_view: "orders", column: "store_id" }),
            right: expect.objectContaining({ table_or_view: "stores", column: "store_id" }),
            default_join: "left",
          }),
        })
      )
    );
  });

  it("adds a manual business definition with an explicit governance state", async () => {
    const created: SemanticEntry = {
      ...candidate("created", "orders", "stores"),
      key: "rule:recognized_revenue",
      value: "只统计已审核订单",
      entry_type: "business_rule",
      state: "confirmed",
      confidence: 1,
      definition: null,
      validity: "active",
      source: "user",
      allowed_actions: [],
    };
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/api/v1/projects/project-1") {
        return { data: { data: { id: "project-1", name: "财务分析" } } } as never;
      }
      if (url === "/api/v1/projects/project-1/sources") {
        return { data: { data: [] } } as never;
      }
      return {
        data: {
          data: {
            items: [],
            total: 0,
            offset: 0,
            limit: 50,
            has_more: false,
            next_offset: null,
          },
        },
      } as never;
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({
      data: { data: created },
    } as never);

    render(<ProjectUnderstandingWorkspace projectId="project-1" />);
    await screen.findByText("共 0 条");
    fireEvent.click(screen.getByRole("button", { name: "新增定义" }));
    expect(screen.getByRole("dialog", { name: "新增业务定义" })).toBeInTheDocument();
    expect(screen.getByLabelText("采用状态")).toHaveValue("candidate");

    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "已审核收入" },
    });
    fireEvent.change(screen.getByLabelText("业务定义"), {
      target: { value: "只统计已审核订单" },
    });
    fireEvent.change(screen.getByLabelText("采用状态"), {
      target: { value: "confirmed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加定义" }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/api/v1/projects/project-1/knowledge",
        expect.objectContaining({
          key: expect.stringMatching(/^semantic:business_rule:/),
          value: "只统计已审核订单",
          entry_type: "business_rule",
          state: "confirmed",
          confidence: 1,
          definition: {
            business_name: "已审核收入",
            description: "只统计已审核订单",
          },
          validity: "active",
          source: "user",
          evidence: [{ kind: "user_declaration" }],
          scope_id: null,
        })
      )
    );
  });

  it("binds a manual definition to one selected data source", async () => {
    const source = projectSource("csv-file", "门店清单.csv", "file", "csv");
    source.profile_data.schema = {
      columns: [{ name: "region", type: "text" }],
    };
    const created: SemanticEntry = {
      ...candidate("created-for-csv", "orders", "stores"),
      key: "dimension:store_region",
      value: "门店所属经营区域",
      entry_type: "dimension",
      definition: null,
      source: "user",
      source_scope: "csv",
      source_refs: [
        {
          source_id: source.id,
          logical_name: source.name,
          name: source.name,
          kind: source.kind,
          format: source.format,
        },
      ],
    };
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/api/v1/projects/project-1") {
        return { data: { data: { id: "project-1", name: "财务分析" } } } as never;
      }
      if (url === "/api/v1/projects/project-1/sources") {
        return { data: { data: [source] } } as never;
      }
      return {
        data: {
          data: {
            items: [],
            total: 0,
            offset: 0,
            limit: 50,
            has_more: false,
            next_offset: null,
          },
        },
      } as never;
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: { data: created } } as never);

    render(<ProjectUnderstandingWorkspace projectId="project-1" />);
    await screen.findByRole("treeitem", { name: /门店清单.csv/ });
    fireEvent.click(screen.getByRole("button", { name: "新增定义" }));
    fireEvent.change(screen.getByLabelText("定义类型"), {
      target: { value: "dimension" },
    });
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "门店区域" },
    });
    fireEvent.change(screen.getByLabelText("业务定义"), {
      target: { value: "门店所属经营区域" },
    });
    const scopeSelect = screen.getByLabelText("放在哪一层") as HTMLSelectElement;
    const fileViewOption = Array.from(scopeSelect.options).find((option) =>
      option.textContent?.includes("文件视图")
    );
    expect(fileViewOption).toBeDefined();
    fireEvent.change(scopeSelect, { target: { value: fileViewOption?.value } });
    fireEvent.change(screen.getByLabelText("分组字段"), {
      target: { value: "region" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加定义" }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/api/v1/projects/project-1/knowledge",
        expect.objectContaining({
          entry_type: "dimension",
          evidence: [{ kind: "user_declaration", source_ids: [source.id] }],
          definition: expect.objectContaining({
            kind: "dimension",
            role: "category",
            business_name: "门店区域",
            source: expect.objectContaining({
              table_or_view: "门店清单.csv",
              action_column: "region",
            }),
          }),
        })
      )
    );
  });

  it("keeps an existing cross-source scope when editing unrelated fields", async () => {
    const crossSourceRule: SemanticEntry = {
      ...candidate("cross-rule", "orders", "stores"),
      key: "rule:cross_source_customer",
      value: "客户口径跨订单库与会员库统一",
      entry_type: "business_rule",
      definition: null,
      source_scope: "cross_source",
      source_refs: [
        {
          source_id: "orders-db",
          logical_name: "订单库",
          name: "订单库",
          kind: "connection",
          format: "postgresql",
        },
        {
          source_id: "members-db",
          logical_name: "会员库",
          name: "会员库",
          kind: "connection",
          format: "mysql",
        },
      ],
      evidence: [
        { kind: "matching_column_names", score: 0.9 },
        { kind: "user_declaration", source_ids: ["orders-db", "members-db"] },
      ],
      source: "user",
    };
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/api/v1/projects/project-1") {
        return { data: { data: { id: "project-1", name: "财务分析" } } } as never;
      }
      if (url === "/api/v1/projects/project-1/sources") {
        return { data: { data: [] } } as never;
      }
      return {
        data: {
          data: {
            items: [crossSourceRule],
            total: 1,
            offset: 0,
            limit: 50,
            has_more: false,
            next_offset: null,
          },
        },
      } as never;
    });
    const put = vi.spyOn(api, "put").mockResolvedValue({
      data: { data: { ...crossSourceRule, value: "统一客户口径" } },
    } as never);

    render(<ProjectUnderstandingWorkspace projectId="project-1" />);
    expect((await screen.findAllByText("财务分析")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByLabelText("放在哪一层")).toHaveValue("preserve");
    fireEvent.change(screen.getByLabelText("业务定义"), {
      target: { value: "统一客户口径" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        `/api/v1/projects/project-1/knowledge/${crossSourceRule.id}`,
        expect.objectContaining({ evidence: crossSourceRule.evidence })
      )
    );
  });

  it("builds a structured relationship from project source metadata", async () => {
    const source = {
      id: "source-1",
      project_id: "project-1",
      kind: "connection",
      name: "财务库",
      format: "sqlite",
      status: "ready",
      fingerprint: null,
      profile_data: {
        logical_name: "财务库",
        tables: [
          {
            name: "orders",
            columns: [
              { name: "id", type: "INTEGER" },
              { name: "store_id", type: "INTEGER" },
            ],
          },
          {
            name: "stores",
            columns: [
              { name: "id", type: "INTEGER" },
              { name: "name", type: "TEXT" },
            ],
          },
        ],
      },
      created_at: "2026-07-19T00:00:00Z",
      updated_at: "2026-07-19T00:00:00Z",
    };
    const created = candidate("manual-relationship", "orders", "stores");
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/api/v1/projects/project-1") {
        return { data: { data: { id: "project-1", name: "财务分析" } } } as never;
      }
      if (url === "/api/v1/projects/project-1/sources") {
        return { data: { data: [source] } } as never;
      }
      return {
        data: {
          data: {
            items: [],
            total: 0,
            offset: 0,
            limit: 50,
            has_more: false,
            next_offset: null,
          },
        },
      } as never;
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: { data: created } } as never);

    render(<ProjectUnderstandingWorkspace projectId="project-1" />);
    await screen.findByText("共 0 条");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "新增定义" })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole("button", { name: "新增定义" }));
    fireEvent.change(screen.getByLabelText("定义类型"), {
      target: { value: "relationship" },
    });
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "订单门店关联" },
    });
    fireEvent.change(screen.getByLabelText("业务定义"), {
      target: { value: "订单通过门店编号关联门店" },
    });
    fireEvent.change(screen.getByLabelText("左侧数据来源"), {
      target: { value: source.id },
    });
    fireEvent.change(screen.getByLabelText("左侧表或视图"), {
      target: { value: "orders" },
    });
    fireEvent.change(screen.getByLabelText("左侧字段"), {
      target: { value: "store_id" },
    });
    fireEvent.change(screen.getByLabelText("右侧数据来源"), {
      target: { value: source.id },
    });
    fireEvent.change(screen.getByLabelText("右侧表或视图"), {
      target: { value: "stores" },
    });
    fireEvent.change(screen.getByLabelText("右侧字段"), {
      target: { value: "id" },
    });
    fireEvent.change(screen.getByLabelText("连接方式"), {
      target: { value: "inner" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加定义" }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const payload = post.mock.calls[0]?.[1] as Record<string, unknown>;
    const definition = payload.definition as Record<string, unknown>;
    const left = definition.left as Record<string, unknown>;
    const right = definition.right as Record<string, unknown>;
    expect(definition.default_join).toBe("inner");
    expect(definition.business_name).toBe("订单门店关联");
    expect(left).toMatchObject({
      source_logical_name: "财务库",
      source_kind: "connection",
      table_or_view: "orders",
      column: "store_id",
      data_type: "INTEGER",
    });
    expect(right).toMatchObject({ table_or_view: "stores", column: "id" });
    expect(left.schema_signature).toBe(
      "e1c990977787c443205b82fc5e6dcc4efe2bea6ecb6bd28000a5b3586ad28d56"
    );
    expect(right.schema_signature).toBe(
      "5571d00d2f7bebe04ebc5c692b865ec86ee672b9e85955cb7ce9afa3ed3385ad"
    );
  });

  it("preserves a typed dimension definition through the editor", async () => {
    const dimension: SemanticEntry = {
      ...candidate("order-date", "orders", "stores"),
      key: "dimension:order_date",
      value: "订单发生日期",
      entry_type: "dimension",
      definition: {
        version: 1,
        kind: "dimension",
        role: "time",
        source: {
          source_logical_name: "经营库",
          source_kind: "connection",
          table_or_view: "orders",
          action_column: "order_date",
          canonical_type: "datetime",
          schema_signature: "a".repeat(64),
        },
        business_name: "下单日期",
        description: "订单发生日期",
        example_questions: ["销售额按月如何变化？"],
        time_granularities: ["year", "month", "day"],
        timezone: "Asia/Shanghai",
      },
    };
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/api/v1/projects/project-1") {
        return { data: { data: { id: "project-1", name: "财务分析" } } } as never;
      }
      if (url === "/api/v1/projects/project-1/sources") {
        return { data: { data: [] } } as never;
      }
      return {
        data: {
          data: {
            items: [dimension],
            total: 1,
            offset: 0,
            limit: 50,
            has_more: false,
            next_offset: null,
          },
        },
      } as never;
    });
    const put = vi.spyOn(api, "put").mockResolvedValue({
      data: { data: { ...dimension, source: "user" } },
    } as never);

    render(<ProjectUnderstandingWorkspace projectId="project-1" />);
    await screen.findByText("共 1 条");
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByLabelText("字段用途")).toHaveValue("time");
    expect(screen.queryByText("结构化 JSON")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        `/api/v1/projects/project-1/knowledge/${dimension.id}`,
        expect.objectContaining({
          entry_type: "dimension",
          definition: expect.objectContaining({ kind: "dimension", role: "time" }),
        })
      )
    );
  });

  it("keeps the technical key internal and never exposes a raw JSON editor", async () => {
    const rule: SemanticEntry = {
      ...candidate("rule", "orders", "stores"),
      key: "rule:refund_scope",
      value: "退款按审核状态计算",
      entry_type: "business_rule",
      definition: null,
    };
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/api/v1/projects/project-1") {
        return { data: { data: { id: "project-1", name: "财务分析" } } } as never;
      }
      if (url === "/api/v1/projects/project-1/sources") {
        return { data: { data: [] } } as never;
      }
      return {
        data: {
          data: {
            items: [rule],
            total: 1,
            offset: 0,
            limit: 50,
            has_more: false,
            next_offset: null,
          },
        },
      } as never;
    });
    const put = vi.spyOn(api, "put").mockResolvedValue({
      data: { data: { ...rule, source: "user" } },
    } as never);

    render(<ProjectUnderstandingWorkspace projectId="project-1" />);
    await screen.findByText("共 1 条");
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.queryByText("高级定义（可选）")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("扩展定义")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(rule.key)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "退款范围" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        `/api/v1/projects/project-1/knowledge/${rule.id}`,
        expect.objectContaining({
          key: rule.key,
          entry_type: "business_rule",
          definition: {
            business_name: "退款范围",
            description: "退款按审核状态计算",
          },
        })
      )
    );
  });

  it("syncs a deep-linked project without triggering a legacy full refresh", async () => {
    useProjectStore.setState({ currentProjectId: "project-A" });
    window.localStorage.setItem("receiptbi-current-project", "project-A");
    const get = vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/api/v1/projects/project-B") {
        return { data: { data: { id: "project-B", name: "项目 B" } } } as never;
      }
      if (url === "/api/v1/projects/project-B/sources") {
        return { data: { data: [] } } as never;
      }
      return {
        data: {
          data: {
            items: [],
            total: 0,
            offset: 0,
            limit: 50,
            has_more: false,
            next_offset: null,
          },
        },
      } as never;
    });

    render(<ProjectUnderstandingWorkspace projectId="project-B" />);

    await waitFor(() =>
      expect(useProjectStore.getState().currentProjectId).toBe("project-B")
    );
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      "receiptbi-current-project",
      "project-B"
    );
    expect(get).not.toHaveBeenCalledWith("/api/v1/projects/project-B/knowledge", expect.anything());
  });

  it("does not fall back to loading the entire semantic layer", async () => {
    const get = vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/api/v1/projects/project-1") {
        return { data: { data: { id: "project-1", name: "财务分析" } } } as never;
      }
      if (url === "/api/v1/projects/project-1/sources") {
        return { data: { data: [] } } as never;
      }
      if (url === "/api/v1/projects/project-1/knowledge/page") {
        throw { response: { status: 404, data: { detail: "分页接口不可用" } } };
      }
      throw new Error(`unexpected request: ${url}`);
    });

    render(<ProjectUnderstandingWorkspace projectId="project-1" />);

    expect(await screen.findByText("当前内容没有加载完成，请重试。")).toBeInTheDocument();
    expect(screen.queryByText(/HTTP 404/)).not.toBeInTheDocument();
    expect(screen.queryByText("分页接口不可用")).not.toBeInTheDocument();
    expect(
      get.mock.calls.some(
        ([url]) => url === "/api/v1/projects/project-1/knowledge"
      )
    ).toBe(false);
  });

  it("retains selection but disables page selection while a replacement query is pending", async () => {
    const first = candidate("one", "orders", "stores");
    let resolveReplacement: ((value: unknown) => void) | null = null;
    let pageCallCount = 0;
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/api/v1/projects/project-1") {
        return { data: { data: { id: "project-1", name: "财务分析" } } } as never;
      }
      if (url === "/api/v1/projects/project-1/sources") {
        return { data: { data: [] } } as never;
      }
      if (url === "/api/v1/projects/project-1/semantic-scopes") {
        return { data: { data: [] } } as never;
      }
      pageCallCount += 1;
      if (pageCallCount === 1) {
        return {
          data: {
            data: {
              items: [first],
              total: 1,
              offset: 0,
              limit: 50,
              has_more: false,
              next_offset: null,
            },
          },
        } as never;
      }
      return await new Promise((resolve) => {
        resolveReplacement = resolve;
      });
    });

    render(<ProjectUnderstandingWorkspace projectId="project-1" />);
    await screen.findByText("共 1 条");
    fireEvent.click(screen.getByLabelText("选择本页"));
    expect(screen.getByText("已选 1 条")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("内容类型"), {
      target: { value: "business_rule" },
    });

    await waitFor(() => expect(screen.getByLabelText("选择本页")).toBeDisabled());
    expect(screen.getByText("已选 1 条")).toBeInTheDocument();
    expect(screen.getByLabelText("选择本页")).toBeDisabled();

    await act(async () => {
      resolveReplacement?.({
        data: {
          data: {
            items: [],
            total: 0,
            offset: 0,
            limit: 50,
            has_more: false,
            next_offset: null,
          },
        },
      });
    });
    await waitFor(() => expect(screen.getByText("共 0 条")).toBeInTheDocument());
  });

  it("rejects entries whose server action contract is missing", async () => {
    const unsafe = {
      ...candidate("unsafe", "orders", "stores"),
      allowed_actions: undefined,
    } as unknown as SemanticEntry;
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url.endsWith("/sources")) return { data: { data: [] } } as never;
      if (url === "/api/v1/projects/project-1") {
        return { data: { data: { id: "project-1", name: "财务分析" } } } as never;
      }
      return {
        data: {
          data: {
            items: [unsafe],
            total: 1,
            offset: 0,
            limit: 50,
            has_more: false,
            next_offset: null,
          },
        },
      } as never;
    });

    render(<ProjectUnderstandingWorkspace projectId="project-1" />);

    expect(
      await screen.findByText("项目理解的操作权限没有加载完成，请刷新重试。")
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "系统验证" })).not.toBeInTheDocument();
  });

  it("keeps relationship parsing explicit and typed", () => {
    const entry = candidate("one", "orders", "stores");
    expect(relationshipDefinition(entry)?.left?.table_or_view).toBe("orders");
  });
});
