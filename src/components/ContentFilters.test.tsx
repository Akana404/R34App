// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlockedTagsPanel, RatingSelect } from "@/components/ContentFilters";

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

const stored = (key: string) => JSON.parse(localStorage.getItem(key) ?? "null");

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (): Promise<unknown> => ({ ok: true, json: async () => [] })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RatingSelect", () => {
  it("stores the chosen rating", async () => {
    const user = userEvent.setup();
    render(<RatingSelect />);
    await user.selectOptions(screen.getByLabelText("Rating"), "safe");
    expect(stored("rating")).toBe("safe");
  });

  it("offers every rating plus 'any'", () => {
    render(<RatingSelect />);
    expect(
      [...screen.getByLabelText("Rating").querySelectorAll("option")].map(
        (o) => o.value,
      ),
    ).toEqual(["", "safe", "questionable", "explicit"]);
  });

  it("marks itself when a rating is set", () => {
    const { rerender } = render(<RatingSelect />);
    const select = () => screen.getByLabelText("Rating");
    expect(select().className).toContain("border-neutral-700");

    localStorage.setItem("rating", '"explicit"');
    window.dispatchEvent(new StorageEvent("storage", { key: "rating" }));
    rerender(<RatingSelect />);
    expect(select().className).toContain("border-indigo-500/60");
  });
});

describe("BlockedTagsPanel", () => {
  it("adds a tag to the blacklist", async () => {
    const user = userEvent.setup();
    renderWithQuery(<BlockedTagsPanel />);
    await user.type(screen.getByRole("combobox"), "gore{Enter}");
    expect(stored("blockedTags")).toEqual(["gore"]);
  });

  it("refuses a metatag, which would reshape the query", async () => {
    const user = userEvent.setup();
    renderWithQuery(<BlockedTagsPanel />);
    await user.type(screen.getByRole("combobox"), "sort:random{Enter}");
    expect(stored("blockedTags")).toEqual([]);
  });

  it("removes a blocked tag again", async () => {
    localStorage.setItem("blockedTags", '["gore","scat"]');
    const user = userEvent.setup();
    renderWithQuery(<BlockedTagsPanel />);
    await user.click(screen.getByRole("button", { name: "Remove gore" }));
    expect(stored("blockedTags")).toEqual(["scat"]);
  });

  it("carries its own panel chrome only when standalone", () => {
    const { container, rerender } = renderWithQuery(<BlockedTagsPanel />);
    expect(container.querySelector("section")!.className).not.toContain("border");
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <BlockedTagsPanel standalone />
      </QueryClientProvider>,
    );
    expect(container.querySelector("section")!.className).toContain("border");
  });
});
