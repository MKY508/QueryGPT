import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {NextIntlClientProvider} from "next-intl";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {SavedAnalysisArtifacts} from "@/components/chat/SavedAnalysisArtifacts";
import {mockSemanticDialogs} from "./semantic-dialog-mock";
import type {AnalysisArtifact} from "@/lib/types/api";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";
vi.mock("@/components/reports/ReportBlockCard",()=>({ReportBlockCard:({block,editing}:{block:{title:string};editing:boolean})=><article data-editing={editing}>{block.title}</article>}));
const base={project_id:'project',analysis_run_id:'run',technical_details:{},created_at:'2026-09-01',updated_at:'2026-09-01'};
const artifacts:AnalysisArtifact[]=[{...base,id:'metric',kind:'metric',title:'收入',payload:{value:'100'}},{...base,id:'file',kind:'file',title:'导出表',payload:{relative_path:'report.csv'}}];
let restore:()=>void;
beforeEach(()=>{restore=mockSemanticDialogs();});afterEach(()=>{cleanup();restore();});
const content=(open:boolean,onClose:()=>void,locale:'zh'|'en'='zh',items=artifacts)=><NextIntlClientProvider locale={locale} messages={locale==='zh'?zh:en}><SavedAnalysisArtifacts artifacts={items} open={open} onClose={onClose}/></NextIntlClientProvider>;
describe('saved artifact desktop window',()=>{
 it('previews existing blocks without editing and preserves report and file destinations across languages',()=>{
  const view=render(content(true,vi.fn()));expect(screen.getAllByRole('article')).toHaveLength(2);
  expect(screen.getByText('收入')).toHaveAttribute('data-editing','false');
  expect(screen.getByRole('link',{name:zh.savedArtifacts.compileToReport})).toHaveAttribute('href','/projects/project/reports?fromRun=run');
  expect(screen.getByRole('link',{name:zh.savedArtifacts.openFile})).toHaveAttribute('href','/api/v1/projects/project/analysis-runs/run/artifacts/file/file');
  view.rerender(content(true,vi.fn(),'en'));expect(screen.getByRole('dialog',{name:en.savedArtifacts.dialogTitle})).toBeInTheDocument();expect(screen.getByText('收入')).toBeInTheDocument();
 });
 it('owns Escape without interrupting composition and returns focus without changing body scroll styles',async()=>{
  const opener=document.createElement('button');document.body.append(opener);opener.focus();const close=vi.fn(),overflow=document.body.style.overflow;
  const view=render(content(true,close));await waitFor(()=>expect(screen.getByRole('region')).toHaveFocus());
  const dialog=screen.getByRole('dialog');expect(dialog.parentElement).toBe(document.body);
  fireEvent.keyDown(dialog,{key:'Escape',isComposing:true});expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(dialog,{key:'Escape'});expect(close).toHaveBeenCalledOnce();
  view.rerender(content(false,close));expect(opener).toHaveFocus();expect(document.body.style.overflow).toBe(overflow);opener.remove();
 });
 it('does not create a modal for empty results',()=>{render(content(true,vi.fn(),'zh',[]));expect(screen.queryByRole('dialog')).not.toBeInTheDocument();});
});
