import { describe, expect, it } from "vitest";
import type { APIMessage, MessageMetadata } from "@/lib/types/api";
import { mapConversationMessages } from "@/lib/stores/chat-helpers";

function question(id: string, key: string, extra: Partial<MessageMetadata> = {}): APIMessage {
  return { id, role: "assistant", content: "Choose", created_at: "2026-09-07T00:00:00Z", metadata: {
    project_id: "project", analysis_run_id: "run", report: {
      status: "waiting_confirmation", title: "Choose", summary: "Choose", metrics: [], findings: [], evidence: [], follow_ups: [],
      confirmation: { key, question: "Choose", reason: "Changes the comparison", options: ["yes", "no"] },
    }, ...extra,
  } };
}
function receipt(id: string, key: string, selected = "yes", extra: Partial<MessageMetadata> = {}): APIMessage {
  return { id, role: "user", content: selected, created_at: "2026-09-07T00:00:01Z", metadata: {
    project_id: "project", analysis_run_id: "run", kind: "business_confirmation", confirmation_key: key, selected_option: selected, ...extra,
  } };
}

describe("confirmation history", () => {
  it("restores each ordered question independently and leaves later questions unanswered", () => {
    const history = [question("q1", "stores"), receipt("r1", "stores"), question("q2", "refunds"), receipt("r2", "refunds", "no"), question("q3", "stores")];
    const before = JSON.stringify(history);
    expect(mapConversationMessages(history, "project").map(message => message.confirmationResolved)).toEqual(["yes", undefined, "no", undefined, undefined]);
    expect(JSON.stringify(history)).toBe(before);
  });

  it("ignores untyped chat, invalid options, wrong scope and receipts before the question", () => {
    const history = [receipt("early", "stores"), question("q", "stores"),
      receipt("ordinary", "stores", "yes", { kind: undefined }),
      { ...receipt("wrong-role", "stores"), role: "assistant" as const },
      receipt("wrong-project", "stores", "yes", { project_id: "another" }),
      receipt("wrong-run", "stores", "yes", { analysis_run_id: "another" }),
      receipt("wrong-key", "different"), receipt("invalid-option", "stores", "unavailable"),
      receipt("missing-key", "stores", "yes", { confirmation_key: undefined }),
    ];
    expect(mapConversationMessages(history, "project").every(message => message.confirmationResolved === undefined)).toBe(true);
  });

  it("recognizes explicit refund aliases but never guesses from similar options", () => {
    const history = [question("q1", "Refund Handling"), receipt("r1", "revenue_refund_policy"),
      question("q2", "unrelated_business_rule"), receipt("r2", "revenue_refund_policy", "no")];
    const mapped = mapConversationMessages(history, "project");
    expect(mapped[0].confirmationResolved).toBe("yes");
    expect(mapped[2].confirmationResolved).toBeUndefined();
    const coded = question("coded", "older_refund_key");
    coded.metadata!.report!.confirmation!.presentation_code = "preflight.revenue_refund_policy";
    expect(mapConversationMessages([coded, receipt("r3", "revenue_refund_policy")], "project")[0].confirmationResolved).toBe("yes");
  });

  it("does not reuse duplicate receipts for a later question and can use the owning conversation scope", () => {
    const first = question("q1", "stores", { project_id: undefined });
    const saved = receipt("r1", "stores", "yes", { project_id: undefined });
    const next = question("q2", "stores", { project_id: undefined });
    expect(mapConversationMessages([first, saved, next, saved], "project").map(message => message.confirmationResolved)).toEqual(["yes", undefined, undefined, undefined]);
    expect(mapConversationMessages([first, saved]).every(message => message.confirmationResolved === undefined)).toBe(true);
  });
});
