import {describe,expect,it,vi} from "vitest";
import {submitWithAnalysisReceipt} from "@/lib/chat-submission";
import type {ChatMessage} from "@/lib/types/chat";
describe("question acceptance receipt",()=>{
  it("does not accept an earlier receipt when submission starts no new stream",async()=>{
    const read=()=>({activeStreamId:"existing",messages:[{role:"assistant",content:"",streamId:"existing",analysisRunId:"old-run"} as ChatMessage]});
    expect(await submitWithAnalysisReceipt(async()=>{},read)).toBe(false);
  });
  it("requires the new stream's own run even when a later task also has a receipt",async()=>{
    const state={activeStreamId:null as string|null,messages:[] as ChatMessage[]};
    let finish!:()=>void;
    const pending=submitWithAnalysisReceipt(()=>{state.activeStreamId="new";return new Promise<void>(resolve=>{finish=resolve;});},()=>state);
    state.activeStreamId="later";state.messages=[{role:"assistant",content:"",streamId:"later",analysisRunId:"later-run"}];
    finish();expect(await pending).toBe(false);
    state.activeStreamId=null;
    expect(await submitWithAnalysisReceipt(async()=>{state.activeStreamId="accepted";state.messages.push({role:"assistant",content:"",streamId:"accepted",analysisRunId:"run"});},()=>state)).toBe(true);
  });
  it("propagates submission failure without claiming acceptance",async()=>{
    const submit=vi.fn().mockRejectedValue(new Error("failed"));
    await expect(submitWithAnalysisReceipt(submit,()=>({activeStreamId:null,messages:[]}))).rejects.toThrow("failed");
  });
});
