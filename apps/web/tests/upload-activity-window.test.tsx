import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import { UploadActivityWindow } from "@/components/uploads/UploadActivityWindow";
import messages from "@/messages/zh.json";

const show = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
afterEach(() => {
  cleanup(); vi.restoreAllMocks();
  if (show) Object.defineProperty(HTMLDialogElement.prototype, "showModal", show); else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (close) Object.defineProperty(HTMLDialogElement.prototype, "close", close); else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

it("isolates report shortcuts and ignores composition Escape without coupling dismissal to transfers", () => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } },
  });
  const onClose = vi.fn(), behind = vi.fn();
  render(<NextIntlClientProvider locale="zh" messages={messages}><div onKeyDown={behind}>
    <UploadActivityWindow projectName="门店经营" onClose={onClose}><button>Queue action</button></UploadActivityWindow>
  </div></NextIntlClientProvider>);
  const button = screen.getByRole("button", { name: "Queue action" });
  for (const key of ["s", "p", "z", "y"]) fireEvent.keyDown(button, { key, metaKey: true });
  expect(behind).not.toHaveBeenCalled();
  expect(fireEvent.keyDown(button, { key: "Escape", isComposing: true })).toBe(false);
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "关闭文件导入" }));
  expect(onClose).toHaveBeenCalledOnce();
});
