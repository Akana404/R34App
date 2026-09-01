// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MasonryColumns } from "@/components/MasonryColumns";
import type { Post } from "@/lib/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

/** jsdom has no matchMedia; report "no breakpoint matched" so the mobile
 * column count applies, which is what these tests are about. */
function stubMatchMedia() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function post(id: number, width = 100, height = 100): Post {
  return {
    id,
    preview_url: `p${id}`,
    sample_url: `s${id}`,
    file_url: `f${id}.jpg`,
    width,
    height,
    sample_width: width,
    sample_height: height,
    rating: "explicit",
    score: 1,
    tags: `t${id}`,
    owner: "o",
    change: 0,
    comment_count: 0,
  };
}

/** The rendered posts, in DOM order (column by column). */
function renderedIds(container: HTMLElement): number[] {
  return [...container.querySelectorAll("img[alt^='post ']")].map((img) =>
    Number(img.getAttribute("alt")!.replace("post ", "")),
  );
}

beforeEach(() => {
  localStorage.clear();
  stubMatchMedia();
});

// Without vitest globals, testing-library doesn't register its own cleanup.
afterEach(cleanup);

describe("MasonryColumns", () => {
  it("splits posts across the requested number of mobile columns", () => {
    const posts = Array.from({ length: 6 }, (_, i) => post(i + 1));
    const { container, rerender } = render(
      <MasonryColumns posts={posts} mobileColumns={2} />,
    );
    const columns = container.firstElementChild!.children;
    expect(columns).toHaveLength(2);
    expect(within(columns[0] as HTMLElement).getAllByRole("img")).toHaveLength(3);

    rerender(<MasonryColumns posts={posts} mobileColumns={1} />);
    expect(container.firstElementChild!.children).toHaveLength(1);
  });

  it("fills the shortest column, using the aspect ratio as the height estimate", () => {
    // A tall first post should send the next ones to the other column.
    const posts = [post(1, 100, 400), post(2, 100, 100), post(3, 100, 100)];
    const { container } = render(
      <MasonryColumns posts={posts} mobileColumns={2} />,
    );
    const columns = [...container.firstElementChild!.children] as HTMLElement[];
    expect(renderedIdsIn(columns[0])).toEqual([1]);
    expect(renderedIdsIn(columns[1])).toEqual([2, 3]);
  });

  it("never moves already-visible posts when a page is appended", () => {
    const first = Array.from({ length: 12 }, (_, i) =>
      post(i + 1, 100, 100 + ((i * 37) % 200)),
    );
    const { container, rerender } = render(
      <MasonryColumns posts={first} mobileColumns={2} />,
    );
    const before = renderedIds(container);

    const second = [
      ...first,
      ...Array.from({ length: 12 }, (_, i) =>
        post(i + 13, 100, 100 + ((i * 53) % 200)),
      ),
    ];
    rerender(<MasonryColumns posts={second} mobileColumns={2} />);
    const after = renderedIds(container).filter((id) => id <= 12);
    expect(after).toEqual(before);
  });

  it("opens the lightbox on the post that was clicked", async () => {
    const user = userEvent.setup();
    const posts = Array.from({ length: 4 }, (_, i) => post(i + 1));
    render(<MasonryColumns posts={posts} mobileColumns={1} />);
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByAltText("post 3"));
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toBe("Post 3");
    // Position within the feed, not within a column.
    expect(within(dialog).getByText(/3\/4/)).toBeTruthy();
  });

  it("offers 'not interested' only where the feed learns from it", async () => {
    const posts = [post(1)];
    const { rerender } = render(
      <MasonryColumns posts={posts} mobileColumns={1} />,
    );
    expect(screen.queryByRole("button", { name: "Not interested" })).toBeNull();

    rerender(<MasonryColumns posts={posts} mobileColumns={1} dismissable />);
    expect(screen.getByRole("button", { name: "Not interested" })).toBeTruthy();
  });
});

function renderedIdsIn(column: HTMLElement): number[] {
  return [...column.querySelectorAll("img[alt^='post ']")].map((img) =>
    Number(img.getAttribute("alt")!.replace("post ", "")),
  );
}
