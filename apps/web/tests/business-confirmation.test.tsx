import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { BusinessConfirmation } from "@/components/chat/BusinessConfirmation";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";

const request = {
  key: "revenue_rule", question: "收入如何计算？", reason: "不同口径会改变比较结果。",
  options: ["扣除退款", "保留退款订单", "按现有净额字段"],
};
const base = {
  request, projectId: "project-1", analysisRunId: "run-1",
  question: request.question, reason: request.reason, optionLabel: (option: string) => option,
};
type Props = React.ComponentProps<typeof BusinessConfirmation>;
function view(overrides: Partial<Props> = {}, locale: "zh" | "en" = "zh") {
  return <NextIntlClientProvider locale={locale} messages={locale === "zh" ? zh : en}>
    <BusinessConfirmation {...base} onConfirm={vi.fn()} {...overrides} />
    <button>Outside</button>
  </NextIntlClientProvider>;
}
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("BusinessConfirmation", () => {
  it("keeps selection separate from submission, locks repeated submits, and focuses the receipt", async () => {
    const pending = deferred(), onConfirm = vi.fn(() => pending.promise);
    render(view({ onConfirm }));
    const submit = screen.getByRole("button", { name: "确认并继续" });
    expect(submit).toBeDisabled();
    expect(screen.getAllByRole("radio").every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "扣除退款" }));
    fireEvent.click(screen.getByRole("radio", { name: "保留退款订单" }));
    expect(onConfirm).not.toHaveBeenCalled();
    submit.focus();
    act(() => { fireEvent.submit(submit.closest("form")!); fireEvent.submit(submit.closest("form")!); });
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith("run-1", "revenue_rule", "保留退款订单");
    expect(screen.getAllByRole("radio").every((radio) => radio.matches(":disabled"))).toBe(true);
    expect(submit).toHaveAttribute("aria-disabled", "true");
    await act(async () => pending.resolve());
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByText("已确认")).toBeInTheDocument();
    expect(document.activeElement).toHaveTextContent("保留退款订单");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("retains the failed choice for an explicit retry and never steals outside focus", async () => {
    const first = deferred(), second = deferred();
    const onConfirm = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(view({ onConfirm }));
    fireEvent.click(screen.getByRole("radio", { name: "按现有净额字段" }));
    fireEvent.click(screen.getByRole("button", { name: "确认并继续" }));
    await act(async () => first.reject(new Error("RAW_INTERNAL_SECRET")));
    expect(screen.getByRole("alert")).not.toHaveTextContent("RAW_INTERNAL_SECRET");
    expect(screen.getByRole("radio", { name: "按现有净额字段" })).toBeChecked();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "确认并继续" }));
    screen.getByRole("button", { name: "Outside" }).focus();
    await act(async () => second.resolve());
    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Outside" })).toHaveFocus();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("resets by question and run identity and ignores a retired request's late failure", async () => {
    const pending = deferred(), onConfirm = vi.fn(() => pending.promise);
    const rendered = render(view({ onConfirm }));
    fireEvent.click(screen.getByRole("radio", { name: "扣除退款" }));
    fireEvent.click(screen.getByRole("button", { name: "确认并继续" }));
    rendered.rerender(view({ onConfirm, analysisRunId: "run-2" }));
    expect(screen.getByRole("button", { name: "确认并继续" })).toBeDisabled();
    await act(async () => pending.reject(new Error("Retired request")));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "扣除退款" }));
    rendered.rerender(view({ onConfirm, analysisRunId: "run-2", request: { ...request, reason: "范围已改变" } }));
    expect(screen.getByRole("radio", { name: "扣除退款" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "确认并继续" })).toBeDisabled();
  });

  it("respects authoritative resolved choices, localized labels, missing runs, and literal long text", async () => {
    const onConfirm = vi.fn(), long = '<img src=x onerror="alert(1)">' + "Refund definition ".repeat(30);
    const props = { onConfirm, optionLabel: (option: string) => option === request.options[0] ? long : option };
    const rendered = render(view({ ...props, resolvedOption: request.options[0] }, "en"));
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByTestId("business-confirmation").textContent).toContain(long);
    rendered.rerender(view({ ...props, analysisRunId: undefined }));
    fireEvent.click(screen.getAllByRole("radio")[0]);
    fireEvent.click(screen.getByRole("button", { name: "确认并继续" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(zh.assistantMessage.resumeMissing));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getAllByRole("radio")[0]).toBeChecked();
  });
});
