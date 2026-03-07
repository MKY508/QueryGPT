import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/types/chat";
import {
  applyStreamErrorEvent,
  applyStreamEvent,
  buildPendingAssistantMessage,
  mergeDiagnostics,
} from "@/lib/stores/chat-helpers";

function buildMessages(): ChatMessage[] {
  return [{ role: "user", content: "show sales" }, buildPendingAssistantMessage()];
}

describe("chat helpers", () => {
  it("dedupes diagnostics by attempt, phase, status, and message", () => {
    const diagnostics = mergeDiagnostics(
      [{ attempt: 1, phase: "sql", status: "error", message: "broken" }],
      [
        { attempt: 1, phase: "sql", status: "error", message: "broken" },
        { attempt: 2, phase: "sql", status: "repaired", message: "fixed" },
      ]
    );

    expect(diagnostics).toEqual([
      { attempt: 1, phase: "sql", status: "error", message: "broken" },
      { attempt: 2, phase: "sql", status: "repaired", message: "fixed" },
    ]);
  });

  it("applies progress and result events to the pending assistant message", () => {
    const progressMessages = applyStreamEvent(buildMessages(), {
      type: "progress",
      data: {
        message: "SQL ready",
        execution_context: { connection_name: "Analytics DB" },
        diagnostic_entry: {
          attempt: 1,
          phase: "sql",
          status: "success",
          message: "ok",
        },
      },
    });
    const resultMessages = applyStreamEvent(progressMessages, {
      type: "result",
      data: {
        content: "分析完成",
        sql: "SELECT 1",
        data: [{ value: 1 }],
        rows_count: 1,
        execution_time: 0.25,
        execution_context: { model_id: "model-a" },
        diagnostics: [
          { attempt: 1, phase: "sql", status: "success", message: "ok" },
        ],
      },
    });

    expect(resultMessages[1]).toMatchObject({
      content: "分析完成",
      sql: "SELECT 1",
      rowsCount: 1,
      executionTime: 0.25,
      isLoading: false,
      executionContext: {
        connection_name: "Analytics DB",
        model_id: "model-a",
      },
    });
    expect(resultMessages[1].diagnostics).toHaveLength(1);
  });

  it("applies python and visualization payloads incrementally", () => {
    const withVisualization = applyStreamEvent(buildMessages(), {
      type: "visualization",
      data: {
        chart: {
          type: "bar",
          data: [{ name: "A", value: 1 }],
        },
      },
    });
    const withOutput = applyStreamEvent(withVisualization, {
      type: "python_output",
      data: {
        output: "hello",
        stream: "stdout",
      },
    });
    const withImage = applyStreamEvent(withOutput, {
      type: "python_image",
      data: {
        image: "base64-data",
        format: "png",
      },
    });

    expect(withImage[1].visualization?.type).toBe("bar");
    expect(withImage[1].pythonOutput).toBe("hello");
    expect(withImage[1].pythonImages).toEqual(["base64-data"]);
  });

  it("marks the assistant message as failed on SSE error", () => {
    const nextMessages = applyStreamErrorEvent(
      buildMessages(),
      {
        type: "error",
        data: {
          code: "SQL_EXECUTION_FAILED",
          message: "syntax error",
          error_category: "sql",
          execution_context: { connection_name: "Analytics DB" },
        },
      },
      "show sales"
    );

    expect(nextMessages[1]).toMatchObject({
      hasError: true,
      errorMessage: "syntax error",
      errorCode: "SQL_EXECUTION_FAILED",
      errorCategory: "sql",
      originalQuery: "show sales",
      executionContext: { connection_name: "Analytics DB" },
      isLoading: false,
    });
  });
});
