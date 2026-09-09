import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DataWorkspacePanel,
  getPendingUnderstandingCount,
} from "@/components/chat/DataWorkspacePanel";
import {
  buildVisualCleaningOperation,
  parseSavedVisualCleaningOperations,
} from "@/components/chat/VisualCleaningEditor";
import { useProjectStore } from "@/lib/stores/project";
import enMessages from "@/messages/en.json";
import messages from "@/messages/zh.json";
import type {
  ProjectDataSource,
  SanitationRecipe,
  SanitationRecipeRevision,
  SanitationTemplatePreview,
  SemanticEntry,
} from "@/lib/types/api";

const removeStepAria = (step: string) =>
  messages.visualCleaning.removeStepAria.replace("{step}", step);

const relationshipCandidate: SemanticEntry = {
  id: "relationship-1",
  project_id: "project-1",
  key: "relationship_candidate:store_id",
  value: "orders.store_id ↔ stores.id",
  entry_type: "relationship",
  state: "candidate",
  confidence: 0.55,
  definition: { version: 1 },
  allowed_actions: [],
  validity: "unverified",
  evidence: [{ kind: "matching_column_names" }],
  source: "inferred",
  created_at: "2026-07-17T00:00:00Z",
  updated_at: "2026-07-17T00:00:00Z",
};

