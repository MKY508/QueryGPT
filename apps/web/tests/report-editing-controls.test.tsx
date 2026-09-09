import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReportEditingControls } from "@/components/reports/ReportEditingControls";
import en from "@/messages/en.json";
import zh from "@/messages/zh.json";

afterEach(cleanup);
describe.each([{ locale: "zh", messages: zh }, { locale: "en", messages: en }])("report editing controls $locale", ({ locale, messages }) => {
  it("does not submit or reapply the active mode, and keeps saving explicit", () => {
    const mode = vi.fn(), save = vi.fn(), t = messages.reportWorkspace;
    const tree = (editing: boolean, status: "ready" | "saving" | "saved" = "ready", canSave = true) =>
      <NextIntlClientProvider locale={locale} messages={messages}>
        <ReportEditingControls editing={editing} onModeChange={mode} canSave={canSave} status={status} onSave={save} />
      </NextIntlClientProvider>;
    const view = render(tree(false));
    expect(screen.getByRole("group", { name: t.reportMode })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t.readReport }));
    expect(mode).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: t.editReport }));
    expect(mode).toHaveBeenCalledExactlyOnceWith(true);
    expect(save).not.toHaveBeenCalled();
    view.rerender(tree(true));
    expect(screen.getByRole("button", { name: t.editReport })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: t.editReport }));
    expect(mode).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: t.save }));
    expect(save).toHaveBeenCalledOnce();
    view.rerender(tree(true, "saving"));
    fireEvent.click(screen.getByRole("button", { name: t.saving }));
    expect(save).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: t.saving })).toBeDisabled();
    view.rerender(tree(true, "saved", false));
    expect(screen.getByRole("button", { name: t.save })).toBeDisabled();
    view.rerender(tree(false));
    expect(screen.queryByRole("button", { name: t.save })).not.toBeInTheDocument();
  });
});
