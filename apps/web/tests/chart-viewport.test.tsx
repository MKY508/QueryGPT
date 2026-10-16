import { StrictMode, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChartViewport } from "@/components/chat/ChartViewport";

const observers: { target?: Element; notify: (width: number, height: number) => void; disconnect: ReturnType<typeof vi.fn<() => void>> }[] = [];
function mockObserver() {
  vi.stubGlobal("ResizeObserver", class {
    entry: typeof observers[number];
    constructor(callback: ResizeObserverCallback) {
      this.entry = { disconnect: vi.fn(), notify: (width, height) => callback([
        { target: this.entry.target, contentRect: { width, height } } as ResizeObserverEntry,
      ], this as unknown as ResizeObserver) };
      observers.push(this.entry);
    }
    observe(target: Element) { this.entry.target = target; }
    disconnect() { this.entry.disconnect(); }
  });
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); observers.length = 0; });

function Plot({ width, height, type }: { width?: number; height?: number; type?: string }) {
  return <output aria-label="plot" data-width={width} data-height={height}>{type}</output>;
}

describe("chart viewport", () => {
  it("only mounts plots at real positive sizes and restores parent choices after hiding", () => {
    mockObserver();
    function Viewer() {
      const [type, setType] = useState("bar");
      return <><button onClick={() => setType("line")}>Line</button><input aria-label="draft" />
        <ChartViewport><Plot type={type} /></ChartViewport></>;
    }
    render(<Viewer />);
    expect(screen.queryByLabelText("plot")).not.toBeInTheDocument();
    const observer = observers[0];
    act(() => observer.notify(640.4, 256.2));
    expect(screen.getByLabelText("plot")).toHaveAttribute("data-width", "640");
    expect(screen.getByLabelText("plot")).toHaveAttribute("data-height", "256");
    fireEvent.click(screen.getByText("Line"));
    fireEvent.change(screen.getByLabelText("draft"), { target: { value: "unsaved" } });
    for (const [width, height] of [[0, 0], [640, 0], [NaN, 256], [640, -1]]) {
      act(() => observer.notify(width, height));
      expect(screen.queryByLabelText("plot")).not.toBeInTheDocument();
    }
    act(() => observer.notify(310.2, 256));
    expect(screen.getByLabelText("plot")).toHaveTextContent("line");
    expect(screen.getByLabelText("plot")).toHaveAttribute("data-width", "310");
    expect(screen.getByLabelText("draft")).toHaveValue("unsaved");
  });

  it("disconnects in Strict Mode and ignores notifications from discarded observers", () => {
    mockObserver();
    const view = render(<StrictMode><ChartViewport><Plot /></ChartViewport></StrictMode>);
    expect(observers).toHaveLength(2);
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
    act(() => observers[1].notify(500, 200));
    act(() => observers[0].notify(0, 0));
    expect(screen.getByLabelText("plot")).toHaveAttribute("data-width", "500");
    view.unmount();
    expect(observers[1].disconnect).toHaveBeenCalledOnce();
    act(() => observers[1].notify(600, 220));
    expect(screen.queryByLabelText("plot")).not.toBeInTheDocument();
  });
});
