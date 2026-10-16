import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RecipeReplayDialog } from "@/components/chat/RecipeReplayDialog";
import { DataWorkspacePanel } from "@/components/chat/DataWorkspacePanel";
import * as replay from "@/lib/recipe-replay";
import { api } from "@/lib/api/client";
import { useProjectStore } from "@/lib/stores/project";
import type { ProjectDataSource, SanitationRecipe } from "@/lib/types/api";
import messages from "@/messages/zh.json";

const source: ProjectDataSource = { id: "source-1", project_id: "project-1", name: "orders.csv", kind: "file", format: "csv", status: "ready", profile_data: {}, created_at: "2026-09-05", updated_at: "2026-09-05" };
const preview: replay.RecipeReplayPreview = {
  source_id: source.id, recipe_id: "recipe-1", revision_id: "revision-1", revision_number: 1, proof: "a".repeat(64),
  before: null, after: { rows: 2, columns: 1, sample: [{ amount: "9007199254740993" }] },
  added_columns: [], removed_columns: [], type_changes: [], input_changed: false, pending_replacement: false, unresolved_questions: 0, can_apply: true,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((value) => { resolve = value; });
  return { promise, resolve };
}
const show = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
const refreshCurrent = useProjectStore.getState().refreshCurrent;
beforeEach(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } },
  });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks();
  if (show) Object.defineProperty(HTMLDialogElement.prototype, "showModal", show); else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (close) Object.defineProperty(HTMLDialogElement.prototype, "close", close); else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  useProjectStore.setState({ currentProjectId: null, sourceAction: null, sources: [], recipes: [], refreshCurrent });
});

it("pins the reviewed revision, prevents duplicate confirmation, and reconciles unknown writes without resend", async () => {
  vi.spyOn(replay, "previewRecipeReplay").mockResolvedValue(preview);
  const pending = deferred<void>();
  const apply = vi.fn(() => pending.promise.then(() => { throw new Error("Lost reply"); }));
  const refresh = vi.fn().mockRejectedValue(new Error("offline"));
  render(<NextIntlClientProvider locale="zh" messages={messages}><RecipeReplayDialog projectId="project-1" sourceId={source.id} name={source.name} recipeId="recipe-1" canApply onApply={apply} onRefresh={refresh} onClose={vi.fn()} /></NextIntlClientProvider>);
  expect(await screen.findByText("9007199254740993")).toBeInTheDocument();
  expect(screen.getByText(messages.recipeReplay.noCurrent)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: messages.recipeReplay.apply }));
  fireEvent.click(screen.getByRole("button", { name: messages.recipeReplay.apply }));
  expect(apply).toHaveBeenCalledTimes(1);
  expect(apply).toHaveBeenCalledWith({ revision_id: "revision-1", proof: "a".repeat(64) });
  await act(async () => pending.resolve());
  expect(await screen.findByText(messages.recipeReplay.uncertain)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: messages.recipeReplay.refresh }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("button", { name: messages.recipeReplay.apply })).not.toBeInTheDocument();
  expect(apply).toHaveBeenCalledTimes(1);
});

it("opens ordinary reapply as a preview and ignores its late result after a project switch", async () => {
  const pending = deferred<replay.RecipeReplayPreview>();
  const read = vi.spyOn(replay, "previewRecipeReplay").mockReturnValue(pending.promise);
  const write = vi.spyOn(replay, "applyRecipeReplay");
  useProjectStore.setState({ currentProjectId: "project-1", sources: [source], recipes: [{ id: "recipe-1", data_source_id: source.id, status: "applied", operations: [] } as unknown as SanitationRecipe] });
  render(<NextIntlClientProvider locale="zh" messages={messages}><DataWorkspacePanel open onClose={vi.fn()} onConfigureConnection={vi.fn()} /></NextIntlClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: messages.dataWorkspace.recipeReapplyButton }));
  expect(screen.getByRole("dialog", { name: messages.recipeReplay.title })).toBeInTheDocument();
  expect(read).toHaveBeenCalledWith("project-1", source.id, "recipe-1", {}, expect.any(AbortSignal));
  act(() => useProjectStore.setState({ currentProjectId: "project-2", sources: [], recipes: [] }));
  await act(async () => pending.resolve(preview));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(write).not.toHaveBeenCalled();
  expect((read.mock.calls[0][4] as AbortSignal).aborted).toBe(true);
});

it("does not publish late application into another project and rejects foreign review evidence", async () => {
  const pending = deferred<ProjectDataSource>();
  const apply = vi.spyOn(replay, "applyRecipeReplay").mockReturnValue(pending.promise);
  const refresh = vi.fn().mockResolvedValue(undefined);
  useProjectStore.setState({ currentProjectId: "project-1", sources: [source], refreshCurrent: refresh });
  const write = useProjectStore.getState().replayRecipe("project-1", source.id, "recipe-1", { proof: preview.proof });
  await expect(useProjectStore.getState().replayRecipe("project-1", source.id, "recipe-1", { proof: preview.proof })).rejects.toThrow();
  useProjectStore.setState({ currentProjectId: "project-2", sources: [], sourceAction: null });
  pending.resolve(source);
  await write;
  expect(useProjectStore.getState().sources).toEqual([]);
  expect(refresh).not.toHaveBeenCalled();
  expect(apply).toHaveBeenCalledTimes(1);
  const post = vi.spyOn(api, "post");
  for (const change of [{ recipe_id: "other" }, { revision_id: "other" }, { before: { rows: -1, columns: 1, sample: [] } }]) {
    post.mockResolvedValueOnce({ data: { data: { ...preview, ...change } } });
    await expect(replay.previewRecipeReplay("project-1", source.id, "recipe-1", { revision_id: "revision-1" })).rejects.toThrow("Invalid recipe replay preview");
  }
});