describe("DataWorkspacePanel project understanding", () => {
  afterEach(() => {
    cleanup();
    act(() => {
      useProjectStore.setState({
        currentProjectId: null,
        sources: [],
        preflightReports: [],
        recipes: [],
        recipeRevisionsByRecipe: {},
        recipeRevisionLoadingByRecipe: {},
        recipeRevisionRestoringByRecipe: {},
        recipeRevisionErrorByRecipe: {},
        recipeTemplates: [],
        recipeTemplatePreviewById: {},
        recipeTemplateAction: null,
        cleaningPreviewBySource: {},
        cleaningAction: null,
        knowledge: [],
        knowledgeTotal: 0,
        pendingKnowledgeCount: 0,
        relationshipKnowledgeCount: 0,
        knowledgeRevisionsByEntry: {},
        knowledgeRevisionLoadingByEntry: {},
        knowledgeRevisionRestoringByEntry: {},
        knowledgeRevisionErrorByEntry: {},
        sourceAction: null,
        error: null,
      });
    });
  });

  it("counts only business-facing understanding that a user can act on", () => {
    const metricCandidate: SemanticEntry = {
      ...relationshipCandidate,
      id: "metric-1",
      key: "metric:revenue",
      value: "收入按实付金额计算",
      entry_type: "metric",
      definition: { version: 1 },
    };
    const secondDeferredRelationship: SemanticEntry = {
      ...relationshipCandidate,
      id: "relationship-2",
      key: "relationship_candidate:order_id",
    };
    const staleCandidate: SemanticEntry = {
      ...metricCandidate,
      id: "metric-stale",
      key: "metric:stale",
      validity: "stale",
    };
    const internalQuery: SemanticEntry = {
      ...metricCandidate,
      id: "verified-query-1",
      key: "verified_query:revenue",
      entry_type: "verified_query",
    };

    expect(
      getPendingUnderstandingCount([
        relationshipCandidate,
        secondDeferredRelationship,
        metricCandidate,
        staleCandidate,
        internalQuery,
      ])
    ).toBe(3);
  });

  it("keeps the drawer read-only and previews at most eight items", () => {
    const knowledge = Array.from({ length: 10 }, (_, index) => ({
      ...relationshipCandidate,
      id: `relationship-${index}`,
      key: `relationship_candidate:${index}`,
      value: `第 ${index + 1} 条业务关联`,
    }));
    useProjectStore.setState({
      currentProjectId: "project-1",
      knowledge,
      knowledgeTotal: 10,
      pendingKnowledgeCount: 10,
      relationshipKnowledgeCount: 10,
    });

    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <DataWorkspacePanel
          open
          view="understanding"
          onClose={vi.fn()}
          onConfigureConnection={vi.fn()}
          connections={[]}
        />
      </NextIntlClientProvider>
    );

    const preview = screen.getByRole("region", { name: "项目理解预览" });
    expect(preview.querySelectorAll("article")).toHaveLength(8);
    expect(screen.getByRole("link", { name: "管理项目理解" })).toHaveAttribute(
      "href",
      "/projects/project-1/understanding"
    );
    expect(
      screen.queryByRole("button", {
        name: /记住|不采用|固定|修正|修改记录|重新考虑/,
      })
    ).not.toBeInTheDocument();
  });


  it("keeps a fixed desktop workspace while switching keyboard-accessible views", () => {
    const { container } = render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <DataWorkspacePanel
          open
          onClose={vi.fn()}
          onConfigureConnection={vi.fn()}
          connections={[]}
        />
      </NextIntlClientProvider>
    );

    const panel = container.querySelector("aside");
    expect(panel).toHaveClass("fixed", "inset-y-0", "right-0", "w-[900px]");
    expect(screen.queryByText("当前上下文")).not.toBeInTheDocument();
    expect(screen.queryByText("随时加入或替换；原件不会被修改。")).not.toBeInTheDocument();
    expect(screen.getByText("暂无数据")).toBeInTheDocument();

    const sources = screen.getByRole("tab", { name: /数据来源/ });
    const understanding = screen.getByRole("tab", { name: /项目理解/ });
    sources.focus();
    fireEvent.keyDown(sources, { key: "ArrowRight" });
    expect(understanding).toHaveFocus();
    expect(understanding).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", understanding.id);
    expect(panel).toHaveClass("w-[900px]");
  });

  it("shows every source without inventing relationship connectors", () => {
    const mapSources: ProjectDataSource[] = [
      {
        id: "source-orders",
        project_id: "project-1",
        kind: "file",
        name: "orders.csv",
        format: "csv",
        status: "ready",
        profile_data: {},
        created_at: "2026-07-22T00:00:00Z",
        updated_at: "2026-07-22T00:00:00Z",
      },
      {
        id: "source-warehouse",
        project_id: "project-1",
        connection_id: "connection-1",
        kind: "connection",
        name: "本地数仓-维度层",
        status: "ready",
        profile_data: {},
        created_at: "2026-07-22T00:00:00Z",
        updated_at: "2026-07-22T00:00:00Z",
      },
      {
        id: "source-products",
        project_id: "project-1",
        kind: "file",
        name: "products.csv",
        format: "csv",
        status: "ready",
        profile_data: {},
        created_at: "2026-07-22T00:00:00Z",
        updated_at: "2026-07-22T00:00:00Z",
      },
    ];
    useProjectStore.setState({
      currentProjectId: "project-1",
      sources: mapSources,
      knowledgeTotal: 89,
      relationshipKnowledgeCount: 80,
    });

    const { container } = render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <DataWorkspacePanel
          open
          view="understanding"
          onClose={vi.fn()}
          onConfigureConnection={vi.fn()}
          connections={[]}
        />
      </NextIntlClientProvider>
    );

    const map = container.querySelector(
      `[aria-label="${messages.dataWorkspace.understandingMapAria}"]`
    );
    const sourceNodes = container.querySelectorAll("[data-source-overview-node]");
    const relationshipEdges = container.querySelectorAll("[data-map-edge]");
    const understandingSummary = container.querySelector("[data-understanding-summary]");

    expect(map).toHaveClass("border", "bg-background/70", "p-3");
    expect(sourceNodes).toHaveLength(3);
    expect(relationshipEdges).toHaveLength(0);
    expect(understandingSummary).toHaveTextContent("89");
    expect(understandingSummary).toHaveTextContent("80");
  });

  it("keeps attached data untouched until the user explicitly prepares it", async () => {
    const originalProfileSource = useProjectStore.getState().profileSource;
    const profileSource = vi.fn().mockResolvedValue(undefined);
    const source: ProjectDataSource = {
      id: "source-attached",
      project_id: "project-1",
      kind: "file",
      name: "orders.csv",
      format: "csv",
      status: "attached",
      profile_data: {},
      created_at: "2026-07-22T00:00:00Z",
      updated_at: "2026-07-22T00:00:00Z",
    };
    useProjectStore.setState({
      currentProjectId: "project-1",
      sources: [source],
      profileSource,
    });

    const { rerender } = render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <DataWorkspacePanel
          open
          preprocessingEnabled={false}
          onClose={vi.fn()}
          onConfigureConnection={vi.fn()}
          connections={[]}
        />
      </NextIntlClientProvider>
    );

    expect(screen.getByText("来源已加入，等待准备。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "检查并准备数据" })).toBeDisabled();
    expect(screen.getByText("数据准备已关闭。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "设置" })).not.toBeInTheDocument();
    expect(profileSource).not.toHaveBeenCalled();

    rerender(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <DataWorkspacePanel
          open
          preprocessingEnabled
          onClose={vi.fn()}
          onConfigureConnection={vi.fn()}
          connections={[]}
        />
      </NextIntlClientProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "检查并准备数据" }));
    await waitFor(() => expect(profileSource).toHaveBeenCalledWith("source-attached"));
    useProjectStore.setState({ profileSource: originalProfileSource });
  });

  it("builds only the approved visual cleaning operations", () => {
    expect(buildVisualCleaningOperation("trim_text", " customer ")).toEqual({
      operation: "trim_text",
      column: "customer",
    });
    expect(buildVisualCleaningOperation("fill_missing", "amount")).toEqual({
      operation: "fill_missing",
      column: "amount",
      value: 0,
    });
    expect(buildVisualCleaningOperation("drop_exact_duplicates")).toEqual({
      operation: "drop_exact_duplicates",
    });
    expect(buildVisualCleaningOperation("normalize_datetime", "")).toBeNull();
    expect(
      parseSavedVisualCleaningOperations({
        operations: [
          {
            operation: "fill_missing",
            column: "amount",
            value: 0,
            contract_version: 1,
          },
          { operation: "fill_missing", column: "tax", value: 1 },
          { operation: "run_expression", column: "amount" },
        ],
      })
    ).toEqual([{ operation: "fill_missing", column: "amount", value: 0 }]);
  });

  it("keeps an unsupported saved fill rule from being silently replaced", () => {
    const source: ProjectDataSource = {
      id: "source-unsupported-cleaning",
      project_id: "project-1",
      kind: "file",
      name: "sales.csv",
      format: "csv",
      status: "ready",
      profile_data: {
        sample: [{ customer: " A ", amount: null }],
        visual_cleaning: {
          operations: [
            { operation: "trim_text", column: "customer" },
            { operation: "fill_missing", column: "amount", value: 1 },
          ],
        },
      },
      created_at: "2026-07-19T00:00:00Z",
      updated_at: "2026-07-19T00:00:00Z",
    };
    useProjectStore.setState({
      currentProjectId: "project-1",
      sources: [source],
      preflightReports: [],
      recipes: [],
      knowledge: [],
      cleaningPreviewBySource: {},
    });

    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <DataWorkspacePanel
          open
          onClose={vi.fn()}
          onConfigureConnection={vi.fn()}
          connections={[]}
        />
      </NextIntlClientProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "整理数据" }));

    expect(
      screen.getByText("这套整理方法包含当前无法编辑的步骤，原有设置会继续保留。")
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "预览变化" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /空值填 0/ })).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: removeStepAria("“customer” 去除首尾空格"),
      })
    ).toBeDisabled();
  });

  it("shows automatic recipe steps as read-only and leaves them out of manual preview", async () => {
    const originalPreview = useProjectStore.getState().previewSourceCleaning;
    const source: ProjectDataSource = {
      id: "source-mixed-cleaning",
      project_id: "project-1",
      kind: "file",
      name: "orders.csv",
      format: "csv",
      status: "ready",
      profile_data: {
        sample: [{ customer: " A ", amount: null }],
        visual_cleaning: {
          operations: [
            { operation: "fill_missing", column: "amount", value: 0 },
          ],
        },
      },
      created_at: "2026-07-19T00:00:00Z",
      updated_at: "2026-07-19T00:00:00Z",
    };
    const recipe: SanitationRecipe = {
      id: "recipe-mixed-cleaning",
      project_id: "project-1",
      data_source_id: source.id,
      name: "订单整理",
      status: "applied",
      operations: [
        { operation: "fill_missing", column: "amount", value: 0 },
        { operation: "trim_text", column: "customer" },
        { operation: "drop_exact_duplicates", count: 1 },
        { operation: "reapply_recipe", recipe_id: "recipe-mixed-cleaning" },
      ],
      created_at: "2026-07-19T00:00:00Z",
      updated_at: "2026-07-19T00:00:00Z",
    };
    const previewSourceCleaning = vi.fn(async () => ({
      source_id: source.id,
      operations_hash: "d".repeat(64),
      source_fingerprint: "a".repeat(64),
      preview_output_fingerprint: "b".repeat(64),
      current_working_fingerprint: null,
      current_recipe_active_revision_id: null,
      before: { rows: 2, columns: 2, sample: source.profile_data.sample || [] },
      after: { rows: 2, columns: 2, sample: source.profile_data.sample || [] },
      changes: [],
      can_apply: true,
    }));
    useProjectStore.setState({
      currentProjectId: "project-1",
      sources: [source],
      preflightReports: [],
      recipes: [recipe],
      knowledge: [],
      cleaningPreviewBySource: {},
      previewSourceCleaning,
    });

    try {
      render(
        <NextIntlClientProvider locale="zh" messages={messages}>
          <DataWorkspacePanel
            open
            onClose={vi.fn()}
            onConfigureConnection={vi.fn()}
            connections={[]}
          />
        </NextIntlClientProvider>
      );
      fireEvent.click(screen.getByRole("button", { name: "整理数据" }));

      expect(screen.getAllByText("导入时已整理")).toHaveLength(2);
      expect(screen.getByText("“customer” 去除首尾空格")).toBeInTheDocument();
      expect(screen.getByText("移除完全重复的行")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", {
          name: removeStepAria("“customer” 去除首尾空格"),
        })
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", {
          name: removeStepAria("“amount” 空值填 0"),
        })
      ).toBeEnabled();

      fireEvent.click(screen.getByRole("button", { name: /去除首尾空格/ }));
      expect(screen.getByText("这一步已在导入时完成。")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "预览变化" }));
      await waitFor(() =>
        expect(previewSourceCleaning).toHaveBeenCalledWith(source.id, [
          { operation: "fill_missing", column: "amount", value: 0 },
        ])
      );
    } finally {
      useProjectStore.setState({ previewSourceCleaning: originalPreview });
    }
  });

  it("opens the current cleaning method and can preview removing every step", async () => {
    const originalPreview = useProjectStore.getState().previewSourceCleaning;
    const originalClear = useProjectStore.getState().clearSourceCleaningPreview;
    const source: ProjectDataSource = {
      id: "source-existing-cleaning",
      project_id: "project-1",
      kind: "file",
      name: "sales.csv",
      format: "csv",
      status: "ready",
      profile_data: {
        sample: [{ amount: null }],
        visual_cleaning: {
          operations: [
            {
              operation: "fill_missing",
              column: "amount",
              value: 0,
              contract_version: 1,
            },
          ],
        },
      },
      created_at: "2026-07-19T00:00:00Z",
      updated_at: "2026-07-19T00:00:00Z",
    };
    const previewSourceCleaning = vi.fn(async () => ({
      source_id: source.id,
      operations_hash: "d".repeat(64),
      source_fingerprint: "a".repeat(64),
      preview_output_fingerprint: "b".repeat(64),
      current_working_fingerprint: null,
      current_recipe_active_revision_id: null,
      before: { rows: 1, columns: 1, sample: [{ amount: 0 }] },
      after: { rows: 1, columns: 1, sample: [{ amount: null }] },
      changes: [{ column: "amount", changed_count: 1 }],
      can_apply: true,
    }));
    const clearSourceCleaningPreview = vi.fn((sourceId: string) => {
      useProjectStore.setState((state) => ({
        cleaningPreviewBySource: Object.fromEntries(
          Object.entries(state.cleaningPreviewBySource).filter(
            ([id]) => id !== sourceId
          )
        ),
      }));
    });
    useProjectStore.setState({
      currentProjectId: "project-1",
      sources: [source],
      preflightReports: [],
      recipes: [],
      knowledge: [],
      cleaningPreviewBySource: {},
      previewSourceCleaning,
      clearSourceCleaningPreview,
    });

    try {
      render(
        <NextIntlClientProvider locale="zh" messages={messages}>
          <DataWorkspacePanel
            open
            onClose={vi.fn()}
            onConfigureConnection={vi.fn()}
            connections={[]}
          />
        </NextIntlClientProvider>
      );
      fireEvent.click(screen.getByRole("button", { name: "整理数据" }));

      expect(screen.getByText("“amount” 空值填 0")).toBeInTheDocument();
      fireEvent.click(
        screen.getByRole("button", {
          name: removeStepAria("“amount” 空值填 0"),
        })
      );
      expect(screen.getByText("已移除全部步骤。预览后可确认更新。")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "预览变化" }));

      await waitFor(() =>
        expect(previewSourceCleaning).toHaveBeenCalledWith(source.id, [])
      );
    } finally {
      useProjectStore.setState({
        previewSourceCleaning: originalPreview,
        clearSourceCleaningPreview: originalClear,
      });
    }
  });

  it("uses the localized preview fallback instead of an unknown API detail", async () => {
    const originalPreview = useProjectStore.getState().previewSourceCleaning;
    const source: ProjectDataSource = {
      id: "source-cleaning-too-large",
      project_id: "project-1",
      kind: "file",
      name: "large-orders.csv",
      format: "csv",
      status: "ready",
      profile_data: { sample: [{ amount: null }] },
      created_at: "2026-07-19T00:00:00Z",
      updated_at: "2026-07-19T00:00:00Z",
    };
    const previewSourceCleaning = vi.fn().mockRejectedValue({
      response: {
        data: {
          detail: "这份文件太大，暂时不能直接整理。请先拆分文件后再试。",
        },
      },
    });
    useProjectStore.setState({
      currentProjectId: "project-1",
      sources: [source],
      preflightReports: [],
      recipes: [],
      knowledge: [],
      cleaningPreviewBySource: {},
      previewSourceCleaning,
    });

    try {
      render(
        <NextIntlClientProvider locale="zh" messages={messages}>
          <DataWorkspacePanel
            open
            onClose={vi.fn()}
            onConfigureConnection={vi.fn()}
            connections={[]}
          />
        </NextIntlClientProvider>
      );
      fireEvent.click(screen.getByRole("button", { name: "整理数据" }));
      fireEvent.click(screen.getByRole("button", { name: /空值填 0/ }));
      fireEvent.click(screen.getByRole("button", { name: "预览变化" }));

      expect(
        await screen.findByText(messages.visualCleaning.previewFailed)
      ).toBeInTheDocument();
      expect(
        screen.queryByText("这份文件太大，暂时不能直接整理。请先拆分文件后再试。")
      ).not.toBeInTheDocument();
    } finally {
      useProjectStore.setState({ previewSourceCleaning: originalPreview });
    }
  });

  it("previews file cleaning, invalidates an old preview after edits, and applies", async () => {
    const originalPreview = useProjectStore.getState().previewSourceCleaning;
    const originalClear = useProjectStore.getState().clearSourceCleaningPreview;
    const originalApply = useProjectStore.getState().applySourceCleaning;
    const source: ProjectDataSource = {
      id: "source-cleaning",
      project_id: "project-1",
      kind: "file",
      name: "orders.csv",
      format: "csv",
      status: "ready",
      profile_data: {
        sample: [{ customer: " A ", amount: null, order_date: "2026/7/1" }],
      },
      created_at: "2026-07-19T00:00:00Z",
      updated_at: "2026-07-19T00:00:00Z",
    };
    const preview = {
      source_id: source.id,
      operations_hash: "d".repeat(64),
      source_fingerprint: "a".repeat(64),
      preview_output_fingerprint: "b".repeat(64),
      current_working_fingerprint: null,
      current_recipe_active_revision_id: null,
      before: {
        rows: 2,
        columns: 3,
        sample: [{ customer: " A ", amount: null, order_date: "2026/7/1" }],
      },
      after: {
        rows: 2,
        columns: 3,
        sample: [{ customer: " A ", amount: 0, order_date: "2026/7/1" }],
      },
      changes: [{ column: "amount", changed_count: 1 }],
      can_apply: true,
    };
    const previewSourceCleaning = vi.fn(async () => {
      act(() => {
        useProjectStore.setState({
          cleaningPreviewBySource: { [source.id]: preview },
        });
      });
      return preview;
    });
    const clearSourceCleaningPreview = vi.fn((sourceId: string) => {
      act(() => {
        useProjectStore.setState((state) => ({
          cleaningPreviewBySource: Object.fromEntries(
            Object.entries(state.cleaningPreviewBySource).filter(
              ([id]) => id !== sourceId
            )
          ),
        }));
      });
    });
    const applySourceCleaning = vi.fn(async () => ({
      recipe: {} as never,
      revision: {} as never,
      preflight: {} as never,
    }));
    useProjectStore.setState({
      currentProjectId: "project-1",
      sources: [source],
      preflightReports: [],
      recipes: [],
      knowledge: [],
      cleaningPreviewBySource: {},
      cleaningAction: null,
      previewSourceCleaning,
      clearSourceCleaningPreview,
      applySourceCleaning,
    });

    try {
      render(
        <NextIntlClientProvider locale="zh" messages={messages}>
          <DataWorkspacePanel
            open
            onClose={vi.fn()}
            onConfigureConnection={vi.fn()}
            connections={[]}
          />
        </NextIntlClientProvider>
      );

      fireEvent.click(screen.getByRole("button", { name: "整理数据" }));
      fireEvent.change(screen.getByLabelText("选择要整理的列"), {
        target: { value: "amount" },
      });
      fireEvent.click(screen.getByRole("button", { name: /空值填 0/ }));
      fireEvent.click(screen.getByRole("button", { name: "预览变化" }));

      await waitFor(() =>
        expect(previewSourceCleaning).toHaveBeenCalledWith(source.id, [
          { operation: "fill_missing", column: "amount", value: 0 },
        ])
      );
      expect(
        screen.getByRole("region", { name: messages.visualCleaning.previewAria })
      ).toHaveTextContent("1 个单元格会变化");
      expect(screen.getByText("整理前")).toBeInTheDocument();
      expect(screen.getByText("整理后")).toBeInTheDocument();
      expect(screen.queryByText("d".repeat(64))).not.toBeInTheDocument();
      expect(screen.queryByText(/operations|fingerprint|python|sql/i)).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /统一金额/ }));
      expect(clearSourceCleaningPreview).toHaveBeenLastCalledWith(source.id);
      expect(
        screen.queryByRole("region", { name: messages.visualCleaning.previewAria })
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "预览变化" }));
      await screen.findByRole("button", { name: "应用整理" });
      fireEvent.click(screen.getByRole("button", { name: "应用整理" }));
      await waitFor(() =>
        expect(applySourceCleaning).toHaveBeenCalledWith(source.id, [
          { operation: "fill_missing", column: "amount", value: 0 },
          { operation: "normalize_currency", column: "amount" },
        ])
      );
    } finally {
      useProjectStore.setState({
        previewSourceCleaning: originalPreview,
        clearSourceCleaningPreview: originalClear,
        applySourceCleaning: originalApply,
      });
    }
  });

  it("does not offer visual cleaning for database connections", () => {
    useProjectStore.setState({
      currentProjectId: "project-1",
      sources: [
        {
          id: "source-db",
          project_id: "project-1",
          connection_id: "connection-1",
          kind: "connection",
          name: "业务数据库",
          status: "ready",
          profile_data: { sample: [{ amount: 10 }] },
          created_at: "2026-07-19T00:00:00Z",
          updated_at: "2026-07-19T00:00:00Z",
        },
      ],
      preflightReports: [],
      recipes: [],
      knowledge: [],
    });

    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <DataWorkspacePanel
          open
          onClose={vi.fn()}
          onConfigureConnection={vi.fn()}
          connections={[]}
        />
      </NextIntlClientProvider>
    );

    expect(screen.queryByRole("button", { name: "整理数据" })).not.toBeInTheDocument();
  });

  it("previews an imported cleaning method before offering to apply it", async () => {
    const originalPreviewRecipeTemplate = useProjectStore.getState().previewRecipeTemplate;
    const originalBindRecipeTemplate = useProjectStore.getState().bindRecipeTemplate;
    const source: ProjectDataSource = {
      id: "source-1",
      project_id: "project-1",
      kind: "file",
      name: "orders.csv",
      format: "csv",
      status: "ready",
      profile_data: { is_current: true },
      created_at: "2026-07-18T00:00:00Z",
      updated_at: "2026-07-18T00:00:00Z",
    };
    const preview: SanitationTemplatePreview = {
      template_id: "template-1",
      template_name: "每月订单整理",
      template_active_revision_id: "template-revision-1",
      template_operations_hash: "d".repeat(64),
      source_id: source.id,
      source_fingerprint: "a".repeat(64),
      preview_output_fingerprint: "b".repeat(64),
      current_working_fingerprint: "c".repeat(64),
      current_recipe_active_revision_id: "recipe-revision-1",
      before: { rows: 126, columns: 9 },
      after: { rows: 120, columns: 9 },
      summary: "已完成试运行",
      issues: [
        {
          code: "drop_exact_duplicates",
          title: "已排除 6 条完全重复记录",
          detail: "重复记录未进入分析副本",
          severity: "info",
          automatic: true,
        },
      ],
      can_apply: true,
    };
    const previewRecipeTemplate = vi.fn(async () => {
      act(() => {
        useProjectStore.setState({
          recipeTemplatePreviewById: { "template-1": preview },
        });
      });
      return preview;
    });
    const bindRecipeTemplate = vi.fn(async () => undefined);
    useProjectStore.setState({
      currentProjectId: "project-1",
      sources: [source],
      preflightReports: [],
      recipeTemplates: [
        {
          id: "template-1",
          name: "每月订单整理",
          active_revision_id: "template-revision-1",
          revision_count: 3,
          compatible_source_ids: [source.id],
        },
      ],
      recipeTemplatePreviewById: {},
      knowledge: [],
      previewRecipeTemplate,
      bindRecipeTemplate,
    });

    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <DataWorkspacePanel
          open
          onClose={vi.fn()}
          onConfigureConnection={vi.fn()}
          connections={[]}
        />
      </NextIntlClientProvider>
    );

    expect(screen.getByText("项目记住的整理方法")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "使用这套方法" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "看看会有什么变化" }));
    await waitFor(() =>
      expect(previewRecipeTemplate).toHaveBeenCalledWith("template-1", source.id)
    );

    expect(screen.getByText("126 行 · 9 项内容")).toBeInTheDocument();
    expect(screen.getByText("120 行 · 9 项内容")).toBeInTheDocument();
    expect(screen.getByText(/会排除 6 行不进入分析/)).toBeInTheDocument();
    expect(screen.getByText("当前分析数据尚未改变。")).toBeInTheDocument();
    expect(screen.queryByText("a".repeat(64))).not.toBeInTheDocument();
    expect(screen.queryByText(/fingerprint|operations|recipe/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "使用这套方法" }));
    await waitFor(() => expect(bindRecipeTemplate).toHaveBeenCalledWith("template-1"));
    act(() => {
      useProjectStore.setState({
        previewRecipeTemplate: originalPreviewRecipeTemplate,
        bindRecipeTemplate: originalBindRecipeTemplate,
      });
    });
  });


  it("turns a pending replacement into clear, explicit lifecycle actions", async () => {
    const originalAcceptReplacement = useProjectStore.getState().acceptReplacement;
    const originalKeepTrustedSource = useProjectStore.getState().keepTrustedSource;
    const acceptReplacement = vi.fn(async () => undefined);
    const keepTrustedSource = vi.fn(async () => undefined);
    const source: ProjectDataSource = {
      id: "source-new",
      project_id: "project-1",
      kind: "file",
      name: "orders-august.csv",
      format: "csv",
      status: "needs_confirmation",
      profile_data: {
        summary: "沿用上期整理方法时发现结构变化",
        is_current: false,
        replacement_of: "source-old",
        activation_state: "pending_confirmation",
      },
      created_at: "2026-07-18T00:00:00Z",
      updated_at: "2026-07-18T00:00:00Z",
    };
    useProjectStore.setState({
      currentProjectId: "project-1",
      sources: [source],
      preflightReports: [
        {
          id: "report-1",
          project_id: "project-1",
          data_source_id: source.id,
          status: "needs_confirmation",
          summary: "结构变化需要确认，当前继续使用上个可信版本",
          issues: [
            {
              code: "schema_drift",
              title: "沿用上期整理方法时发现结构变化",
              detail: "缺少字段：amount",
              severity: "warning",
              automatic: false,
            },
          ],
          ambiguities: [],
          source_snapshot: {
            schema_drift: { removed_columns: ["amount"], requires_confirmation: true },
            replacement: {
              status: "pending_confirmation",
              replaces_source_id: "source-old",
              active_source_id: "source-old",
            },
          },
          created_at: "2026-07-18T00:00:00Z",
        },
      ],
      knowledge: [],
      acceptReplacement,
      keepTrustedSource,
    });

    try {
      render(
        <NextIntlClientProvider locale="zh" messages={messages}>
          <DataWorkspacePanel
            open
            onClose={vi.fn()}
            onConfigureConnection={vi.fn()}
            connections={[]}
          />
        </NextIntlClientProvider>
      );

      const acceptButton = screen.getByRole("button", {
        name: "接受这版并用于以后",
      });
      const keepButton = screen.getByRole("button", {
        name: "继续使用上个可信版本",
      });
      const retryButton = screen.getByRole("button", { name: "重新整理" });

      expect(screen.getByText("等你选择")).toBeInTheDocument();
      expect(screen.getByText(/这版数据还没有用于分析/)).toBeInTheDocument();
      expect(acceptButton).toBeInTheDocument();
      expect(keepButton).toBeInTheDocument();
      expect(retryButton).toHaveAttribute(
        "title",
        "只会重新检查和整理，不会启用这版数据"
      );
      expect(screen.getByRole("button", { name: "查看变化" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "移除来源" })).toBeInTheDocument();
      expect(screen.queryByText("本期缺少：amount")).not.toBeInTheDocument();
      expect(screen.queryByText(/recipe|schema/i)).not.toBeInTheDocument();

      act(() => {
        useProjectStore.setState({
          sourceAction: { sourceId: source.id, kind: "accept_replacement" },
        });
      });
      expect(acceptButton).toBeDisabled();
      expect(keepButton).toBeDisabled();
      expect(retryButton).toBeDisabled();
      act(() => useProjectStore.setState({ sourceAction: null }));

      fireEvent.click(acceptButton);
      await waitFor(() => expect(acceptReplacement).toHaveBeenCalledWith(source.id));
      expect(
        await screen.findByText(/已接受这版；今后的调查会使用它/)
      ).toBeInTheDocument();

      fireEvent.click(keepButton);
      await waitFor(() => expect(keepTrustedSource).toHaveBeenCalledWith(source.id));

      fireEvent.click(screen.getByRole("button", { name: "查看变化" }));
      expect(screen.getByText("本期缺少：金额")).toBeInTheDocument();
      expect(
        screen.queryByText(/原始文件和数据库保持不变/)
      ).not.toBeInTheDocument();
      expect(screen.getByText("使用只读连接查询现有数据。")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "移除来源" }));
      expect(screen.getByRole("button", { name: "确认移除" })).toBeInTheDocument();
      expect(
        screen.getByText("移除后，这个来源将不再出现在当前项目中。"),
      ).toBeInTheDocument();
    } finally {
      useProjectStore.setState({
        acceptReplacement: originalAcceptReplacement,
        keepTrustedSource: originalKeepTrustedSource,
      });
    }
  });





  it("shows cleaning history in plain language and restores without changing data immediately", async () => {
    const originalLoadRecipeRevisions = useProjectStore.getState().loadRecipeRevisions;
    const originalRestoreRecipeRevision = useProjectStore.getState().restoreRecipeRevision;
    const source: ProjectDataSource = {
      id: "source-1",
      project_id: "project-1",
      kind: "file",
      name: "orders.csv",
      format: "csv",
      status: "ready",
      profile_data: { summary: "数据已准备好", is_current: true },
      created_at: "2026-07-17T00:00:00Z",
      updated_at: "2026-07-18T00:00:00Z",
    };
    const recipe: SanitationRecipe = {
      id: "recipe-1",
      project_id: "project-1",
      data_source_id: source.id,
      name: "订单自动整理",
      status: "applied",
      operations: [],
      active_revision_id: "recipe-revision-2",
      created_at: "2026-07-17T00:00:00Z",
      updated_at: "2026-07-18T00:00:00Z",
    };
    const revisions: SanitationRecipeRevision[] = [
      {
        id: "recipe-revision-2",
        recipe_id: recipe.id,
        revision_number: 2,
        parent_revision_id: "recipe-revision-1",
        state: "confirmed",
        operations: [],
        input_contract: {},
        output_contract: {},
        actor_source: "system",
        reason: "重新执行并核对整理方法",
        created_at: "2026-07-18T08:00:00Z",
      },
      {
        id: "recipe-revision-1",
        recipe_id: recipe.id,
        revision_number: 1,
        parent_revision_id: null,
        state: "confirmed",
        operations: [],
        input_contract: {},
        output_contract: {},
        actor_source: "system",
        reason: "首次自动整理并核对完成",
        created_at: "2026-07-17T08:00:00Z",
      },
    ];
    const loadRecipeRevisions = vi.fn(async () => {
      useProjectStore.setState({
        recipeRevisionsByRecipe: { [recipe.id]: revisions },
        recipeRevisionLoadingByRecipe: { [recipe.id]: false },
      });
      return revisions;
    });
    const restoreRecipeRevision = vi.fn(async () => {
      const restored: SanitationRecipeRevision = {
        ...revisions[0],
        id: "recipe-revision-3",
        revision_number: 3,
        parent_revision_id: "recipe-revision-2",
        state: "reverted",
        reason: "恢复首次方法",
      };
      useProjectStore.setState({
        recipes: [
          {
            ...recipe,
            status: "reverted",
            active_revision_id: restored.id,
          },
        ],
        recipeRevisionsByRecipe: {
          [recipe.id]: [restored, ...revisions],
        },
      });
      return restored;
    });
    useProjectStore.setState({
      currentProjectId: "project-1",
      sources: [source],
      preflightReports: [],
      recipes: [recipe],
      recipeRevisionsByRecipe: {},
      recipeRevisionLoadingByRecipe: {},
      recipeRevisionRestoringByRecipe: {},
      recipeRevisionErrorByRecipe: {},
      knowledge: [],
      loadRecipeRevisions,
      restoreRecipeRevision,
    });

    try {
      render(
        <NextIntlClientProvider locale="zh" messages={messages}>
          <DataWorkspacePanel
            open
            onClose={vi.fn()}
            onConfigureConnection={vi.fn()}
            connections={[]}
          />
        </NextIntlClientProvider>
      );

      fireEvent.click(screen.getByRole("button", { name: /整理方法记录/ }));
      expect(loadRecipeRevisions).toHaveBeenCalledWith(recipe.id);
      expect(await screen.findByText("首次自动整理并核对完成")).toBeInTheDocument();
      expect(screen.queryByText(/contract_version|operations|fingerprint/)).not.toBeInTheDocument();

      fireEvent.click(
        screen.getByRole("button", { name: /恢复 .* 的整理方法/ })
      );
      expect(screen.getByText(/不会立刻改变当前分析/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "确认恢复" }));

      expect(restoreRecipeRevision).toHaveBeenCalledWith(
        recipe.id,
        "recipe-revision-1"
      );
      expect(await screen.findByText(/点击“重新应用”后才会用于当前分析/)).toBeInTheDocument();
      expect(screen.getByText("待重新应用")).toBeInTheDocument();
    } finally {
      useProjectStore.setState({
        loadRecipeRevisions: originalLoadRecipeRevisions,
        restoreRecipeRevision: originalRestoreRecipeRevision,
      });
    }
  });

  it("maps known and unknown preflight issues into the active English locale", () => {
    const numberFormat = vi.spyOn(Number.prototype, "toLocaleString");
    const source: ProjectDataSource = {
      id: "source-english-issues",
      project_id: "project-1",
      kind: "file",
      name: "orders.csv",
      format: "csv",
      status: "ready",
      profile_data: { sample: [{ amount: "invalid" }] },
      created_at: "2026-07-19T00:00:00Z",
      updated_at: "2026-07-19T00:00:00Z",
    };
    useProjectStore.setState({
      currentProjectId: "project-1",
      sources: [source],
      preflightReports: [
        {
          id: "report-english-issues",
          project_id: "project-1",
          data_source_id: source.id,
          status: "ready",
          summary: "服务端固定中文摘要",
          issues: [
            {
              code: "invalid_currency_values",
              title: "amount 中有 1234 个金额无法识别",
              detail: "服务端固定中文详情",
              severity: "warning",
              automatic: false,
              count: 1234,
            },
            {
              code: "future_system_issue",
              title: "未知的服务端中文问题",
              detail: "不应直接显示",
              severity: "warning",
              automatic: false,
            },
            {
              code: "another_future_system_issue",
              title: "另一个未知的服务端中文问题",
              detail: "不应重复显示相同的业务提示",
              severity: "warning",
              automatic: false,
            },
          ],
          ambiguities: [],
          source_snapshot: {
            summary_code: "file_preflight",
            summary_facts: {
              rows: 1234,
              columns: 7,
              automatic_issue_count: 0,
              ambiguity_count: 0,
              recipe_step_count: 0,
              recipe_drift_count: 0,
            },
          },
          created_at: "2026-07-19T00:00:00Z",
        },
      ],
      recipes: [],
      knowledge: [],
    });

    try {
      render(
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <DataWorkspacePanel
            open
            onClose={vi.fn()}
            onConfigureConnection={vi.fn()}
            connections={[]}
          />
        </NextIntlClientProvider>
      );

      expect(
        screen.getByText("amount has 1,234 amounts that cannot be recognized")
      ).toBeInTheDocument();
      expect(
        screen.getAllByText("A data preparation item needs your review"),
      ).toHaveLength(1);
      expect(
        screen.getByText("Data ready: 1,234 rows · 7 columns")
      ).toBeInTheDocument();
      expect(screen.queryByText("服务端固定中文摘要")).not.toBeInTheDocument();
      expect(screen.queryByText("未知的服务端中文问题")).not.toBeInTheDocument();
      expect(numberFormat).toHaveBeenCalledWith("en");
    } finally {
      numberFormat.mockRestore();
    }
  });

  it("renders file and database preflight summaries from facts in Chinese", () => {
    const sources: ProjectDataSource[] = [
      {
        id: "source-file-summary-zh",
        project_id: "project-1",
        kind: "file",
        name: "orders.csv",
        format: "csv",
        status: "ready",
        profile_data: {},
        created_at: "2026-07-19T00:00:00Z",
        updated_at: "2026-07-19T00:00:00Z",
      },
      {
        id: "source-database-summary-zh",
        project_id: "project-1",
        kind: "connection",
        connection_id: "connection-1",
        name: "warehouse",
        status: "ready",
        profile_data: {
          relation_index: {
            relations: [],
            relations_loaded: 12,
            relations_total: 12,
            relations_total_at_least: 12,
            complete: true,
            truncated: false,
            unread_relations_at_least: 0,
          },
        },
        created_at: "2026-07-19T00:00:00Z",
        updated_at: "2026-07-19T00:00:00Z",
      },
    ];
    useProjectStore.setState({
      currentProjectId: "project-1",
      sources,
      preflightReports: [
        {
          id: "report-file-summary-zh",
          project_id: "project-1",
          data_source_id: sources[0].id,
          status: "ready",
          summary: "persisted English summary must not be displayed",
          issues: [],
          ambiguities: [],
          source_snapshot: {
            summary_code: "file_preflight",
            summary_facts: {
              rows: 28,
              columns: 6,
              automatic_issue_count: 0,
              ambiguity_count: 0,
            },
          },
          created_at: "2026-07-19T00:00:00Z",
        },
        {
          id: "report-database-summary-zh",
          project_id: "project-1",
          data_source_id: sources[1].id,
          status: "ready",
          summary: "persisted English database summary must not be displayed",
          issues: [],
          ambiguities: [],
          source_snapshot: {
            preanalysis: {
              summary_code: "database_value_preflight",
              summary_facts: {
                profiled_tables: 3,
                profiled_columns: 19,
                status: "partial",
                partial: true,
              },
            },
          },
          created_at: "2026-07-19T00:00:00Z",
        },
      ],
    });

    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <DataWorkspacePanel
          open
          onClose={vi.fn()}
          onConfigureConnection={vi.fn()}
          connections={[]}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText("数据已准备好：28 行 · 6 列")).toBeInTheDocument();
    expect(screen.getByText("已发现 12 张表 · 已检查 3 张")).toBeInTheDocument();
    expect(screen.queryByText(/persisted English/)).not.toBeInTheDocument();
  });

  it("does not expose a cross-language legacy preflight summary", () => {
    const source: ProjectDataSource = {
      id: "source-legacy-summary",
      project_id: "project-1",
      kind: "file",
      name: "orders.csv",
      format: "csv",
      status: "ready",
      profile_data: { summary: "旧版中文预检摘要" },
      created_at: "2026-07-19T00:00:00Z",
      updated_at: "2026-07-19T00:00:00Z",
    };
    useProjectStore.setState({
      currentProjectId: "project-1",
      sources: [source],
      preflightReports: [],
    });

    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <DataWorkspacePanel
          open
          onClose={vi.fn()}
          onConfigureConnection={vi.fn()}
          connections={[]}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText("The data has been prepared for analysis")).toBeInTheDocument();
    expect(screen.queryByText("旧版中文预检摘要")).not.toBeInTheDocument();
    cleanup();

    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <DataWorkspacePanel
          open
          onClose={vi.fn()}
          onConfigureConnection={vi.fn()}
          connections={[]}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("旧版中文预检摘要")).toBeInTheDocument();
  });

  it("does not expose an unknown Chinese cleaning error in the English editor", async () => {
    const originalPreview = useProjectStore.getState().previewSourceCleaning;
    const source: ProjectDataSource = {
      id: "source-english-cleaning-error",
      project_id: "project-1",
      kind: "file",
      name: "orders.csv",
      format: "csv",
      status: "ready",
      profile_data: { sample: [{ amount: null }] },
      created_at: "2026-07-19T00:00:00Z",
      updated_at: "2026-07-19T00:00:00Z",
    };
    const previewSourceCleaning = vi.fn().mockRejectedValue({
      response: { data: { detail: "服务端固定中文错误" } },
    });
    useProjectStore.setState({
      currentProjectId: "project-1",
      sources: [source],
      preflightReports: [],
      recipes: [],
      knowledge: [],
      cleaningPreviewBySource: {},
      previewSourceCleaning,
    });

    try {
      render(
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <DataWorkspacePanel
            open
            onClose={vi.fn()}
            onConfigureConnection={vi.fn()}
            connections={[]}
          />
        </NextIntlClientProvider>
      );
      fireEvent.click(screen.getByRole("button", { name: "Clean data" }));
      fireEvent.click(screen.getByRole("button", { name: /Fill blanks with 0/ }));
      fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));

      expect(
        await screen.findByText("Could not preview, please retry.")
      ).toBeInTheDocument();
      expect(screen.queryByText("服务端固定中文错误")).not.toBeInTheDocument();
    } finally {
      useProjectStore.setState({ previewSourceCleaning: originalPreview });
    }
  });
});
