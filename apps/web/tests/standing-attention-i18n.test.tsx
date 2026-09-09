import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import { describe, expect, it } from "vitest";
import { standingAttentionFeedback } from "@/components/chat/standing-attention";
import type { StandingPrepareResponse } from "@/lib/types/api";
import enMessages from "@/messages/en.json";
import zhMessages from "@/messages/zh.json";

function Feedback({
  prepared,
}: {
  prepared: Pick<
    StandingPrepareResponse,
    "attention_reason" | "attention_reason_code" | "attention_reason_params"
  >;
}) {
  const t = useTranslations("chatArea");
  return <p>{standingAttentionFeedback(prepared, t)}</p>;
}

function renderFeedback(
  locale: "en" | "zh",
  prepared: Pick<
    StandingPrepareResponse,
    "attention_reason" | "attention_reason_code" | "attention_reason_params"
  >,
) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? enMessages : zhMessages}
    >
      <Feedback prepared={prepared} />
    </NextIntlClientProvider>,
  );
}

describe("standing attention runtime localization", () => {
  it("renders a coded source reason in English without translating the source name", () => {
    renderFeedback("en", {
      attention_reason: "订单明细 有待核对的新数据版本，确认前不会自动继续",
      attention_reason_code: "standing_source_pending_confirmation",
      attention_reason_params: { source: "订单明细" },
    });

    expect(screen.getByText(/订单明细 has a new data version awaiting review/)).toBeInTheDocument();
    expect(screen.queryByText(/确认前不会自动继续/)).not.toBeInTheDocument();
  });

  it("renders the same coded source reason in Chinese", () => {
    renderFeedback("zh", {
      attention_reason: "legacy fallback",
      attention_reason_code: "standing_source_pending_confirmation",
      attention_reason_params: { source: "orders" },
    });

    expect(screen.getByText("orders 有待核对的新数据版本，确认前不会自动继续。"))
      .toBeInTheDocument();
  });

  it("keeps uncoded diagnostics out of the ordinary product surface", () => {
    renderFeedback("en", {
      attention_reason: "warehouse timeout trace-id=abc123",
    });

    expect(screen.getByText("Handle the data change in the project first."))
      .toBeInTheDocument();
    expect(screen.queryByText(/trace-id/)).not.toBeInTheDocument();
  });

  it("does not leak a cross-language legacy reason without a stable code", () => {
    renderFeedback("en", {
      attention_reason: "当前项目状态需要处理",
    });

    expect(screen.getByText("Handle the data change in the project first."))
      .toBeInTheDocument();
    expect(screen.queryByText("当前项目状态需要处理")).not.toBeInTheDocument();
  });

  it("does not expose an internal semantic key", () => {
    renderFeedback("en", {
      attention_reason: "metric:internal:revenue_v2 changed",
      attention_reason_code: "standing_semantic_definition_changed_since_baseline",
      attention_reason_params: { key: "metric:internal:revenue_v2" },
    });

    expect(screen.getByText("A required business definition changed. Rerun the analysis first."))
      .toBeInTheDocument();
    expect(screen.queryByText(/metric:internal/)).not.toBeInTheDocument();
  });
});
