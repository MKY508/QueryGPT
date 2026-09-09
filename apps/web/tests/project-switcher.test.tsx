import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectSwitcherDialog } from "@/components/projects/ProjectSwitcherDialog";
import { inspectProjectDirectory, searchProjects } from "@/lib/project-directory";
import { useProjectStore } from "@/lib/stores/project";
import { useChatStore } from "@/lib/stores/chat";
import { api } from "@/lib/api/client";
import type { Project } from "@/lib/types/api";
import { mockSemanticDialogs } from "./semantic-dialog-mock";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";

const copy = zh.projectSwitcher;
const project = (id: string, name = `经营项目 ${id}`): Project => ({ id, name, description: "门店收入与配送成本", status: "active", extra_data: {}, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-06T00:00:00Z" });
const response = (data: unknown) => ({ data: { data } });
const originalProject = useProjectStore.getState(), originalChat = useChatStore.getState();
let restoreDialogs: () => void, projects: Project[];
const close = vi.fn(), switched = vi.fn();
const wrapper = (english = false, disabled = false) => <NextIntlClientProvider locale={english ? "en" : "zh"} messages={english ? en : zh}>
  <ProjectSwitcherDialog onClose={close} onSwitched={switched} disabled={disabled} />
</NextIntlClientProvider>;
const nameInput = () => screen.getByRole("textbox", { name: copy.name });
const launchCreate = async () => { await waitFor(() => expect(screen.getByRole("button", { name: copy.refresh })).toBeEnabled()); fireEvent.click(screen.getByRole("button", { name: copy.new })); };
beforeEach(() => {
  restoreDialogs = mockSemanticDialogs(); close.mockReset(); switched.mockReset();
  projects = Array.from({ length: 42 }, (_, index) => project(String(index + 1)));
  useProjectStore.setState({ ...originalProject, projects, currentProjectId: "2", sources: [{ id: "original-source" }] as never, refreshCurrent: vi.fn().mockResolvedValue(undefined) }, true);
  useChatStore.setState({ ...originalChat, currentConversationId: "original-conversation", messages: [{ id: "old-result" }] as never, isLoading: false, activeStreamId: null, abortController: null }, true);
  vi.spyOn(api, "get").mockResolvedValue(response(projects) as never);
  vi.mocked(localStorage.setItem).mockReset();
});
afterEach(() => { cleanup(); restoreDialogs(); vi.restoreAllMocks(); useProjectStore.setState(originalProject, true); useChatStore.setState(originalChat, true); vi.mocked(localStorage.setItem).mockReset(); });

describe("project switcher", () => {
  it("searches normalized names and descriptions, retains duplicate names by identity, and rejects unsafe directories", () => {
    const values = [project("a", "北区收入"), project("b", "北区收入"), project("c", "ＤＥＭＯ ２")];
    expect(searchProjects(values, "b", "北区 配送", "zh").map(item => item.id)).toEqual(["b", "a"]);
    expect(searchProjects(values, null, "demo 2", "en").map(item => item.id)).toEqual(["c"]);
    expect(() => inspectProjectDirectory([values[0], values[0]])).toThrow();
    expect(() => inspectProjectDirectory([{ ...values[0], updated_at: "unknown" }])).toThrow();
  });

  it("browses in bounded batches, waits for IME, keeps locale/input, and does not switch when merely searching or renaming", async () => {
    const post = vi.spyOn(api, "post"), patch = vi.spyOn(api, "patch");
    const { rerender } = render(wrapper());
    await waitFor(() => expect(screen.getByRole("searchbox", { name: copy.search })).toHaveFocus());
    const list = screen.getByRole("list", { name: copy.list }); expect(within(list).getAllByRole("listitem")).toHaveLength(20);
    fireEvent.click(screen.getByRole("button", { name: copy.more }));
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(40));
    const search = screen.getByRole("searchbox", { name: copy.search });
    fireEvent.compositionStart(search); fireEvent.change(search, { target: { value: "42" } });
    expect(within(list).getAllByRole("listitem")).toHaveLength(40);
    fireEvent.keyDown(search, { key: "Escape", isComposing: true }); expect(close).not.toHaveBeenCalled();
    fireEvent.compositionEnd(search, { data: "42" }); expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    fireEvent.keyDown(search, { key: "ArrowDown" }); expect(within(list).getByRole("button", { name: /经营项目 42 门店/ })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" }); expect(search).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "重命名 经营项目 42" }));
    expect(nameInput()).toHaveFocus(); fireEvent.change(nameInput(), { target: { value: "  新名称  " } });
    rerender(wrapper(true)); expect(screen.getByRole("textbox", { name: en.projectSwitcher.name })).toHaveValue("  新名称  ");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getByRole("button", { name: "Rename 经营项目 42" })).toHaveFocus();
    expect(screen.getByRole("searchbox", { name: en.projectSwitcher.search })).toHaveValue("42");
    expect(useChatStore.getState().currentConversationId).toBe("original-conversation"); expect(post).not.toHaveBeenCalled(); expect(patch).not.toHaveBeenCalled();
  });

  it("keeps the original analysis on an uncertain creation, locks duplicate submits and reconciles with reads only", async () => {
    let reject: (reason: unknown) => void = () => {};
    const post = vi.spyOn(api, "post").mockImplementation(() => new Promise((_, fail) => { reject = fail; }) as never);
    render(wrapper()); await launchCreate(); fireEvent.change(nameInput(), { target: { value: "  季度经营  " } });
    const form = nameInput().closest("form")!; fireEvent.submit(form); fireEvent.submit(form);
    expect(post).toHaveBeenCalledExactlyOnceWith("/api/v1/projects", { name: "季度经营" });
    expect(useProjectStore.getState().currentProjectId).toBe("2"); expect(useChatStore.getState().messages[0].id).toBe("old-result");
    expect(screen.getByRole("button", { name: copy.close })).toBeDisabled(); fireEvent.keyDown(nameInput(), { key: "Escape" }); expect(close).not.toHaveBeenCalled();
    await act(async () => reject({ response: { status: 503, data: { detail: "private database failure" } } }));
    expect(screen.getByRole("alert")).toHaveTextContent(copy.unconfirmed); expect(screen.queryByText(/private database/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.createAndOpen })).toBeDisabled(); expect(nameInput()).toHaveValue("  季度经营  ");
    projects = [...projects, project("created", "季度经营")]; vi.mocked(api.get).mockResolvedValue(response(projects) as never);
    fireEvent.click(screen.getByRole("button", { name: copy.checkList }));
    await waitFor(() => expect(useProjectStore.getState().projects).toHaveLength(43));
    expect(post).toHaveBeenCalledOnce(); expect(switched).not.toHaveBeenCalled(); expect(useProjectStore.getState().currentProjectId).toBe("2");
  });

  it("opens only an acknowledged creation and preserves the original saved conversation pointer", async () => {
    let settle: (value: unknown) => void = () => {};
    vi.spyOn(api, "post").mockImplementation(() => new Promise(resolve => { settle = resolve; }) as never);
    const clear = vi.spyOn(useChatStore.getState(), "clearConversation");
    render(wrapper()); await launchCreate(); fireEvent.change(nameInput(), { target: { value: "季度经营" } }); fireEvent.submit(nameInput().closest("form")!);
    expect(clear).not.toHaveBeenCalled();
    await act(async () => settle(response(project("new-project", "季度经营"))));
    expect(clear).toHaveBeenCalledExactlyOnceWith({ forget: false });
    expect(useProjectStore.getState().currentProjectId).toBe("new-project"); expect(switched).toHaveBeenCalledOnce();
    expect(useProjectStore.getState().sources).toEqual([]);
  });

  it("does not redirect a newer context or a closed window when creation finishes late", async () => {
    let settle: (value: unknown) => void = () => {};
    vi.spyOn(api, "post").mockImplementation(() => new Promise(resolve => { settle = resolve; }) as never);
    const clear = vi.spyOn(useChatStore.getState(), "clearConversation");
    const { unmount } = render(wrapper()); await launchCreate(); fireEvent.change(nameInput(), { target: { value: "后来创建" } }); fireEvent.submit(nameInput().closest("form")!);
    act(() => useProjectStore.setState({ currentProjectId: "3" }));
    await act(async () => settle(response(project("later", "后来创建"))));
    expect(useProjectStore.getState().currentProjectId).toBe("3"); expect(clear).not.toHaveBeenCalled(); expect(switched).not.toHaveBeenCalled();
    await launchCreate(); fireEvent.change(nameInput(), { target: { value: "关闭后创建" } }); fireEvent.submit(nameInput().closest("form")!); unmount();
    await act(async () => settle(response(project("closed", "关闭后创建"))));
    expect(useProjectStore.getState().projects.some(item => item.id === "closed")).toBe(true); expect(clear).not.toHaveBeenCalled(); expect(switched).not.toHaveBeenCalled();
  });

  it("keeps rename input on failure and updates only the named project after a matching reply", async () => {
    const patch = vi.spyOn(api, "patch").mockRejectedValue({ response: { status: 422 } });
    const { rerender } = render(wrapper()); await waitFor(() => expect(screen.getByRole("button", { name: copy.refresh })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "重命名 经营项目 2" }));
    fireEvent.change(nameInput(), { target: { value: "  七月复盘  " } }); fireEvent.submit(nameInput().closest("form")!);
    await screen.findByRole("alert"); expect(nameInput()).toHaveValue("  七月复盘  "); expect(useProjectStore.getState().projects[1].name).toBe("经营项目 2");
    rerender(wrapper(true)); expect(screen.getByRole("alert")).toHaveTextContent(en.projectSwitcher.saveFailed);
    patch.mockResolvedValue(response({ ...projects[1], name: "七月复盘" }) as never);
    fireEvent.submit(screen.getByRole("textbox", { name: en.projectSwitcher.name }).closest("form")!);
    await waitFor(() => expect(useProjectStore.getState().projects[1].name).toBe("七月复盘"));
    expect(patch).toHaveBeenLastCalledWith("/api/v1/projects/2", { name: "七月复盘" }); expect(useProjectStore.getState().currentProjectId).toBe("2");
    expect(useChatStore.getState().currentConversationId).toBe("original-conversation"); expect(switched).not.toHaveBeenCalled();
  });

  it("blocks overlapping creation and does not redirect even after leaving and returning to the original project", async () => {
    let settle: (value: unknown) => void = () => {};
    const post = vi.spyOn(api, "post").mockImplementation(() => new Promise(resolve => { settle = resolve; }) as never);
    const creating = useProjectStore.getState().createProject("后来创建");
    await expect(useProjectStore.getState().createProject("重复点击")).rejects.toThrow(); expect(post).toHaveBeenCalledOnce();
    await useProjectStore.getState().selectProject("3"); await useProjectStore.getState().selectProject("2");
    settle(response(project("later", "后来创建"))); await creating;
    expect(useProjectStore.getState().currentProjectId).toBe("2"); expect(useProjectStore.getState().projects[0].id).toBe("later");
  });

  it("rejects wrong acknowledgements and ignores a directory read older than a rename", async () => {
    vi.spyOn(api, "post").mockResolvedValue(response(project("wrong", "wrong name")) as never);
    await expect(useProjectStore.getState().createProject("expected", { activate: false })).rejects.toThrow();
    expect(useProjectStore.getState().projects).toEqual(projects);
    const patch = vi.spyOn(api, "patch").mockResolvedValue(response(project("foreign", "renamed")) as never);
    await expect(useProjectStore.getState().renameProject("2", "renamed")).rejects.toThrow();
    let settle: (value: unknown) => void = () => {};
    vi.mocked(api.get).mockImplementation(() => new Promise(resolve => { settle = resolve; }) as never);
    const reading = useProjectStore.getState().reloadProjects();
    patch.mockResolvedValue(response({ ...projects[1], name: "renamed" }) as never);
    await useProjectStore.getState().renameProject("2", "renamed"); settle(response(projects)); await reading;
    expect(useProjectStore.getState().projects[1].name).toBe("renamed"); expect(useProjectStore.getState().sources[0].id).toBe("original-source");
    vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error("blocked"); });
    await useProjectStore.getState().selectProject("3"); expect(useProjectStore.getState().currentProjectId).toBe("3");
  });
});
