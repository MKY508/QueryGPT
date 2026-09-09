import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnalysisMetrics, AnalysisFindings, AnalysisSuggestions } from "@/components/chat/AnalysisReportHighlights";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";
afterEach(cleanup);
describe("analysis report reading sections", () => {
  it("keeps metric values, context and findings as readable text without interpreting them", () => {
    render(<NextIntlClientProvider locale="zh" messages={zh}>
      <AnalysisMetrics metrics={[{label:"净收入",value:"¥0",context:"已扣退款"},{label:"增长",value:"—"}]} />
      <AnalysisFindings findings={["<script>这是原文</script>","退款影响了净收入。"]} />
    </NextIntlClientProvider>);
    expect(screen.getByText("¥0")).toBeInTheDocument(); expect(screen.getByText("已扣退款")).toBeInTheDocument();
    expect(screen.getAllByRole("term")).toHaveLength(2); expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("<script>这是原文</script>")).toBeInTheDocument(); expect(document.querySelector("script")).toBeNull();
  });
  it("hands off only the chosen full prompt and preserves the original content on locale changes", () => {
    const use = vi.fn(), action={kind:"compare" as const,label:"比较门店",prompt:"  比较门店\n保留退款  ",reason:"区分门店结构变化",recommended:true};
    const content=(locale:"zh"|"en")=><NextIntlClientProvider locale={locale} messages={locale==='zh'?zh:en}>
      <AnalysisSuggestions actions={[action]} questions={["不要同时展示旧建议"]} onUsePrompt={use}/>
    </NextIntlClientProvider>;
    const view=render(content('zh'));expect(screen.queryByText("不要同时展示旧建议")).not.toBeInTheDocument();expect(use).not.toHaveBeenCalled();
    view.rerender(content('en'));fireEvent.click(screen.getByRole('button',{name:/比较门店/}));expect(use).toHaveBeenCalledExactlyOnceWith(action.prompt);
  });
  it("omits empty sections and exposes follow-up questions as explicit actions", () => {
    const use=vi.fn();const view=render(<NextIntlClientProvider locale="en" messages={en}><AnalysisMetrics/><AnalysisFindings/><AnalysisSuggestions onUsePrompt={use}/></NextIntlClientProvider>);
    expect(view.container).toBeEmptyDOMElement();
    view.rerender(<NextIntlClientProvider locale="en" messages={en}><AnalysisSuggestions questions={["What changed?"]} onUsePrompt={use}/></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole('button',{name:'What changed?'}));expect(use).toHaveBeenCalledExactlyOnceWith('What changed?');
  });
});
