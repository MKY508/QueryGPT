import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ComposerDraftGuard } from "@/components/providers/ComposerDraftGuard";
import { createComposerDraftStore } from "@/lib/composer-drafts";

afterEach(cleanup);

it("protects unretained text across page changes and releases the guard after retention or teardown", () => {
  const entries = new Map<string, string>();
  const storage = { getItem: (key: string) => entries.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { entries.set(key, value); }),
    removeItem: (key: string) => { entries.delete(key); } };
  const store = createComposerDraftStore(() => storage);
  const scope = { projectId: "project", conversationId: null };
  const page = (name: string) => <><ComposerDraftGuard store={store} /><main key={name}>{name}</main></>;
  const view = render(page("workbench"));
  const leaving = () => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event); return event.defaultPrevented;
  };
  expect(leaving()).toBe(false);
  storage.setItem.mockImplementationOnce(() => { throw new Error("quota"); });
  act(() => { store.write(scope, "  保留原文\n下一行  "); });
  view.rerender(page("settings"));
  expect(leaving()).toBe(true);
  expect(store.get(scope).text).toBe("  保留原文\n下一行  ");
  act(() => { store.retryUnretained(); });
  expect(leaving()).toBe(false);
  storage.setItem.mockImplementationOnce(() => { throw new Error("quota"); });
  act(() => { store.write(scope, "another draft"); });
  expect(leaving()).toBe(true);
  view.unmount();
  expect(leaving()).toBe(false);
});
