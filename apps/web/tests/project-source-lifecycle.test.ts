import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  api: mocks,
}));

import { useProjectStore } from "@/lib/stores/project";

function mockWorkspaceRefresh(projectId = "project-1") {
  mocks.get.mockImplementation((url: string) => {
    if (url === `/api/v1/projects/${projectId}/recipes`) {
      return Promise.resolve({
        data: { data: [{ id: "recipe-1", data_source_id: "source-1" }] },
      });
    }
    if (url === `/api/v1/projects/${projectId}/sources`) {
      return Promise.resolve({ data: { data: [] } });
    }
    if (url === `/api/v1/projects/${projectId}/preflight`) {
      return Promise.resolve({ data: { data: [] } });
    }
    if (url === `/api/v1/projects/${projectId}/knowledge/page`) {
      return Promise.resolve({ data: { data: { items: [] } } });
    }
    if (url === `/api/v1/projects/${projectId}/knowledge/summary`) {
      return Promise.resolve({
        data: {
          data: {
            active_total: 0,
            pending_total: 0,
            relationship_total: 0,
            confirmed_total: 0,
            locked_total: 0,
          },
        },
      });
    }
    if (url === `/api/v1/projects/${projectId}/recipe-templates`) {
      return Promise.resolve({ data: { data: [] } });
    }
    throw new Error(`unexpected URL ${url}`);
  });
}

