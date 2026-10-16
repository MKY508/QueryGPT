import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsCollection, matchesSettingsItem } from "@/components/settings/SettingsCollection";
import { ConnectionSettingsList } from "@/components/settings/connection-settings/ConnectionSettingsList";
import { ModelSettingsList } from "@/components/settings/model-settings/ModelSettingsList";
import { ConnectionSettings } from "@/components/settings/ConnectionSettings";
import { ModelSettings } from "@/components/settings/ModelSettings";
import { createWorkspaceQueryClient } from "@/lib/api/query-client";
import { api } from "@/lib/api/client";
import type { ConfiguredConnection, ConfiguredModel } from "@/lib/types/api";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";
import { mockSemanticDialogs } from "./semantic-dialog-mock";

vi.mock("@/lib/api/client", () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
const copy = zh.settingsCollection;
const wrap = (children: ReactNode, locale = "zh") => <NextIntlClientProvider locale={locale} messages={locale === "zh" ? zh : en}>{children}</NextIntlClientProvider>;
const model = (id: string, props: Partial<ConfiguredModel> = {}): ConfiguredModel => ({ id, name: `Service ${id}`, provider: "openai", model_id: "analysis-model", is_default: false,
  credential_state: "readable", health_status: "unknown", created_at: "2026-09-07T00:00:00Z", ...props });
const connection = (id: string, props: Partial<ConfiguredConnection> = {}): ConfiguredConnection => ({ id, name: `Warehouse ${id}`, driver: "postgresql", host: "warehouse.example.invalid",
  port: 5432, database: "orders", username: "reader", is_default: false, created_at: "2026-09-07T00:00:00Z", ...props });
let client: ReturnType<typeof createWorkspaceQueryClient>, restoreDialogs: () => void;

describe("settings collections", () => {
  beforeEach(() => { client = createWorkspaceQueryClient(); restoreDialogs = mockSemanticDialogs(); vi.mocked(api.get).mockReset(); vi.mocked(api.post).mockReset(); vi.mocked(api.put).mockReset(); vi.mocked(api.delete).mockReset(); });
  afterEach(() => { cleanup(); client.clear(); restoreDialogs(); vi.restoreAllMocks(); });

  it("matches normalized tokens across explicit display fields without substring order or empty-field errors", () => {
    expect(matchesSettingsItem("  ＳＥＲＶＩＣＥ 订单 ", ["Service", undefined, "门店订单"])).toBe(true);
    expect(matchesSettingsItem("", [null])).toBe(true);
    expect(matchesSettingsItem("service missing", ["Service", "orders"])).toBe(false);
    expect(matchesSettingsItem("fixture-secret", ["Service", "orders"])).toBe(false);
  });

  it("bounds pages, returns to results on paging, resets filters and does not revive a removed last page", () => {
    const items = Array.from({ length: 25 }, (_, index) => `Item ${index + 1}`), browse = vi.fn();
    const view = (values: string[]) => wrap(<SettingsCollection items={values} searchLabel="Search items" filterLabel="Type"
      options={[{ value: "all", label: "All" }]} matches={(item, query) => matchesSettingsItem(query, [item])} onBrowse={browse} empty={<p>Empty</p>}>
      {visible => <ul>{visible.map(item => <li key={item}>{item}</li>)}</ul>}
    </SettingsCollection>);
    const { rerender } = render(view(items)); expect(screen.getAllByRole("listitem")).toHaveLength(12);
    fireEvent.click(screen.getByRole("button", { name: copy.next })); expect(screen.getByRole("status")).toHaveFocus();
    expect(screen.getByText("Item 13")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: copy.next })); expect(screen.getAllByRole("listitem")).toHaveLength(1);
    rerender(view(items.slice(0, 13))); expect(screen.getByText("Item 13")).toBeInTheDocument();
    rerender(view(items)); expect(screen.getByText("Item 13")).toBeInTheDocument(); expect(screen.queryByText("Item 25")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "no-match" } });
    expect(screen.getByText(copy.noMatches)).toBeInTheDocument(); expect(screen.queryByText("Empty")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: copy.clearFilters })); expect(screen.getByRole("searchbox")).toHaveFocus();
    expect(screen.getByText("Item 1")).toBeInTheDocument(); expect(browse).toHaveBeenCalledTimes(4);
  });

  it("filters model business states and defaults, ignores hidden credentials, and disarms deletion after browsing", () => {
    const edit = vi.fn(), check = vi.fn(), remove = vi.fn();
    const models = [model("a", { is_default: true, health_status: "healthy" }), model("b", { credential_state: "missing" }), model("c", { extra_options: { headers: { Authorization: "fixture-secret" } } })];
    const view = (locale = "zh") => wrap(<ModelSettingsList models={models} isLoading={false} checks={{}} deletePending={false} onEdit={edit} onTest={check} onDelete={remove} />, locale);
    const { rerender } = render(view());
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "attention" } }); expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByTestId("model-card-b")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除 Service b" })); expect(screen.getByRole("button", { name: zh.common.confirmDelete })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "all" } }); expect(screen.queryByRole("button", { name: zh.common.confirmDelete })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "fixture-secret" } }); expect(screen.getByText(copy.noMatches)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: copy.clearSearch }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "default" } }); expect(screen.getAllByRole("listitem")).toHaveLength(1);
    rerender(view("en")); expect(screen.getByRole("combobox")).toHaveValue("default");
    fireEvent.click(screen.getByRole("button", { name: "Edit Service a" })); expect(edit).toHaveBeenCalledWith(models[0]);
    expect(check).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  });

  it("searches connection display fields and legacy database names with distinct edit and check actions", () => {
    const edit = vi.fn(), check = vi.fn(), remove = vi.fn();
    const connections = [connection("a", { database: null, database_name: "legacy_sales" }), connection("b", { driver: "sqlite", database: "/data/finance.sqlite" })];
    render(wrap(<ConnectionSettingsList connections={connections} isLoading={false} editingId={null} testResult={null} testingConnectionId={null} actionsDisabled={false} onEdit={edit} onTest={check} onDelete={remove} />));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "ＬＥＧＡＣＹ postgres" } }); expect(screen.getAllByRole("listitem")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "编辑 Warehouse a" })); expect(edit).toHaveBeenCalledWith(connections[0]);
    fireEvent.click(screen.getByTestId("connection-test-a")); expect(check).toHaveBeenCalledWith("a"); expect(edit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: copy.clearSearch }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "sqlite" } }); expect(screen.getByTestId("connection-card-b")).toBeInTheDocument();
    expect(screen.queryByTestId("connection-card-a")).not.toBeInTheDocument(); expect(remove).not.toHaveBeenCalled();
  });

  it.each(["model", "connection"] as const)("keeps the actual %s draft while filtering its row and protects replacement", async kind => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: kind === "model" ? [model("a"), model("b")] : [connection("a"), connection("b")] } });
    render(<QueryClientProvider client={client}>{wrap(kind === "model" ? <ModelSettings /> : <ConnectionSettings />)}</QueryClientProvider>);
    const row = await screen.findByTestId(`${kind}-card-a`);
    fireEvent.click(within(row).getByRole("button", { name: /^编辑 / }));
    fireEvent.change(screen.getByTestId(`${kind}-name-input`), { target: { value: "Unsaved editor" } });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: " b" } });
    expect(screen.queryByTestId(`${kind}-card-a`)).not.toBeInTheDocument(); expect(screen.getByTestId(`${kind}-name-input`)).toHaveValue("Unsaved editor");
    fireEvent.click(within(screen.getByTestId(`${kind}-card-b`)).getByRole("button", { name: /^编辑 / }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent(zh.settingsUnsaved.title);
    fireEvent.click(screen.getByRole("button", { name: zh.settingsUnsaved.continueEditing }));
    expect(screen.getByTestId(`${kind}-name-input`)).toHaveValue("Unsaved editor");
    expect(api.get).toHaveBeenCalledTimes(1); expect(api.post).not.toHaveBeenCalled(); expect(api.put).not.toHaveBeenCalled(); expect(api.delete).not.toHaveBeenCalled();
  });
});
