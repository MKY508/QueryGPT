import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import { ConnectionSettingsList } from "@/components/settings/connection-settings/ConnectionSettingsList";
import type { ConfiguredConnection } from "@/lib/types/api";
import zh from "@/messages/zh.json";

afterEach(cleanup);

it("keeps edit, check and confirmed deletion separate and disarms while browsing", () => {
  const edit = vi.fn(), check = vi.fn(), remove = vi.fn();
  const connection: ConfiguredConnection = {
    id: "warehouse", name: "门店订单", driver: "postgresql", host: "warehouse.example.invalid",
    port: 5432, database: "orders", username: "reader", is_default: true, created_at: "2026-09-07T00:00:00Z",
  };
  render(<NextIntlClientProvider locale="zh" messages={zh}>
    <ConnectionSettingsList connections={[connection]} isLoading={false} editingId={connection.id}
      testResult={{ id: connection.id, success: false, text: "暂时无法连接" }} testingConnectionId={null}
      actionsDisabled={false} onEdit={edit} onTest={check} onDelete={remove} />
  </NextIntlClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "编辑 门店订单" }));
  expect(edit).toHaveBeenCalledExactlyOnceWith(connection);
  fireEvent.click(screen.getByTestId("connection-test-warehouse"));
  expect(check).toHaveBeenCalledExactlyOnceWith("warehouse");
  expect(screen.getByTestId("connection-test-result-warehouse")).toHaveTextContent("暂时无法连接");
  fireEvent.click(screen.getByRole("button", { name: "删除 门店订单" }));
  expect(remove).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "订单" } });
  expect(screen.queryByRole("button", { name: zh.common.confirmDelete })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "删除 门店订单" }));
  fireEvent.click(screen.getByRole("button", { name: zh.common.confirmDelete }));
  expect(remove).toHaveBeenCalledExactlyOnceWith("warehouse");
  expect(edit).toHaveBeenCalledTimes(1);
});