describe("project source lifecycle actions", () => {
  beforeEach(() => {
    document.documentElement.lang = "zh-CN";
    mocks.get.mockReset();
    mocks.post.mockReset();
    mocks.delete.mockReset();
    mocks.post.mockResolvedValue({ data: { data: {} } });
    mocks.delete.mockResolvedValue({ data: { data: { removed: true } } });
    useProjectStore.setState({
      currentProjectId: "project-1",
      sources: [],
      preflightReports: [],
      knowledge: [],
      knowledgeTotal: 0,
      pendingKnowledgeCount: 0,
      relationshipKnowledgeCount: 0,
      recipeTemplates: [],
      recipeTemplatePreviewById: {},
      recipeTemplateAction: null,
      cleaningPreviewBySource: {},
      cleaningAction: null,
      sourceAction: null,
      error: null,
    });
    mockWorkspaceRefresh();
  });

  it("retires suggestions only after a current project refresh is accepted", async () => {
    useProjectStore.setState({ suggestedQuestionsRevisionByProject: { "project-1": 7, "project-2": 3 } });
    await useProjectStore.getState().refreshCurrent();
    expect(useProjectStore.getState().suggestedQuestionsRevisionByProject).toEqual({ "project-1": 8, "project-2": 3 });
    let finish!: (value: unknown) => void;
    mocks.get.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const staleRefresh = useProjectStore.getState().refreshCurrent();
    useProjectStore.setState({ currentProjectId: "project-2" });
    finish({ data: { data: [] } });
    await staleRefresh;
    expect(useProjectStore.getState().suggestedQuestionsRevisionByProject).toEqual({ "project-1": 8, "project-2": 3 });
    useProjectStore.setState({ currentProjectId: "project-1" });
    mocks.get.mockRejectedValueOnce(new Error("refresh unavailable"));
    await useProjectStore.getState().refreshCurrent();
    expect(useProjectStore.getState().suggestedQuestionsRevisionByProject["project-1"]).toBe(8);
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("never starts preflight while adding a file or connection", async () => {
    await useProjectStore
      .getState()
      .uploadFile(new File(["id,amount\n1,10"], "orders.csv", { type: "text/csv" }));
    await useProjectStore
      .getState()
      .attachConnection("connection-1", "经营库");

    expect(mocks.post).toHaveBeenCalledWith(
      "/api/v1/projects/project-1/sources/files",
      expect.any(FormData),
      {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 120000,
      }
    );
    expect(mocks.post).toHaveBeenCalledWith(
      "/api/v1/projects/project-1/sources/connections",
      { connection_id: "connection-1", name: "经营库" }
    );
    expect(
      mocks.post.mock.calls.some(([url]) =>
        String(url).endsWith("/preflight")
      )
    ).toBe(false);
  });

  it("replays the stored sanitation recipe when reorganizing", async () => {
    await useProjectStore.getState().reorganizeSource("source-1");

    expect(mocks.post).toHaveBeenCalledWith(
      "/api/v1/projects/project-1/recipes/recipe-1/reapply",
      undefined,
      { timeout: 120000 }
    );
    expect(useProjectStore.getState().sourceAction).toBeNull();
  });

  it("only switches to a replacement through the explicit accept action", async () => {
    await useProjectStore.getState().acceptReplacement("source-1");

    expect(mocks.post).toHaveBeenCalledWith(
      "/api/v1/projects/project-1/sources/source-1/accept-replacement"
    );
    expect(mocks.get).toHaveBeenCalledWith(
      "/api/v1/projects/project-1/sources"
    );
    expect(mocks.get).toHaveBeenCalledWith(
      "/api/v1/projects/project-1/preflight"
    );
    expect(mocks.get).toHaveBeenCalledWith(
      "/api/v1/projects/project-1/knowledge/page",
      { params: { offset: 0, limit: 100, business_facing_only: true } }
    );
    expect(mocks.get).toHaveBeenCalledWith(
      "/api/v1/projects/project-1/knowledge/summary"
    );
    expect(useProjectStore.getState().sourceAction).toBeNull();
    expect(useProjectStore.getState().error).toBeNull();
  });

  it("keeps the accept action busy and reports a rejected switch truthfully", async () => {
    let rejectAccept!: (reason: unknown) => void;
    mocks.post.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectAccept = reject;
        })
    );

    const accepting = useProjectStore.getState().acceptReplacement("source-1");
    expect(useProjectStore.getState().sourceAction).toEqual({
      sourceId: "source-1",
      kind: "accept_replacement",
    });

    rejectAccept({
      response: {
        status: 409,
        data: { detail: "上一个成功版本已经变化，请重新整理后再确认" },
      },
    });
    await expect(accepting).rejects.toBeDefined();

    expect(useProjectStore.getState().sourceAction).toBeNull();
    expect(useProjectStore.getState().error).toBe("请求未能完成，请重试。");
    expect(useProjectStore.getState().error).not.toContain("上一个成功版本");
  });

  it("uses undo for the previous trusted version and delete for removal", async () => {
    await useProjectStore.getState().keepTrustedSource("source-1");
    expect(mocks.post).toHaveBeenCalledWith(
      "/api/v1/projects/project-1/recipes/recipe-1/undo"
    );

    await useProjectStore.getState().removeSource("source-1");
    expect(mocks.delete).toHaveBeenCalledWith(
      "/api/v1/projects/project-1/sources/source-1"
    );
    expect(useProjectStore.getState().sourceAction).toBeNull();
  });

  it("keeps backend and transport detail out of the product surface", async () => {
    mocks.post.mockRejectedValueOnce({
      message: "Request failed with status code 409",
      response: {
        status: 409,
        data: { detail: "这份数据暂时没有整理成功，可以重新整理或移除来源" },
      },
    });

    await expect(
      useProjectStore.getState().reorganizeSource("source-1")
    ).rejects.toBeDefined();

    expect(useProjectStore.getState().error).toBe("请求未能完成，请重试。");
    expect(useProjectStore.getState().error).not.toContain("重新整理或移除来源");
  });

  it("previews an imported method before binding the exact reviewed state", async () => {
    const preview = {
      template_id: "template-1",
      template_name: "每月订单整理",
      template_active_revision_id: "template-revision-1",
      template_operations_hash: "d".repeat(64),
      source_id: "source-1",
      source_fingerprint: "a".repeat(64),
      preview_output_fingerprint: "b".repeat(64),
      current_working_fingerprint: "c".repeat(64),
      current_recipe_active_revision_id: "recipe-revision-1",
      before: { rows: 126, columns: 9 },
      after: { rows: 120, columns: 9 },
      summary: "已完成试运行",
      issues: [],
      can_apply: true,
    };
    mocks.post.mockImplementation((url: string) => {
      if (url.endsWith("/preview")) {
        return Promise.resolve({ data: { data: preview } });
      }
      if (url.endsWith("/bind")) {
        return Promise.resolve({ data: { data: {} } });
      }
      return Promise.resolve({ data: { data: {} } });
    });

    await useProjectStore
      .getState()
      .previewRecipeTemplate("template-1", "source-1");
    expect(mocks.post).toHaveBeenCalledWith(
      "/api/v1/projects/project-1/recipe-templates/template-1/preview",
      { source_id: "source-1" },
      { timeout: 120000 }
    );
    expect(useProjectStore.getState().recipeTemplatePreviewById["template-1"]).toEqual(
      preview
    );

    await useProjectStore.getState().bindRecipeTemplate("template-1");
    expect(mocks.post).toHaveBeenCalledWith(
      "/api/v1/projects/project-1/recipe-templates/template-1/bind",
      {
        source_id: "source-1",
        expected_template_active_revision_id: "template-revision-1",
        expected_template_operations_hash: "d".repeat(64),
        expected_source_fingerprint: "a".repeat(64),
        expected_preview_output_fingerprint: "b".repeat(64),
        expected_current_working_fingerprint: "c".repeat(64),
        expected_current_recipe_active_revision_id: "recipe-revision-1",
      },
      { timeout: 120000 }
    );
    expect(useProjectStore.getState().recipeTemplatePreviewById["template-1"]).toBeUndefined();
  });

  it("previews visual cleaning and applies the exact reviewed receipt", async () => {
    const operations = [
      { operation: "trim_text" as const, column: "customer" },
      { operation: "fill_missing" as const, column: "amount", value: 0 as const },
      { operation: "drop_exact_duplicates" as const },
    ];
    const preview = {
      source_id: "source-1",
      operations_hash: "d".repeat(64),
      source_fingerprint: "a".repeat(64),
      preview_output_fingerprint: "b".repeat(64),
      current_working_fingerprint: "c".repeat(64),
      current_recipe_active_revision_id: "recipe-revision-1",
      before: {
        rows: 3,
        columns: 2,
        sample: [{ customer: " A ", amount: null }],
      },
      after: {
        rows: 2,
        columns: 2,
        sample: [{ customer: "A", amount: 0 }],
      },
      changes: [
        { column: "customer", changed_count: 1 },
        { column: "amount", changed_count: 1 },
      ],
      can_apply: true,
    };
    mocks.post.mockImplementation((url: string) => {
      if (url.endsWith("/cleaning/preview")) {
        return Promise.resolve({ data: { data: preview } });
      }
      if (url.endsWith("/cleaning/apply")) {
        return Promise.resolve({
          data: {
            data: { recipe: {}, revision: {}, preflight: {} },
          },
        });
      }
      return Promise.resolve({ data: { data: {} } });
    });

    await useProjectStore
      .getState()
      .previewSourceCleaning("source-1", operations);

    expect(mocks.post).toHaveBeenCalledWith(
      "/api/v1/projects/project-1/sources/source-1/cleaning/preview",
      { operations },
      { timeout: 120000 }
    );
    expect(useProjectStore.getState().cleaningPreviewBySource["source-1"]).toEqual(
      preview
    );

    await useProjectStore
      .getState()
      .applySourceCleaning("source-1", operations);

    expect(mocks.post).toHaveBeenCalledWith(
      "/api/v1/projects/project-1/sources/source-1/cleaning/apply",
      {
        operations,
        expected_operations_hash: "d".repeat(64),
        expected_source_fingerprint: "a".repeat(64),
        expected_preview_output_fingerprint: "b".repeat(64),
        expected_current_working_fingerprint: "c".repeat(64),
        expected_current_recipe_active_revision_id: "recipe-revision-1",
      },
      { timeout: 120000 }
    );
    expect(useProjectStore.getState().cleaningPreviewBySource["source-1"]).toBeUndefined();
    expect(mocks.get).toHaveBeenCalledWith(
      "/api/v1/projects/project-1/sources"
    );
  });

  it("keeps a successful cleaning apply successful when refresh fails", async () => {
    const originalRefreshCurrent = useProjectStore.getState().refreshCurrent;
    const operations = [
      { operation: "fill_missing" as const, column: "amount", value: 0 as const },
    ];
    const refreshCurrent = vi.fn().mockRejectedValue(new Error("refresh failed"));
    useProjectStore.setState({
      refreshCurrent,
      cleaningPreviewBySource: {
        "source-1": {
          source_id: "source-1",
          operations_hash: "d".repeat(64),
          source_fingerprint: "a".repeat(64),
          preview_output_fingerprint: "b".repeat(64),
          current_working_fingerprint: null,
          current_recipe_active_revision_id: null,
          before: { rows: 1, columns: 1, sample: [{ amount: null }] },
          after: { rows: 1, columns: 1, sample: [{ amount: 0 }] },
          changes: [{ column: "amount", changed_count: 1 }],
          can_apply: true,
        },
      },
    });
    mocks.post.mockResolvedValue({
      data: { data: { recipe: {}, revision: {}, preflight: {} } },
    });

    try {
      await expect(
        useProjectStore.getState().applySourceCleaning("source-1", operations)
      ).resolves.toEqual({ recipe: {}, revision: {}, preflight: {} });
      expect(refreshCurrent).toHaveBeenCalledTimes(1);
      expect(
        useProjectStore.getState().cleaningPreviewBySource["source-1"]
      ).toBeUndefined();
      expect(useProjectStore.getState().cleaningAction).toBeNull();
      expect(useProjectStore.getState().error).toBeNull();
    } finally {
      useProjectStore.setState({ refreshCurrent: originalRefreshCurrent });
    }
  });
});
