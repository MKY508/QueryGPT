import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {NextIntlClientProvider} from "next-intl";
import {afterEach, describe, expect, it, vi} from "vitest";
import {ConversationStatus, PendingTaskReport} from "@/components/chat/MessageListStatus";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";
afterEach(cleanup);
describe("message list status surfaces", () => {
  it("keeps a received question intact and only continues after an explicit action", () => {
    const onContinue=vi.fn(), onOpenSettings=vi.fn(), onEdit=vi.fn();
    const task="  核对收入\n保留原始问题  ";
    const props={task,onContinue,onOpenSettings,onEdit};
    const view=render(<NextIntlClientProvider locale="zh" messages={zh}><PendingTaskReport {...props} modelReady={false}/></NextIntlClientProvider>);
    expect(screen.getByRole("heading",{level:1}).textContent).toBe(task);
    expect(screen.queryByText(zh.messageList.understoodTask)).not.toBeInTheDocument();
    expect(onContinue).not.toHaveBeenCalled();expect(onOpenSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:zh.messageList.pickService}));expect(onOpenSettings).toHaveBeenCalledOnce();
    view.rerender(<NextIntlClientProvider locale="en" messages={en}><PendingTaskReport {...props} modelReady/></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button",{name:en.messageList.editTask}));expect(onEdit).toHaveBeenCalledOnce();
    expect(onContinue).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:en.messageList.continueOrPick}));expect(onContinue).toHaveBeenCalledOnce();
  });
  it("does not expose stale failure or retry while a conversation is opening", () => {
    const retry=vi.fn();
    const view=render(<NextIntlClientProvider locale="zh" messages={zh}><ConversationStatus loading error="旧失败" onRetry={retry}/></NextIntlClientProvider>);
    expect(screen.getByRole("status")).toHaveTextContent(zh.messageList.openingReport);
    expect(screen.queryByText("旧失败")).not.toBeInTheDocument();expect(screen.queryByRole("button")).not.toBeInTheDocument();
    view.rerender(<NextIntlClientProvider locale="zh" messages={zh}><ConversationStatus loading={false} error="当前失败" onRetry={retry}/></NextIntlClientProvider>);
    expect(screen.getByRole("alert")).toHaveTextContent("当前失败");expect(retry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:zh.messageList.reopen}));expect(retry).toHaveBeenCalledOnce();
  });
});
