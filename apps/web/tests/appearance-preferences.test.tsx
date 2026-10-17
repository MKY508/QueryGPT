import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreferencesSettings } from "@/components/settings/PreferencesSettings";
import enMessages from "@/messages/en.json";
import zhMessages from "@/messages/zh.json";
import { useThemeStore } from "@/lib/stores/theme";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  setLocale: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("@/lib/actions/locale", () => ({
  setLocale: mocks.setLocale,
}));

vi.mock("@/lib/api/client", () => ({
  api: { get: mocks.get, put: mocks.put },
}));

describe("PreferencesSettings locale switch", () => {
  beforeEach(() => {
    mocks.refresh.mockReset();
    mocks.setLocale.mockReset();
    mocks.get.mockReset();
    mocks.put.mockReset();
  });

  afterEach(cleanup);

  it("refreshes only after the locale cookie action has completed", async () => {
    let completeLocaleChange!: () => void;
    mocks.setLocale.mockImplementation(
      () => new Promise<void>((resolve) => {
        completeLocaleChange = resolve;
      })
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <NextIntlClientProvider locale="zh" messages={zhMessages}>
        <QueryClientProvider client={queryClient}>
          <PreferencesSettings section="appearance" />
        </QueryClientProvider>
      </NextIntlClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "English" }));

    expect(mocks.setLocale).toHaveBeenCalledWith("en");
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(mocks.setLocale).toHaveBeenCalledOnce();

    await act(async () => completeLocaleChange());
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
  });

  it("keeps the interface usable when a language change fails", async () => {
    mocks.setLocale.mockRejectedValue(new Error("offline"));
    const queryClient = new QueryClient();
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <QueryClientProvider client={queryClient}>
          <PreferencesSettings section="appearance" />
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(enMessages.preferences.languageChangeFailed);
    expect(mocks.refresh).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "中文" })).toBeEnabled());
  });

  it("selects a theme without writing execution settings", () => {
    useThemeStore.setState({ theme: "dawn" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>
      <QueryClientProvider client={new QueryClient()}>
        <PreferencesSettings section="appearance" />
      </QueryClientProvider>
    </NextIntlClientProvider>);
    const dark = screen.getByRole("radio", { name: enMessages.theme.midnight.name });
    fireEvent.click(dark);
    expect(dark).toBeChecked();
    expect(document.documentElement).toHaveClass("theme-midnight");
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
    useThemeStore.getState().setTheme("dawn");
  });
});
