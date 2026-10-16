import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChartDisplay } from "@/components/chat/ChartDisplay";
import { ReportBlockCard } from "@/components/reports/ReportBlockCard";
import type { ChartSpec } from "@/lib/charts";
import messages from "@/messages/zh.json";

const plot = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  tooltipSource: undefined as Record<string, unknown> | undefined,
  visible: true,
}));
afterEach(() => { plot.rows = []; plot.tooltipSource = undefined; plot.visible = true; });

// Sizing lifecycle is exercised with ResizeObserver in chart-viewport.test.tsx.
vi.mock("@/components/chat/ChartViewport", () => ({ ChartViewport: ({ children }: { children: ReactNode }) => plot.visible ? children : null }));

function renderChart(spec: ChartSpec) {
  return render(
    <NextIntlClientProvider locale="zh" messages={messages}>
      <ChartDisplay spec={spec} />
    </NextIntlClientProvider>
  );
}

vi.mock("recharts", () => {
  const Container = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const Element = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Area: Element,
    AreaChart: Container,
    Bar: ({ dataKey, name, stackId, fill, onClick }: Record<string, unknown>) => (
      <i
        onClick={() => { if (typeof onClick === "function") onClick({ x: 500, value: 10, payload: plot.rows[0] }); }}
        data-testid={`bar-${typeof dataKey === "function" && "field" in dataKey ? String(dataKey.field) : String(dataKey)}`}
        data-value={typeof dataKey === "function" ? String(dataKey(plot.rows[0] || {})) : ""}
        data-name={String(name)}
        data-stack={String(stackId || "")}
        data-fill={String(fill)}
      />
    ),
    BarChart: ({ children, layout, stackOffset, data }: Record<string, unknown>) => {
      plot.rows = data as Record<string, unknown>[];
      return (
      <div
        data-testid="bar-chart"
        data-layout={String(layout)}
        data-stack-offset={String(stackOffset)}
      >
        {children as ReactNode}
      </div>
      );
    },
    CartesianGrid: Element,
    Cell: Element,
    Legend: Element,
    LabelList: Element,
    Line: Element,
    LineChart: Container,
    Pie: Element,
    PieChart: Container,
    ResponsiveContainer: Container,
    Scatter: Element,
    ScatterChart: Container,
    Tooltip: ({ formatter }: Record<string, unknown>) => {
      const format = formatter as
        | ((value: number, name: string, item: { dataKey: string; payload?: unknown }) => unknown[])
        | undefined;
      const formatted = format?.(120, "收入", { dataKey: "revenue", payload: plot.tooltipSource });
      return (
        <span data-testid="tooltip-value">
          {Array.isArray(formatted) ? String(formatted[0]) : ""}
        </span>
      );
    },
    XAxis: Element,
    YAxis: Element,
  };
});

const horizontalSpec: ChartSpec = {
  version: 1,
  type: "horizontal_bar",
  title: "区域收入",
  data_ref: { result_name: "region_revenue", result_hash: "hash-1" },
  encoding: {
    x: { field: "region", label: "区域", kind: "category" },
    y: [
      {
        field: "revenue",
        label: "收入",
        kind: "number",
        format: "currency",
      },
      {
        field: "refund",
        label: "退款",
        kind: "number",
        format: "currency",
      },
    ],
  },
  presentation: {
    orientation: "horizontal",
    stack: "normal",
    palette: "monochrome",
  },
  data: [
    { region: "华东", revenue: 120, refund: 20 },
    { region: "华南", revenue: 80, refund: 10 },
  ],
};

