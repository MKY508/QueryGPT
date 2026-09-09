import {
  act,
  cleanup,
  fireEvent,
  render as testingLibraryRender,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SemanticGovernanceDialog } from "@/components/semantic/SemanticGovernanceDialog";
import { api } from "@/lib/api/client";
import type {
  ProjectDataSource,
  SemanticInventoryDepth,
  SemanticInventoryJob,
  SemanticRecommendationResult,
} from "@/lib/types/api";
import zhMessages from "@/messages/zh.json";

function render(ui: ReactElement) {
  document.documentElement.lang = "zh";
  return testingLibraryRender(
    <NextIntlClientProvider locale="zh" messages={zhMessages}>
      {ui}
    </NextIntlClientProvider>
  );
}

function source(
  id: string,
  name: string,
  kind: ProjectDataSource["kind"],
  status: ProjectDataSource["status"],
  tables: string[] = []
): ProjectDataSource {
  return {
    id,
    project_id: "project-1",
    kind,
    name,
    format: kind === "file" ? "csv" : "postgresql",
    status,
    profile_data: {
      logical_name: name,
      ...(kind === "connection"
        ? {
            tables: tables.map((table) => ({
              name: table,
              columns: [{ name: "id", type: "integer" }],
            })),
          }
        : {}),
    },
    created_at: "2026-07-22T00:00:00Z",
    updated_at: "2026-07-22T00:00:00Z",
  };
}

function relationIndexResult(
  sourceId: string,
  relations: Array<{ name: string; schema?: string; comment?: string }>
) {
  return {
    source_id: sourceId,
    relation_index: {
      relations: relations.map((relation) => ({ kind: "table", ...relation })),
      relations_loaded: relations.length,
      relations_total: relations.length,
      relations_total_at_least: relations.length,
      complete: true,
      truncated: false,
      unread_relations_at_least: 0,
    },
    semantic_scope_table_count: relations.length,
  };
}

function inventoryJob(
  sourceId: string,
  tables: string[],
  depth: SemanticInventoryDepth = "structure"
): SemanticInventoryJob {
  return {
    id: `job-${sourceId}`,
    project_id: "project-1",
    source_id: sourceId,
    status: "queued",
    depth,
    locale: "zh",
    tables,
    progress: {
      total: tables.length || 87,
      queued: tables.length || 87,
      running: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
    },
    items: (tables.length ? tables : ["public.orders"]).map((table, index) => ({
      id: `job-item-${index}`,
      table,
      status: "queued",
      phase: "structure",
      attempt_count: 0,
      retryable: true,
      candidate_count: 0,
    })),
    created_at: "2026-07-22T00:00:00Z",
  };
}

