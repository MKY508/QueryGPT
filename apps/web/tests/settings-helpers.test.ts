import { describe, expect, it } from "vitest";
import {
  applyDriverDefaults,
  buildConnectionExportName,
  buildConnectionFormData,
  defaultConnectionFormData,
} from "@/lib/settings/connections";
import {
  buildModelFormData,
  buildModelPayload,
  parseJsonMap,
} from "@/lib/settings/models";
import {
  buildLayoutSnapshot,
  buildRelationshipEdges,
  buildSchemaNodes,
  deriveHiddenTables,
  filterVisibleTables,
} from "@/lib/settings/schema";

describe("settings helpers", () => {
  it("parses JSON map and normalizes values to strings", () => {
    expect(parseJsonMap('{"x-test": 1}', "Headers")).toEqual({ "x-test": "1" });
  });

  it("builds model payload with normalized fields", () => {
    const payload = buildModelPayload({
      name: " DeepSeek ",
      provider: "deepseek",
      model_id: " deepseek-chat ",
      base_url: " https://api.deepseek.com ",
      api_key: " secret ",
      is_default: true,
      api_format: "openai_compatible",
      api_key_optional: false,
      headersText: '{"x-test":"1"}',
      queryParamsText: '{"temperature":0.1}',
      healthcheck_mode: "chat_completion",
    });

    expect(payload.name).toBe("DeepSeek");
    expect(payload.model_id).toBe("deepseek-chat");
    expect(payload.extra_options.headers).toEqual({ "x-test": "1" });
    expect(payload.extra_options.query_params).toEqual({ temperature: "0.1" });
  });

  it("builds model form data from saved config", () => {
    const formData = buildModelFormData({
      id: "m1",
      name: "Claude",
      provider: "anthropic",
      model_id: "claude-3-7-sonnet",
      base_url: "https://api.anthropic.com",
      is_default: false,
      created_at: "",
      extra_options: {
        api_format: "anthropic_native",
        headers: { "x-test": "1" },
      },
    });

    expect(formData.api_format).toBe("anthropic_native");
    expect(formData.headersText).toContain("x-test");
  });

  it("applies driver defaults and builds connection form data", () => {
    const sqliteForm = applyDriverDefaults(defaultConnectionFormData, "sqlite");
    expect(sqliteForm.port).toBe(0);

    const formData = buildConnectionFormData({
      id: "c1",
      name: "Analytics",
      driver: "postgresql",
      host: "db.internal",
      port: 5432,
      database_name: "analytics",
      username: "readonly",
      is_default: true,
      created_at: "",
    });

    expect(formData.database).toBe("analytics");
    expect(formData.password).toBe("");
  });

  it("builds export file names with a stable date suffix", () => {
    const filename = buildConnectionExportName("analytics", new Date("2026-03-07T10:00:00Z"));
    expect(filename).toBe("querygpt-config-analytics-2026-03-07.json");
  });

  it("derives visible tables, nodes and relationships from schema state", () => {
    const tables = [
      { name: "users", columns: [] },
      { name: "orders", columns: [] },
    ];
    const hiddenTables = deriveHiddenTables(
      {
        id: "layout-1",
        connection_id: "conn-1",
        name: "Default",
        is_default: true,
        layout_data: { users: { x: 12, y: 34 } },
        visible_tables: ["users"],
        zoom: 1,
        viewport_x: 0,
        viewport_y: 0,
      },
      tables.map((table) => table.name)
    );

    const visibleTables = filterVisibleTables(tables, hiddenTables, "");
    const nodes = buildSchemaNodes(visibleTables, {
      id: "layout-1",
      connection_id: "conn-1",
      name: "Default",
      is_default: true,
      layout_data: { users: { x: 12, y: 34 } },
      visible_tables: ["users"],
      zoom: 1,
      viewport_x: 0,
      viewport_y: 0,
    });
    const edges = buildRelationshipEdges(visibleTables, [
      {
        id: "rel-1",
        connection_id: "conn-1",
        source_table: "users",
        source_column: "id",
        target_table: "orders",
        target_column: "user_id",
        relationship_type: "1:N",
        join_type: "LEFT",
        is_active: true,
      },
    ]);

    expect(hiddenTables.has("orders")).toBe(true);
    expect(visibleTables).toHaveLength(1);
    expect(nodes[0]?.position).toEqual({ x: 12, y: 34 });
    expect(edges).toHaveLength(0);
  });

  it("builds a serializable layout snapshot", () => {
    const snapshot = buildLayoutSnapshot(
      [
        {
          id: "users",
          position: { x: 10, y: 20 },
          data: {},
        } as never,
      ],
      { x: 1, y: 2, zoom: 1.5 },
      [{ name: "users", columns: [] }],
      new Set()
    );

    expect(snapshot.signature).toContain("users");
    expect(snapshot.payload.layout_data?.users).toEqual({ x: 10, y: 20 });
    expect(snapshot.payload.zoom).toBe(1.5);
  });
});
