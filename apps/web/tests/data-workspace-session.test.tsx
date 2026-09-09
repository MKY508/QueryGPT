import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import { DataWorkspacePanel } from "@/components/chat/DataWorkspacePanel";
import { useProjectStore } from "@/lib/stores/project";
import messages from "@/messages/zh.json";

afterEach(() => {
  cleanup();
  useProjectStore.setState(useProjectStore.getInitialState());
});

const view = (open = true) => <NextIntlClientProvider locale="zh" messages={messages}>
  <DataWorkspacePanel open={open} onClose={vi.fn()} onConfigureConnection={vi.fn()} />
</NextIntlClientProvider>;

it("preserves a same-project view but starts a fresh workspace after a project round trip", () => {
  useProjectStore.setState({ ...useProjectStore.getInitialState(), currentProjectId: "project-1" });
  const { rerender } = render(view());
  const understanding = () => screen.getByRole("tab", { name: messages.dataWorkspace.understandingTab });
  const sources = () => screen.getByRole("tab", { name: messages.dataWorkspace.dataSourcesTab });
  fireEvent.click(understanding());
  expect(understanding()).toHaveAttribute("aria-selected", "true");
  rerender(view(false));
  rerender(view());
  expect(understanding()).toHaveAttribute("aria-selected", "true");
  act(() => useProjectStore.setState({ currentProjectId: "project-2" }));
  expect(sources()).toHaveAttribute("aria-selected", "true");
  act(() => useProjectStore.setState({ currentProjectId: "project-1" }));
  expect(sources()).toHaveAttribute("aria-selected", "true");
});
