// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useFocusTrap } from "@/lib/useFocusTrap";

function Dialog({ active = true, empty = false, hidden = false }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, active);
  return (
    <div ref={ref} tabIndex={-1} role="dialog">
      {!empty && (
        <>
          <button>first</button>
          <button>middle</button>
          <button>last</button>
          {/* A responsive duplicate: in the DOM, never rendered. */}
          {hidden && <button style={{ display: "none" }}>hidden</button>}
        </>
      )}
    </div>
  );
}

function Page({ show = true, ...props }) {
  return (
    <>
      <button>outside before</button>
      {show && <Dialog {...props} />}
      <button>outside after</button>
    </>
  );
}

afterEach(cleanup);

describe("useFocusTrap", () => {
  it("moves focus into the dialog when it opens", () => {
    render(<Page />);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("wraps from the last control back to the first", async () => {
    const user = userEvent.setup();
    render(<Page />);
    screen.getByText("last").focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByText("first"));
  });

  it("wraps backwards from the first control to the last", async () => {
    const user = userEvent.setup();
    render(<Page />);
    screen.getByText("first").focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByText("last"));
  });

  it("keeps Tab inside even before anything has been focused", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByText("last"));
  });

  it("holds focus in a dialog with nothing focusable in it", async () => {
    const user = userEvent.setup();
    render(<Page empty />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("ignores controls that are in the DOM but not rendered", async () => {
    const user = userEvent.setup();
    render(<Page hidden />);
    screen.getByText("last").focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByText("first"));
  });

  it("leaves focus alone while inactive", () => {
    render(<Page active={false} />);
    expect(document.activeElement).toBe(document.body);
  });

  it("returns focus to whatever opened it", () => {
    const { rerender } = render(<Page show={false} />);
    const opener = screen.getByText("outside before");
    opener.focus();
    rerender(<Page show />);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    rerender(<Page show={false} />);
    expect(document.activeElement).toBe(opener);
  });
});
