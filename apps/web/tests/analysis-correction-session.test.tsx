import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantMessageCard } from "@/components/chat/AssistantMessageCard";
import type { AnalysisCorrection } from "@/lib/types/api";
import zh from "@/messages/zh.json";
vi.mock("@/lib/api/client", () => ({ api: { get: vi.fn(async () => ({data:{data:[]}})), post:vi.fn(),put:vi.fn(),delete:vi.fn() } }));
vi.mock("@/components/chat/ChartDisplay", () => ({ChartDisplay:()=>null}));
vi.mock("@/components/chat/DataTable", () => ({DataTable:()=>null}));
const clients: QueryClient[]=[];
afterEach(()=>{cleanup();clients.splice(0).forEach(client=>client.clear());});
const saved:AnalysisCorrection={id:'correction',project_id:'project',analysis_run_id:'run',semantic_entry_id:null,target_ref:null,correction_type:'business_rule',text:'按实际收款计算收入',scope:'run',state:'recorded',evidence:[],created_at:'2026-09-01',updated_at:'2026-09-01'};
function mount(){
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);
 client.setQueryData(['analysis-corrections','project'],[saved]);
 const props={index:0,onRetry:vi.fn(),onRerun:vi.fn(),onUsePrompt:vi.fn(),onConfirm:vi.fn(),onOpenData:vi.fn()};
 const view=render(<NextIntlClientProvider locale="zh" messages={zh}><QueryClientProvider client={client}>
  <AssistantMessageCard {...props} message={{role:'assistant',content:'完成',projectId:'project',analysisRunId:'run',analysisState:'completed',report:{status:'completed',title:'收入分析',summary:'完成',findings:[],metrics:[],evidence:[],follow_ups:[]}}}/>
 </QueryClientProvider></NextIntlClientProvider>);
 return {...view,client};
}
describe('correction draft ownership',()=>{
 it('keeps an open draft intact when the saved record refreshes, then loads the latest record on cancel',async()=>{
  const {client}=mount();
  fireEvent.click(await screen.findByRole('button',{name:'修改'}));
  const input=screen.getByLabelText('正确的理解是什么？');
  fireEvent.change(input,{target:{value:'正在编辑：扣除退款再计算'}});
  await act(async()=>{client.setQueryData(['analysis-corrections','project'],[{...saved,text:'已更新的收入定义',updated_at:'2026-09-02'}]);});
  expect(input).toHaveValue('正在编辑：扣除退款再计算');
  fireEvent.click(screen.getByRole('button',{name:'取消',exact:true}));
  expect(screen.getByText('已更新的收入定义')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'修改'}));
  expect(screen.getByLabelText('正确的理解是什么？')).toHaveValue('已更新的收入定义');
 });
 it('stops showing a saved correction when it disappears from the authoritative query',async()=>{
  const {client}=mount();await screen.findByRole('button',{name:'撤销记录'});
  await act(async()=>{client.setQueryData(['analysis-corrections','project'],[]);});
  expect(screen.queryByRole('button',{name:'撤销记录'})).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'结论有偏差或口径不对？纠正这次理解'})).toBeInTheDocument();
 });
});