describe("ChartDisplay", () => {
  it("keeps chart type and exact accessible data while the hidden plot is unmounted", () => {
    const content = () => <NextIntlClientProvider locale="zh" messages={messages}><ChartDisplay spec={horizontalSpec} /></NextIntlClientProvider>;
    const view = render(content());
    fireEvent.click(screen.getByRole("button", { name: "折线图" }));
    plot.visible = false;
    view.rerender(content());
    expect(screen.getByRole("button", { name: "折线图" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("table")).toHaveTextContent("¥120.00");
    plot.visible = true;
    view.rerender(content());
    expect(screen.getByRole("button", { name: "折线图" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img")).toHaveAccessibleName(/折线图/);
  });
  it("cross-filter mark selection uses the original field, with typed keyboard choices and no print controls", () => {
    const selected = vi.fn();
    const source = { x: "9007199254740993", revenue: 10 };
    const card = (staticRendering = false) => <NextIntlClientProvider locale="zh" messages={messages}>
      <ReportBlockCard
        block={{ id: "selection-chart", block_type: "chart", title: "Orders", order_index: 0, source_kind: "manual",
          content: { rows: [source] }, config: { chart_type: "bar", x_key: "x", y_key: "revenue" }, layout: { x: 0, y: 0, w: 6, h: 4 } }}
        editing={false} selected={false} staticRendering={staticRendering}
        interaction={{ field: "x", values: [source.x, null, false, ""], onSelect: selected }}
        onSelect={() => {}} onMove={() => {}} onResize={() => {}} onDuplicate={() => {}} onDelete={() => {}}
      />
    </NextIntlClientProvider>;
    const { rerender } = render(card());
    fireEvent.click(screen.getByTestId("bar-revenue"));
    expect(selected).toHaveBeenLastCalledWith("9007199254740993");
    const select = screen.getByRole("combobox", { name: "按x筛选联动区块" });
    for (const value of [null, false, ""]) {
      fireEvent.change(select, { target: { value: JSON.stringify(value) } });
      expect(selected).toHaveBeenLastCalledWith(value);
    }
    fireEvent.change(select, { target: { value: "" } });
    expect(selected).toHaveBeenLastCalledWith(undefined);
    selected.mockClear();
    rerender(card(true));
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("bar-revenue"));
    expect(selected).not.toHaveBeenCalled();
    expect(source.x).toBe("9007199254740993");
  });

  it("keeps exact measures when the same chart is rendered inside a report", () => {
    const source = { region: "华东", revenue: "9007199254740993.0123" };
    plot.tooltipSource = source;
    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <ReportBlockCard
          block={{
            id: "exact-report", block_type: "chart", title: "区域收入", order_index: 0,
            source_kind: "manual", content: { rows: [source] },
            config: { chart_type: "bar", x_key: "region", y_key: "revenue", number_format: "auto" },
            layout: { x: 0, y: 0, w: 6, h: 4 },
          }}
          editing={false} selected={false} onSelect={() => {}} onMove={() => {}}
          onResize={() => {}} onDuplicate={() => {}} onDelete={() => {}}
        />
      </NextIntlClientProvider>
    );
    expect(screen.getByTestId("bar-revenue")).toHaveAttribute("data-value", "9007199254740994");
    expect(screen.getByTestId("tooltip-value")).toHaveTextContent("9,007,199,254,740,993.0123");
    expect(source.revenue).toBe("9007199254740993.0123");
  });
  it("plots decimal strings but keeps their exact value in the tooltip and table", () => {
    const source = { region: "华东", revenue: "9007199254740993.0123" };
    plot.tooltipSource = source;
    renderChart({
      ...horizontalSpec,
      encoding: { x: { field: "region" }, y: [{ field: "revenue", label: "收入", format: "auto" }] },
      data: [source],
    });
    expect(screen.getByTestId("bar-revenue")).toHaveAttribute("data-value", "9007199254740994");
    expect(screen.getByTestId("tooltip-value")).toHaveTextContent("9,007,199,254,740,993.0123");
    expect(screen.getByRole("cell")).toHaveTextContent("9,007,199,254,740,993.0123");
    expect(source.revenue).toBe("9007199254740993.0123");
  });
  it("renders the declared orientation, series, stacking, and approved palette", () => {
    renderChart(horizontalSpec);

    expect(screen.getByTestId("bar-chart")).toHaveAttribute(
      "data-layout",
      "vertical",
    );
    expect(screen.getByTestId("bar-revenue")).toHaveAttribute(
      "data-name",
      "收入",
    );
    expect(screen.getByTestId("bar-revenue")).toHaveAttribute(
      "data-stack",
      "series",
    );
    expect(screen.getByTestId("bar-revenue")).toHaveAttribute(
      "data-fill",
      "#0f4b3f",
    );
    expect(screen.getByTestId("bar-refund")).toHaveAttribute(
      "data-fill",
      "#166451",
    );
  });

  it("exposes a concise summary and the exact plotted values as an accessible table", () => {
    renderChart(horizontalSpec);

    expect(
      screen.getByRole("img", {
        name: /区域收入，横向柱状图，按区域展示，指标为收入和退款，共 2 条记录/,
      }),
    ).toBeInTheDocument();

    const table = screen.getByRole("table", { name: /区域收入，横向柱状图/ });
    expect(within(table).getByRole("columnheader", { name: "区域" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "收入" })).toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: "华东" })).toBeInTheDocument();
    expect(within(table).getByText("¥120.00")).toBeInTheDocument();
    expect(within(table).getByText("¥20.00")).toBeInTheDocument();
  });

  it("keeps the declared value format when a series has a display label", () => {
    renderChart(horizontalSpec);

    expect(screen.getByTestId("tooltip-value")).toHaveTextContent("¥120.00");
  });
});
