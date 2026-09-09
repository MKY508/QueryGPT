import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatHeader } from "@/components/chat/ChatHeader";
import type { Project } from "@/lib/types/api";
import enMessages from "@/messages/en.json";
import zhMessages from "@/messages/zh.json";

const originalLanguage = document.documentElement.lang;

const project = {
  id: "project-1",
  name: "新的分析项目",
  description: null,
  status: "active",
  extra_data: {},
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
} satisfies Project;

function renderHeader(
  onOpenProjects = vi.fn(),
  locale: "en" | "zh" = "zh"
) {
  document.documentElement.lang = locale;
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? enMessages : zhMessages}
    >
      <ChatHeader
        onToggleData={vi.fn()}
        project={project}
        readySources={0}
        totalSources={0}
        onOpenProjects={onOpenProjects}
      />
    </NextIntlClientProvider>
  );
  return onOpenProjects;
}

describe("project header navigation", () => {
  afterEach(() => {
    document.documentElement.lang = originalLanguage;
  });

  it("keeps data and pending definition review as distinct destinations", () => {
    const onToggleData = vi.fn();
    const onOpenUnderstanding = vi.fn();
    render(
      <NextIntlClientProvider locale="zh" messages={zhMessages}>
        <ChatHeader
            onToggleData={onToggleData}
          onOpenUnderstanding={onOpenUnderstanding}
          project={project}
          readySources={2}
          totalSources={2}
          pendingUnderstandingCount={3}
        />
      </NextIntlClientProvider>
    );

    const button = screen.getByRole("button", { name: `${zhMessages.workbench.understanding} · 待核对 3` });
    expect(button).toHaveTextContent("待核对 3");
    expect(screen.getByText("2 项数据可用")).toBeInTheDocument();
    expect(screen.queryByText("数据与理解")).not.toBeInTheDocument();
    fireEvent.click(button);

    expect(onOpenUnderstanding).toHaveBeenCalledOnce();
    expect(onToggleData).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", {name: "数据 2"}));
    expect(onToggleData).toHaveBeenCalledOnce();
    expect(onOpenUnderstanding).toHaveBeenCalledOnce();
  });

  it("does not invent a project title or zero-source status", () => {
    const { container } = render(
      <NextIntlClientProvider locale="zh" messages={zhMessages}>
        <ChatHeader
            onToggleData={vi.fn()}
          readySources={0}
          totalSources={0}
        />
      </NextIntlClientProvider>
    );

    expect(screen.queryByText("准备分析项目")).not.toBeInTheDocument();
    expect(screen.queryByText("可以先提问，需要时再补数据")).not.toBeInTheDocument();
    expect(container.querySelector(".bg-amber-500")).toBeNull();
    expect(screen.getByRole("button", { name: "数据" })).toHaveTextContent("数据");
  });

  it("opens the shared project switcher from the title without editing inline", () => {
    const open = renderHeader();
    const trigger = screen.getByRole("button", { name: "切换项目：新的分析项目" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog"); fireEvent.click(trigger);
    expect(open).toHaveBeenCalledOnce(); expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
