// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppHeader } from "@/components/AppHeader";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(cleanup);

describe("AppHeader", () => {
  it("renders the search slot and the desktop tabs", () => {
    render(<AppHeader search={<input aria-label="Search tags" />} />);
    expect(screen.getByLabelText("Search tags")).toBeTruthy();
    expect(screen.getByRole("link", { name: "For You" })).toBeTruthy();
  });

  it("has no options button when a page passes no controls", () => {
    render(<AppHeader />);
    expect(screen.queryByRole("button", { name: "Options" })).toBeNull();
  });

  it("opens the controls in a sheet and closes it again", async () => {
    const user = userEvent.setup();
    render(<AppHeader controls={<button>Shuffle</button>} />);
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Options" }));
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByRole("button", { name: "Shuffle" })).toBeTruthy();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the sheet on a control marked to dismiss it", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <AppHeader
        controls={
          <button data-sheet-close onClick={onClick}>
            Shuffle
          </button>
        }
      />,
    );
    await user.click(screen.getByRole("button", { name: "Options" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Shuffle",
      }),
    );
    expect(onClick).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps a control that should not dismiss the sheet open", async () => {
    const user = userEvent.setup();
    render(<AppHeader controls={<button>Hide AI</button>} />);
    await user.click(screen.getByRole("button", { name: "Options" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Hide AI",
      }),
    );
    expect(screen.queryByRole("dialog")).toBeTruthy();
  });

  it("flags on the options button that a filter is not at its default", () => {
    const { container, rerender } = render(
      <AppHeader controls={<button>Sort</button>} />,
    );
    const dot = () => container.querySelectorAll("button[aria-label='Options'] span");
    expect(dot()).toHaveLength(0);

    rerender(<AppHeader controls={<button>Sort</button>} controlsActive />);
    expect(dot()).toHaveLength(1);
  });

  it("keeps Tab inside the open sheet", async () => {
    const user = userEvent.setup();
    render(<AppHeader controls={<button>Sort</button>} />);
    await user.click(screen.getByRole("button", { name: "Options" }));
    const sheet = screen.getByRole("dialog");
    await user.tab();
    await user.tab();
    await user.tab();
    expect(sheet.contains(document.activeElement)).toBe(true);
  });

  it("renders the aside a page gives it", () => {
    render(<AppHeader aside={<p>3 liked posts</p>} />);
    expect(screen.getByText("3 liked posts")).toBeTruthy();
  });

  it("keeps the sheet out of the transformed header, which would trap its positioning", async () => {
    const user = userEvent.setup();
    const { container } = render(<AppHeader controls={<button>Sort</button>} />);
    await user.click(screen.getByRole("button", { name: "Options" }));
    const header = container.querySelector("header")!;
    expect(header.contains(screen.getByRole("dialog"))).toBe(false);
  });
});
