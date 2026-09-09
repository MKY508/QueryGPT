import {cleanup,fireEvent,render,screen,within} from "@testing-library/react";
import {NextIntlClientProvider} from "next-intl";
import {afterEach,describe,expect,it,vi} from "vitest";
import {WorkspaceActivitySummary} from "@/components/chat/WorkspaceActivitySummary";
import {AnalysisSuggestions} from "@/components/chat/AnalysisSuggestions";
import type {StandingAnalysis} from "@/lib/types/api";
import zh from "@/messages/zh.json";
afterEach(cleanup);
describe("desktop workspace activity",()=>{
  it("keeps later investigations reachable and prevents checks already in flight",()=>{
    const items=Array.from({length:4},(_,i)=>({id:String(i),name:`关注 ${i+1}`,state:'active',in_flight:i===1}) as StandingAnalysis);
    const check=vi.fn();
    render(<NextIntlClientProvider locale="zh" messages={zh}><WorkspaceActivitySummary sources={[]} standingAnalyses={items} standingFeedback={{}} onOpenData={vi.fn()} onCheckStanding={check}/></NextIntlClientProvider>);
    const rows=screen.getAllByRole('listitem');expect(rows).toHaveLength(4);
    expect(within(rows[1]).getByRole('button')).toBeDisabled();
    fireEvent.click(within(rows[3]).getByRole('button'));expect(check).toHaveBeenCalledWith(items[3]);
  });
  it("retains available suggestions through failure and only hands off the exact prompt",()=>{
    const prompt='  核对收入\n不要删空格  ',usePrompt=vi.fn(),generate=vi.fn();
    render(<NextIntlClientProvider locale="zh" messages={zh}><AnalysisSuggestions items={[{label:'核对收入',reason:'定位变化',prompt}]} generated loading={false} failed settingsLoaded canGenerate onGenerate={generate} onUsePrompt={usePrompt}/></NextIntlClientProvider>);
    expect(generate).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent(zh.chatEmpty.suggestionsRefreshFailed);
    fireEvent.click(screen.getByRole('button',{name:'核对收入'}));expect(usePrompt).toHaveBeenCalledWith(prompt);expect(generate).not.toHaveBeenCalled();
  });
});