describe("SemanticGovernanceDialog", () => {
  const nativeMethods = ["showModal", "close"] as const;
  let nativeDescriptors: (PropertyDescriptor | undefined)[];
  beforeEach(() => {
    nativeDescriptors = nativeMethods.map(name => Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name));
    for (const name of nativeMethods) Object.defineProperty(HTMLDialogElement.prototype, name, {
      configurable: true, value: function (this: HTMLDialogElement) { this.open = name === "showModal"; },
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    nativeMethods.forEach((name, index) => {
      const descriptor = nativeDescriptors[index];
      if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
    });
  });

  it("waits for an explicit click and keeps database organization separate from files", async () => {
    const result: SemanticRecommendationResult = {
      batch_id: "batch-1",
      generated_by: "ai",
      items: [],
    };
    const post = vi.spyOn(api, "post").mockImplementation(async (url, payload) => {
      if (url.endsWith("/sources/db-ready/relation-index")) {
        return {
          data: {
            data: relationIndexResult("db-ready", [
              { name: "orders" },
              { name: "refunds" },
            ]),
          },
        } as never;
      }
      if (url.endsWith("/sources/db-ready/semantic-inventory-jobs")) {
        const tables = (payload as { tables: string[] }).tables;
        return { data: { data: inventoryJob("db-ready", tables) } } as never;
      }
      return { data: { data: result } } as never;
    });
    const onGenerated = vi.fn();
    const onInventoryStarted = vi.fn();
    const onClose = vi.fn();

    render(
      <SemanticGovernanceDialog
        open
        projectId="project-1"
        sources={[
          source("file-ready", "订单.csv", "file", "ready"),
          source("db-ready", "经营库", "connection", "ready", ["orders", "refunds"]),
          source("file-pending", "待确认.csv", "file", "needs_confirmation"),
        ]}
        onClose={onClose}
        onGenerated={onGenerated}
        onInventoryStarted={onInventoryStarted}
      />
    );

    await screen.findByText("数据库 · 2 张表");
    expect(screen.queryByText(/已更新/)).not.toBeInTheDocument();
    expect(screen.queryByText("整个数据库")).not.toBeInTheDocument();
    expect(screen.queryByText(/会按表/)).not.toBeInTheDocument();
    expect(
      post.mock.calls.filter(([url]) => url.endsWith("/knowledge/recommendations"))
    ).toHaveLength(0);
    expect(screen.queryByText("待确认.csv")).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "选择要整理的数据，ReceiptBI 会为它生成可核对的业务名称、指标和分组方式。"
      )
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "只读取已经准备好的内容；整理期间你仍可继续查看和编辑项目，结果由你决定是否采纳。"
      )
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "选择要整理的数据" })
    ).toBeInTheDocument();
    expect(screen.queryByText(/分析服务|联系服务|网络/)).not.toBeInTheDocument();
    const start = screen.getByRole("button", { name: "开始整理" });
    expect(start).toBeDisabled();

    fireEvent.click(screen.getByLabelText("选择数据来源 经营库"));
    expect(start).toBeEnabled();
    fireEvent.click(screen.getByLabelText("选择表 · 深入整理"));
    expect(start).toBeDisabled();
    fireEvent.click(screen.getByLabelText("选择 经营库 中的表 退款资料"));
    fireEvent.click(screen.getByLabelText("选择数据来源 订单.csv"));
    expect(start).toBeEnabled();
    expect(
      post.mock.calls.filter(([url]) => url.endsWith("/knowledge/recommendations"))
    ).toHaveLength(0);

    fireEvent.click(start);

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith(
        "/api/v1/projects/project-1/sources/db-ready/semantic-inventory-jobs",
        { locale: "zh", tables: ["refunds"], depth: "structure" }
      );
      expect(post).toHaveBeenCalledWith(
        "/api/v1/projects/project-1/knowledge/recommendations",
        {
          locale: "zh",
          scopes: [{ source_id: "file-ready", tables: [] }],
          limit: 20,
        }
      );
    });
    expect(onGenerated).toHaveBeenCalledWith(result);
    expect(onInventoryStarted).toHaveBeenCalledWith([
      inventoryJob("db-ready", ["refunds"]),
    ]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps an empty scope non-submittable", () => {
    const post = vi.spyOn(api, "post");
    render(
      <SemanticGovernanceDialog
        open
        projectId="project-1"
        sources={[]}
        onClose={vi.fn()}
        onGenerated={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "开始整理" })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });

  it("starts table-level organization for all database tables by default", async () => {
    const job = inventoryJob("db-ready", []);
    const post = vi.spyOn(api, "post").mockImplementation(async (url) => {
      if (url.endsWith("/sources/db-ready/relation-index")) {
        return {
          data: {
            data: relationIndexResult("db-ready", [
              { schema: "sales", name: "orders" },
              { schema: "sales", name: "refunds" },
            ]),
          },
        } as never;
      }
      return { data: { data: job } } as never;
    });
    const onInventoryStarted = vi.fn();

    render(
      <SemanticGovernanceDialog
        open
        projectId="project-1"
        sources={[source("db-ready", "经营库", "connection", "ready", ["orders"])]}
        onClose={vi.fn()}
        onInventoryStarted={onInventoryStarted}
      />
    );

    await screen.findByText("数据库 · 2 张表");
    fireEvent.click(screen.getByLabelText("选择数据来源 经营库"));
    expect(screen.getByLabelText("全部表 · 用途与关联")).toBeChecked();
    expect(screen.queryByText("整个数据库")).not.toBeInTheDocument();
    expect(screen.queryByText(/会按表/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "开始整理" }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/api/v1/projects/project-1/sources/db-ready/semantic-inventory-jobs",
        { locale: "zh", tables: [], depth: "structure" }
      )
    );
    expect(onInventoryStarted).toHaveBeenCalledWith([job]);
  });

  it("shows a business error when starting table organization returns HTTP 404", async () => {
    vi.spyOn(api, "post").mockImplementation(async (url) => {
      if (url.endsWith("/sources/db-ready/relation-index")) {
        return {
          data: {
            data: relationIndexResult("db-ready", [
              { name: "orders" },
              { name: "refunds" },
            ]),
          },
        } as never;
      }
      if (url.endsWith("/sources/db-ready/semantic-inventory-jobs")) {
        throw {
          isAxiosError: true,
          message: "Request failed with status code 404",
          response: {
            status: 404,
            data: { detail: "semantic inventory route not found" },
          },
        };
      }
      throw new Error(`unexpected request: ${url}`);
    });

    render(
      <SemanticGovernanceDialog
        open
        projectId="project-1"
        sources={[
          source("db-ready", "经营库", "connection", "ready", ["orders", "refunds"]),
        ]}
        onClose={vi.fn()}
        onGenerated={vi.fn()}
      />
    );

    await screen.findByText("数据库 · 2 张表");
    fireEvent.click(screen.getByLabelText("选择数据来源 经营库"));
    fireEvent.click(screen.getByRole("button", { name: "开始整理" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("这次整理未能开始，请重试。");
    expect(alert).not.toHaveTextContent(/HTTP|404|route/i);
  });

  it("keeps same-named tables in different schemas distinct", async () => {
    const database = source("db-ready", "经营库", "connection", "ready");
    database.profile_data = {
      logical_name: "经营库",
      preanalysis: {
        relation_index: {
          relations: [
            { schema: "sales", name: "orders", kind: "table", comment: "销售订单" },
            { schema: "archive", name: "orders", kind: "table", comment: "历史订单" },
          ],
        },
      },
    };
    const relations = [
      { schema: "sales", name: "orders", comment: "销售订单" },
      { schema: "archive", name: "orders", comment: "历史订单" },
    ];
    const post = vi.spyOn(api, "post").mockImplementation(async (url, payload) => {
      if (url.endsWith("/sources/db-ready/relation-index")) {
        return {
          data: { data: relationIndexResult("db-ready", relations) },
        } as never;
      }
      return {
        data: {
          data: inventoryJob(
            "db-ready",
            (payload as { tables: string[] }).tables
          ),
        },
      } as never;
    });

    render(
      <SemanticGovernanceDialog
        open
        projectId="project-1"
        sources={[database]}
        onClose={vi.fn()}
        onGenerated={vi.fn()}
      />
    );

    await screen.findByText("数据库 · 2 张表");
    fireEvent.click(screen.getByLabelText("选择数据来源 经营库"));
    fireEvent.click(screen.getByLabelText("选择表 · 深入整理"));
    fireEvent.click(screen.getByLabelText("同时参考少量表中内容"));
    expect(screen.getByLabelText("选择 经营库 中的表 销售订单")).toBeInTheDocument();
    expect(screen.getByLabelText("选择 经营库 中的表 历史订单")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("选择 经营库 中的表 销售订单"));
    fireEvent.click(screen.getByRole("button", { name: "开始整理" }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/api/v1/projects/project-1/sources/db-ready/semantic-inventory-jobs",
        { locale: "zh", tables: ["sales.orders"], depth: "sampled" }
      )
    );
  });

  it("refreshes a ready database directory on open without generating recommendations", async () => {
    const initialTables = Array.from({ length: 24 }, (_, index) => `table_${index + 1}`);
    const refreshedRelations = Array.from({ length: 87 }, (_, index) => ({
      schema: "public",
      name: `table_${index + 1}`,
      comment: `业务表 ${index + 1}`,
    }));
    let resolveCatalog: ((value: unknown) => void) | undefined;
    const catalogResponse = new Promise((resolve) => {
      resolveCatalog = resolve;
    });
    const post = vi.spyOn(api, "post").mockImplementation(async (url) => {
      if (url.endsWith("/sources/db-ready/relation-index")) {
        return catalogResponse as never;
      }
      throw new Error("recommendations must not run while opening the dialog");
    });
    const onCatalogRefreshed = vi.fn();

    render(
      <SemanticGovernanceDialog
        open
        projectId="project-1"
        sources={[source("db-ready", "经营库", "connection", "ready", initialTables)]}
        onClose={vi.fn()}
        onGenerated={vi.fn()}
        onCatalogRefreshed={onCatalogRefreshed}
      />
    );

    expect(await screen.findByText("正在更新可选择的数据表…")).toBeInTheDocument();
    expect(screen.getByLabelText("选择数据来源 经营库")).toBeEnabled();
    expect(
      post.mock.calls.filter(([url]) => url.endsWith("/knowledge/recommendations"))
    ).toHaveLength(0);

    await act(async () => {
      resolveCatalog?.({
        data: { data: relationIndexResult("db-ready", refreshedRelations) },
      });
      await catalogResponse;
    });

    expect(await screen.findByText("数据库 · 87 张表")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("选择数据来源 经营库"));
    fireEvent.click(screen.getByLabelText("选择表 · 深入整理"));
    expect(
      screen.getByLabelText("选择 经营库 中的表 业务表 87")
    ).toBeInTheDocument();
    expect(
      post.mock.calls.filter(([url]) => url.endsWith("/knowledge/recommendations"))
    ).toHaveLength(0);
    expect(onCatalogRefreshed).toHaveBeenCalledTimes(1);
    expect(
      (
        onCatalogRefreshed.mock.calls[0][0] as ProjectDataSource
      ).profile_data.relation_index
    ).toEqual(expect.objectContaining({ relations_loaded: 87 }));
  });

  it("keeps the previous table list after a refresh failure and does not block files", async () => {
    const previousTables = Array.from({ length: 24 }, (_, index) => `table_${index + 1}`);
    const post = vi.spyOn(api, "post").mockImplementation(async (url) => {
      if (url.endsWith("/sources/db-ready/relation-index")) {
        throw new Error("offline");
      }
      return {
        data: {
          data: { batch_id: "batch-file", generated_by: "ai", items: [] },
        },
      } as never;
    });

    render(
      <SemanticGovernanceDialog
        open
        projectId="project-1"
        sources={[
          source("db-ready", "经营库", "connection", "ready", previousTables),
          source("file-ready", "订单.csv", "file", "ready"),
        ]}
        onClose={vi.fn()}
        onGenerated={vi.fn()}
      />
    );

    expect(
      await screen.findByText(/仍显示上次保存的 24 张表/)
    ).toBeInTheDocument();
    expect(screen.getByLabelText("选择数据来源 经营库")).toBeEnabled();
    fireEvent.click(screen.getByLabelText("选择数据来源 订单.csv"));
    const start = screen.getByRole("button", { name: "开始整理" });
    expect(start).toBeEnabled();
    expect(
      post.mock.calls.filter(([url]) => url.endsWith("/knowledge/recommendations"))
    ).toHaveLength(0);

    fireEvent.click(start);
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/api/v1/projects/project-1/knowledge/recommendations",
        expect.objectContaining({
          scopes: [{ source_id: "file-ready", tables: [] }],
        })
      )
    );
  });

  it("keeps partial-start failures visible and retries only the sources that failed", async () => {
    const result: SemanticRecommendationResult = {
      batch_id: "batch-file",
      generated_by: "ai",
      items: [],
    };
    let databaseAttempts = 0;
    const post = vi.spyOn(api, "post").mockImplementation(async (url) => {
      if (url.endsWith("/sources/db-ready/relation-index")) {
        return {
          data: {
            data: relationIndexResult("db-ready", [{ name: "orders" }]),
          },
        } as never;
      }
      if (url.endsWith("/sources/db-ready/semantic-inventory-jobs")) {
        databaseAttempts += 1;
        if (databaseAttempts === 1) throw new Error("temporary failure");
        return { data: { data: inventoryJob("db-ready", []) } } as never;
      }
      if (url.endsWith("/knowledge/recommendations")) {
        return { data: { data: result } } as never;
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const onGenerated = vi.fn();
    const onInventoryStarted = vi.fn();
    const onClose = vi.fn();

    render(
      <SemanticGovernanceDialog
        open
        projectId="project-1"
        sources={[
          source("file-ready", "订单.csv", "file", "ready"),
          source("db-ready", "经营库", "connection", "ready", ["orders"]),
        ]}
        onClose={onClose}
        onGenerated={onGenerated}
        onInventoryStarted={onInventoryStarted}
      />
    );

    await screen.findByText("数据库 · 1 张表");
    fireEvent.click(screen.getByLabelText("选择数据来源 订单.csv"));
    fireEvent.click(screen.getByLabelText("选择数据来源 经营库"));
    fireEvent.click(screen.getByRole("button", { name: "开始整理" }));

    expect(await screen.findByText("1 项未能开始；已开始的内容会继续整理。")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(onGenerated).toHaveBeenCalledWith(result);
    expect(onInventoryStarted).not.toHaveBeenCalled();
    expect(screen.getByLabelText("选择数据来源 订单.csv")).not.toBeChecked();
    expect(screen.getByLabelText("选择数据来源 经营库")).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "开始整理" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onInventoryStarted).toHaveBeenCalledWith([inventoryJob("db-ready", [])]);
    expect(
      post.mock.calls.filter(([url]) => url.endsWith("/knowledge/recommendations"))
    ).toHaveLength(1);
  });

  it("focuses the first ready source and closes with Escape", async () => {
    const onClose = vi.fn();
    render(
      <SemanticGovernanceDialog
        open
        projectId="project-1"
        sources={[source("file-ready", "订单.csv", "file", "ready")]}
        onClose={onClose}
        onGenerated={vi.fn()}
      />
    );

    const firstSource = screen.getByLabelText("选择数据来源 订单.csv");
    await waitFor(() => expect(firstSource).toHaveFocus());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("locks duplicate submission and closing, then ignores a response from a previous project", async () => {
    let finish!: (value: unknown) => void;
    const post = vi.spyOn(api, "post").mockImplementation(() => new Promise(resolve => { finish = resolve; }) as ReturnType<typeof api.post>);
    const onClose = vi.fn(), onGenerated = vi.fn();
    const sources = [source("file-ready", "订单.csv", "file", "ready")];
    const view = render(<SemanticGovernanceDialog open projectId="project-1" sources={sources} onClose={onClose} onGenerated={onGenerated} />);
    fireEvent.click(screen.getByLabelText("选择数据来源 订单.csv"));
    const form = screen.getByRole("button", { name: "开始整理" }).closest("form")!;
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(post).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    view.rerender(<NextIntlClientProvider locale="zh" messages={zhMessages}><SemanticGovernanceDialog open projectId="project-2" sources={sources} onClose={onClose} onGenerated={onGenerated} /></NextIntlClientProvider>);
    expect(screen.getByLabelText("选择数据来源 订单.csv")).not.toBeChecked();
    await act(async () => finish({ data: { data: { batch_id: "old", generated_by: "ai", items: [] } } }));
    expect(onGenerated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "取消" })).toBeEnabled();
  });
});
