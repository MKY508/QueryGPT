import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import { CleaningSamples, cleaningWhitespace } from "@/components/chat/CleaningSamples";
import type { VisualCleaningSnapshot } from "@/lib/types/api";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";

afterEach(cleanup);
const snapshot = (sample: Record<string, unknown>[], columns?: number): VisualCleaningSnapshot => ({ sample, rows: sample.length, columns: columns ?? Object.keys(sample[0] ?? {}).length });
const view = (before: VisualCleaningSnapshot, after?: VisualCleaningSnapshot, preferredColumns?: string[], locale = "zh") => <NextIntlClientProvider locale={locale} messages={locale === "zh" ? zh : en}><CleaningSamples before={before} after={after} preferredColumns={preferredColumns} /></NextIntlClientProvider>;

describe("cleaning sample review", () => {
  it("finds changed fields beyond the first eight and browses the same bounded union on both sides", () => {
    const row = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`字段${index + 1}`, String(index)]));
    const before = snapshot([row, { ...row, 后续字段: "later" }], 11);
    const after = snapshot([{ ...row, 新字段: "new" }], 11);
    render(view(before, after, ["字段10"]));
    const left = screen.getByRole("table", { name: "整理前" });
    const right = screen.getByRole("table", { name: "整理后" });
    expect(screen.getByRole("combobox", { name: "定位字段" })).toHaveValue("字段10");
    expect(within(left).getByRole("columnheader", { name: "字段10" })).toBeInTheDocument();
    expect(within(right).getByRole("columnheader", { name: "字段10" })).toBeInTheDocument();
    expect(within(left).getAllByRole("columnheader")).toHaveLength(5);
    expect(within(right).getAllByRole("columnheader")).toHaveLength(5);
    expect(within(right).getByRole("cell", { name: "未提供此字段" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "上一组字段" }));
    expect(within(left).getAllByRole("columnheader")).toHaveLength(9);
    expect(within(left).queryByRole("columnheader", { name: "字段10" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "定位字段" }), { target: { value: "新字段" } });
    expect(within(right).getByRole("cell", { name: "new" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一组字段" })).toBeDisabled();
    expect(screen.getByText(zh.visualCleaning.sampleIndependentScope)).toBeInTheDocument();
  });

  it("distinguishes missing, empty, whitespace, zero and false without coercing exact values", () => {
    const raw = { 缺失: null, 空文: "", 空白: " \t\u00a0", 零: 0, 布尔: false, 金额: "9007199254740993.01", 空格: " A " };
    const before = snapshot([raw]);
    render(view(before));
    const table = screen.getByRole("table", { name: "数据样本" });
    for (const value of ["缺失值", "空文本", "仅空白字符", "0", "false", "9007199254740993.01"]) {
      expect(within(table).getByRole("cell", { name: value === "仅空白字符" ? "仅空白字符 展开" : value, exact: true })).toBeInTheDocument();
    }
    const label = screen.getByRole("checkbox", { name: "显示空白字符" });
    fireEvent.click(label);
    expect(within(table).getByText("·⇥⍽")).toBeInTheDocument();
    expect(within(table).getByText("·A·")).toBeInTheDocument();
    expect(raw.空白).toBe(" \t\u00a0");
    expect(raw.金额).toBe("9007199254740993.01");
    fireEvent.click(label);
    expect(within(table).getByRole("cell", { name: "仅空白字符 展开" })).toBeInTheDocument();
    expect(cleaningWhitespace("a\r\nb\rc\nd\te f\u00a0g")).toBe("a↵\nb↵\nc↵\nd⇥e·f⍽g");
    expect(cleaningWhitespace("\u3000\u2009\u202f\u0085\u2028\u2029")).toBe("␣␣⍽↵\n↵\n↵\n");
  });

  it("bounds very wide column choices while keeping distant fields searchable", () => {
    const row = Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`字段${index + 1}`, String(index)]));
    render(view(snapshot([row]), undefined, ["字段299"]));
    const select = screen.getByRole("combobox", { name: "定位字段" });
    expect(within(select).getAllByRole("option")).toHaveLength(81);
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索字段" }), { target: { value: "字段288" } });
    expect(within(select).getAllByRole("option")).toHaveLength(2);
    fireEvent.change(select, { target: { value: "字段288" } });
    expect(screen.getByRole("columnheader", { name: "字段288" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "搜索字段" })).toHaveValue("");
    expect(screen.getByRole("table").querySelectorAll("td")).toHaveLength(8);
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索字段" }), { target: { value: "missing" } });
    expect(screen.getByRole("status")).toHaveTextContent("没有匹配的字段");
    expect(select).toHaveValue("字段288");
  });

  it("opens unabridged text safely and Escape returns focus to the exact opener", () => {
    const text = `  <img src=x onerror=alert(1)>\n${"😺长内容".repeat(80)}\t尾部  `;
    render(view(snapshot([{ 说明: text }])));
    const button = screen.getByRole("button", { name: "展开数据样本第 1 条的“说明”完整值" });
    fireEvent.click(button);
    const region = screen.getByRole("region", { name: "说明 · 完整值" });
    expect(region.querySelector("div[tabindex='0']")?.textContent).toBe(text);
    expect(region.querySelector("img")).toBeNull();
    const heading = within(region).getByRole("heading", { name: "说明 · 完整值" });
    expect(heading).toHaveFocus();
    fireEvent.keyDown(heading, { key: "Escape", isComposing: true });
    expect(region).toBeInTheDocument();
    fireEvent.keyDown(heading, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "说明 · 完整值" })).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("clears value selection and display options on snapshot changes, including a return to an earlier snapshot", () => {
    const first = snapshot([{ 描述: "first ".repeat(40), 其他: "one" }]);
    const second = snapshot([{ 描述: "second ".repeat(40), 其他: "two" }]);
    const { rerender } = render(view(first));
    fireEvent.click(screen.getByRole("button", { name: /展开数据样本第 1 条的“描述”/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "显示空白字符" }));
    rerender(view(second));
    expect(screen.queryByRole("region", { name: "描述 · 完整值" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "显示空白字符" })).not.toBeChecked();
    rerender(view(first));
    expect(screen.queryByRole("region", { name: "描述 · 完整值" })).not.toBeInTheDocument();
  });

  it("keeps removed rows and absent columns independent, and supports unusual column names in English", () => {
    const row = Object.fromEntries([["", "empty-name"], ["__proto__", "own value"], ["constructor", "own constructor"]]);
    render(view(snapshot([row, { ...row, tail: "second" }]), snapshot([]), ["__proto__"], "en"));
    expect(screen.getByRole("combobox", { name: "Find column" })).toHaveValue("__proto__");
    expect(screen.getAllByRole("cell", { name: "own value" })).toHaveLength(2);
    expect(screen.queryByRole("table", { name: "After" })).not.toBeInTheDocument();
    expect(screen.getByText(en.visualCleaning.sampleIndependentScope)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Find column" }), { target: { value: "" } });
    expect(screen.getByRole("combobox", { name: "Find column" })).toHaveValue("");
  });

  it("displays structured values instead of object placeholders and keeps whitespace markers out of object serialization", () => {
    const nested = { channel: " A ", amount: "9007199254740993.01", tags: ["x", false] };
    render(view(snapshot([{ 明细: nested }])));
    fireEvent.click(screen.getByRole("button", { name: /展开数据样本第 1 条的“明细”/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "显示空白字符" }));
    const region = screen.getByRole("region", { name: "明细 · 完整值" });
    expect(region.querySelector("div[tabindex='0']")?.textContent).toBe(JSON.stringify(nested));
    expect(region).not.toHaveTextContent("[object Object]");
  });
});
