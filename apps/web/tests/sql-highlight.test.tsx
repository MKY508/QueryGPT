import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SqlHighlight } from "@/components/chat/SqlHighlight";
import messages from "@/messages/en.json";

function highlighted(code: string) {
  return <NextIntlClientProvider locale="en" messages={messages}><SqlHighlight code={code} /></NextIntlClientProvider>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SQL highlighting", () => {
  it("uses the light SQL grammar without treating input as HTML", () => {
    const code = "SELECT '<img src=x onerror=alert(1)>' AS name";
    const { container } = render(highlighted(code));
    expect(container.querySelector("pre")).toHaveTextContent(code);
    // The inline theme consumes the keyword class and emits its token style.
    expect(screen.getByText("SELECT", { exact: true })).toHaveStyle({ color: "hsl(286, 60%, 67%)" });
    expect(container.querySelector("img")).toBeNull();
  });

  it("copies the original query and clears stale feedback when the query changes", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { rerender } = render(highlighted("SELECT 1"));
    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith("SELECT 1");
    rerender(highlighted("SELECT 2"));
    expect(screen.getByRole("button", { name: "Copy code" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("handles denied and unavailable clipboard access with retry", async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error("permission denied")).mockResolvedValueOnce(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(highlighted("SELECT 1"));
    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(messages.chat.copyCodeFailed);
    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    await screen.findByRole("button", { name: "Copied" });
    expect(screen.queryByRole("alert")).toBeNull();
    vi.stubGlobal("navigator", {});
    fireEvent.click(screen.getByRole("button", { name: "Copied" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(messages.chat.copyCodeFailed));
  });
});
