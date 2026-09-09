import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AboutPage from "@/app/about/page";
import messages from "@/messages/zh.json";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  readDesktopAppInfo: vi.fn(),
  open: vi.fn(),
  checkForUpdate: vi.fn(),
}));

vi.mock("@/lib/releases", () => ({
  checkForUpdate: mocks.checkForUpdate,
  RELEASES_URL: "https://github.com/MoonMao42/ReceiptBI/releases/latest",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/lib/api/client", () => ({
  api: { get: vi.fn() },
}));

vi.mock("@/lib/desktop-app-info", () => ({
  readDesktopAppInfo: mocks.readDesktopAppInfo,
  formatDesktopPlatform: (platform: string) => (platform === "darwin" ? "macOS" : platform),
}));

describe("AboutPage", () => {
  beforeEach(() => {
    mocks.push.mockClear();
    mocks.open.mockClear();
    mocks.checkForUpdate.mockReset();
    mocks.readDesktopAppInfo.mockResolvedValue({
      version: "1.0.0",
      isPackaged: true,
      platform: "darwin",
    });
    vi.stubGlobal("open", mocks.open);
  });

  it("checks only on request and opens the available release", async () => {
    mocks.checkForUpdate.mockResolvedValue({ version: "1.1.0", available: true, url: "https://github.com/MoonMao42/ReceiptBI/releases/tag/v1.1.0" });
    render(<NextIntlClientProvider locale="zh" messages={messages}><AboutPage /></NextIntlClientProvider>);
    const check = await screen.findByRole("button", { name: "检查更新" });
    expect(mocks.checkForUpdate).not.toHaveBeenCalled();
    fireEvent.click(check);
    fireEvent.click(await screen.findByRole("button", { name: "下载 v1.1.0" }));
    expect(mocks.open).toHaveBeenCalledWith("https://github.com/MoonMao42/ReceiptBI/releases/tag/v1.1.0", "_blank", "noopener,noreferrer");
  });

  it("offers a release page when the update check fails", async () => {
    mocks.checkForUpdate.mockRejectedValue(new Error("offline"));
    render(<NextIntlClientProvider locale="zh" messages={messages}><AboutPage /></NextIntlClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "检查更新" }));
    expect(await screen.findByText("暂时无法检查更新，请稍后重试。")).toBeInTheDocument();
    expect(screen.queryByText("当前已是最新版本")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看发布版本" })).toBeInTheDocument();
  });

  it("cancels a requested update check on departure without opening a late result", async () => {
    let resolve!: (value: { version: string; available: boolean; url: string }) => void;
    mocks.checkForUpdate.mockReturnValue(new Promise(done => { resolve = done; }));
    const view = render(<NextIntlClientProvider locale="zh" messages={messages}><AboutPage /></NextIntlClientProvider>);
    const check = await screen.findByRole("button", { name: "检查更新" });
    fireEvent.click(check); fireEvent.click(check);
    expect(mocks.checkForUpdate).toHaveBeenCalledOnce();
    const signal = mocks.checkForUpdate.mock.calls[0][1] as AbortSignal;
    expect(signal.aborted).toBe(false); view.unmount(); expect(signal.aborted).toBe(true);
    await act(async () => resolve({ version: "1.1.0", available: true, url: "https://github.com/MoonMao42/ReceiptBI/releases/tag/v1.1.0" }));
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("does not infer a preview build or start a health read after departing runtime lookup", async () => {
    let resolve!: (value: undefined) => void;
    mocks.readDesktopAppInfo.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const fetch = vi.spyOn(globalThis, "fetch");
    try {
      const view = render(<NextIntlClientProvider locale="zh" messages={messages}><AboutPage /></NextIntlClientProvider>);
      expect(screen.queryByRole("button", { name: messages.about.downloadDesktop })).not.toBeInTheDocument();
      expect(screen.queryByText(messages.about.preview)).not.toBeInTheDocument();
      view.unmount(); await act(async () => resolve(undefined));
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });

  it("shows only basic product information and fixed project links", async () => {
    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <AboutPage />
      </NextIntlClientProvider>
    );

    await waitFor(() => expect(screen.getByText("桌面版 · v1.0")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "ReceiptBI" })).toBeInTheDocument();
    expect(screen.queryByText("本地优先的私人数据分析工作台。")).not.toBeInTheDocument();
    expect(screen.queryByText("ReceiptBI 怎样完成一项工作")).not.toBeInTheDocument();
    expect(screen.queryByText("当前真正支持的能力")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /GitHub/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /MIT License/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /问题与建议/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /GitHub/ }));
    expect(mocks.open).toHaveBeenCalledWith(
      "https://github.com/MoonMao42/ReceiptBI",
      "_blank",
      "noopener,noreferrer"
    );
  });
});
