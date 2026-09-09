import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ReportActionMenu } from "@/components/reports/ReportActionMenu";

describe("report action menus", () => {
  it("navigates overflow actions, skips disabled actions and returns focus without invoking them", () => {
    const selected = vi.fn();
    function Menu() {
      const [open, setOpen] = useState(false);
      return <><ReportActionMenu label="更多报告操作" icon="…" open={open} onOpenChange={setOpen} actions={[
        { id: "compose", label: "智能整理", icon: "", onSelect: selected },
        { id: "history", label: "版本历史", icon: "", disabled: true, onSelect: selected },
        { id: "refresh", label: "刷新数据", icon: "", onSelect: selected },
      ]} /><button>下一项</button></>;
    }
    render(<Menu />);
    const trigger = screen.getByRole("button", { name: "更多报告操作" });
    fireEvent.keyDown(trigger, { key: "ArrowDown", isComposing: true });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "智能整理" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Escape", keyCode: 229 });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "刷新数据" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(screen.getByRole("menuitem", { name: "智能整理" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(selected).not.toHaveBeenCalled();
    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    expect(screen.getByRole("menuitem", { name: "刷新数据" })).toHaveFocus();
    fireEvent.click(screen.getByRole("menuitem", { name: "刷新数据" }));
    expect(selected).toHaveBeenCalledOnce();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole("button", { name: "下一项" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
