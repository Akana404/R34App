// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchBar } from "@/components/SearchBar";

function renderBar(tags: string[] = []) {
  const onChange = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <SearchBar tags={tags} onChange={onChange} />
    </QueryClientProvider>,
  );
  return { onChange, user: userEvent.setup() };
}

function suggest(...values: string[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => values.map((v) => ({ label: `${v} (10)`, value: v })),
    })),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  suggest();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

describe("SearchBar", () => {
  it("adds a typed tag on Enter and clears the input", async () => {
    const { onChange, user } = renderBar();
    const input = screen.getByPlaceholderText("Search tags…");
    await user.type(input, "miku{Enter}");
    expect(onChange).toHaveBeenCalledWith(["miku"]);
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("keeps existing tags when adding another", async () => {
    const { onChange, user } = renderBar(["miku"]);
    await user.type(screen.getByRole("combobox"), "vocaloid{Enter}");
    expect(onChange).toHaveBeenCalledWith(["miku", "vocaloid"]);
  });

  it("refuses to add the same tag twice", async () => {
    const { onChange, user } = renderBar(["miku"]);
    await user.type(screen.getByRole("combobox"), "miku{Enter}");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("removes a tag through its chip button", async () => {
    const { onChange, user } = renderBar(["miku", "vocaloid"]);
    await user.click(screen.getByRole("button", { name: "Remove miku" }));
    expect(onChange).toHaveBeenCalledWith(["vocaloid"]);
  });

  it("says so when suggestions can't be fetched, instead of nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    );
    const { user } = renderBar();
    await user.type(screen.getByRole("combobox"), "mi");
    await waitFor(() =>
      expect(screen.getByText(/Suggestions are unavailable/)).toBeTruthy(),
    );
  });

  it("announces the suggestion list as a listbox with options", async () => {
    suggest("miku");
    const { user } = renderBar();
    const input = screen.getByRole("combobox");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    await user.type(input, "mi");
    await waitFor(() => expect(screen.getByRole("listbox")).toBeTruthy());
    expect(input.getAttribute("aria-expanded")).toBe("true");
    const option = screen.getByRole("option", { name: "miku (10)" });
    expect(option.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(option.id);
  });

  it("backspaces the last tag when the input is empty", async () => {
    const { onChange, user } = renderBar(["miku", "vocaloid"]);
    await user.click(screen.getByRole("combobox"));
    await user.keyboard("{Backspace}");
    expect(onChange).toHaveBeenCalledWith(["miku"]);
  });

  it("suggests tags once the query is long enough", async () => {
    suggest("miku", "miku_hatsune");
    const { user } = renderBar();
    await user.type(screen.getByRole("combobox"), "mi");
    await waitFor(() => expect(screen.getByText("miku (10)")).toBeTruthy());
    expect(fetch).toHaveBeenCalled();
  });

  it("does not query the API for a single character", async () => {
    const { user } = renderBar();
    await user.type(screen.getByRole("combobox"), "m");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("adds the highlighted suggestion with the arrow keys", async () => {
    suggest("miku", "miku_hatsune");
    const { onChange, user } = renderBar();
    await user.type(screen.getByRole("combobox"), "mi");
    await waitFor(() => expect(screen.getByText("miku_hatsune (10)")).toBeTruthy());
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith(["miku_hatsune"]);
  });

  it("adds a suggestion on click", async () => {
    suggest("miku");
    const { onChange, user } = renderBar();
    await user.type(screen.getByRole("combobox"), "mi");
    await waitFor(() => expect(screen.getByText("miku (10)")).toBeTruthy());
    await user.click(screen.getByText("miku (10)"));
    expect(onChange).toHaveBeenCalledWith(["miku"]);
  });

  it("closes the suggestion list on Escape", async () => {
    suggest("miku");
    const { user } = renderBar();
    await user.type(screen.getByRole("combobox"), "mi");
    await waitFor(() => expect(screen.getByText("miku (10)")).toBeTruthy());
    await user.keyboard("{Escape}");
    expect(screen.queryByText("miku (10)")).toBeNull();
  });
});
