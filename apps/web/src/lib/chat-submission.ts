import type { ChatMessage } from "@/lib/types/chat";

/** A settled transport alone does not prove that the question was retained. */
export async function submitWithAnalysisReceipt(submit: () => Promise<void>, read: () => {
  activeStreamId: string | null; messages: readonly ChatMessage[];
}): Promise<boolean> {
  const previousStreamId = read().activeStreamId;
  const completion = submit();
  const submittedStreamId = read().activeStreamId;
  await completion;
  return Boolean(submittedStreamId && submittedStreamId !== previousStreamId && read().messages.some(message =>
    message.role === "assistant" && message.streamId === submittedStreamId && message.analysisRunId));
}
