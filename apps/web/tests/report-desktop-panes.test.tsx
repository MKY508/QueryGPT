import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useReportPanels } from "@/components/reports/useReportPanels";
import { ReportOutline } from "@/components/reports/ReportOutline";
import messages from "@/messages/zh.json";

afterEach(cleanup);

it("keeps desktop panes independent and does not subscribe to viewport breakpoints", () => {
  const media = vi.spyOn(window, "matchMedia");
  media.mockClear();
  const { result } = renderHook(useReportPanels, { wrapper: StrictMode });
  expect(result.current).toMatchObject({ outlineOpen: true, propertiesOpen: false });
  act(() => result.current.showProperties());
  act(() => window.dispatchEvent(new Event("resize")));
  expect(result.current).toMatchObject({ outlineOpen: true, propertiesOpen: true });
  act(() => result.current.closeOutline());
  act(() => result.current.showProperties());
  expect(result.current).toMatchObject({ outlineOpen: false, propertiesOpen: true });
  act(() => result.current.showOutline());
  expect(result.current).toMatchObject({ outlineOpen: true, propertiesOpen: true });
  expect(media).not.toHaveBeenCalled();
  media.mockRestore();
});

it("keeps outline navigation nonmodal and search state through explicit collapse", () => {
  const close = vi.fn(), select = vi.fn();
  const view = (hidden: boolean) => <NextIntlClientProvider locale="zh" messages={messages}>
    <div hidden={hidden}><ReportOutline
      pages={[{ id: "page", title: "门店表现", order_index: 0, config: {}, blocks: [] }]}
      activePageId="page" selectedBlockId={null} disabled={false} blockLabel={() => "内容"}
      onSelectPage={select} onSelectBlock={vi.fn()} onAddPage={vi.fn()} onMovePage={vi.fn()}
      onReorderPage={vi.fn()} onDuplicatePage={vi.fn()} onDeletePage={vi.fn()} onClose={close}
    /></div>
  </NextIntlClientProvider>;
  const { rerender } = render(view(false));
  expect(screen.getByRole("complementary", { name: "页面与区块" })).not.toHaveAttribute("aria-modal");
  const search = screen.getByRole("searchbox");
  fireEvent.change(search, { target: { value: "门店" } });
  rerender(view(true)); rerender(view(false));
  expect(search).toHaveValue("门店");
  fireEvent.keyDown(search, { key: "ArrowDown" });
  const page = screen.getByRole("button", { name: /01.*门店表现/ });
  expect(page).toHaveFocus();
  fireEvent.click(page); expect(select).toHaveBeenCalledWith("page");
  fireEvent.keyDown(search, { key: "Escape", isComposing: true });
  expect(search).toHaveValue("门店");
  fireEvent.keyDown(search, { key: "Escape" });
  expect(search).toHaveValue(""); expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(search, { key: "Escape" }); expect(close).toHaveBeenCalledOnce();
});
