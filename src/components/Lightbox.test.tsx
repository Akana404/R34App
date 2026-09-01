// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Lightbox } from "@/components/Lightbox";
import type { Post } from "@/lib/types";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const ensureTagMeta = vi.fn(async () => {});
vi.mock("@/lib/tagmeta", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tagmeta")>(
    "@/lib/tagmeta",
  );
  return { ...actual, ensureTagMeta: () => ensureTagMeta() };
});

function post(id: number, file_url = `f${id}.jpg`, tags = `tag${id} 1girls`): Post {
  return {
    id,
    preview_url: `p${id}`,
    sample_url: `s${id}`,
    file_url,
    width: 800,
    height: 600,
    sample_width: 400,
    sample_height: 300,
    rating: "explicit",
    score: 42,
    tags,
    owner: "o",
    change: 0,
    comment_count: 0,
  };
}

function open(posts: Post[], index = 0, props: Record<string, unknown> = {}) {
  const onIndexChange = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <Lightbox
      posts={posts}
      index={index}
      onIndexChange={onIndexChange}
      onClose={onClose}
      {...props}
    />,
  );
  return { onIndexChange, onClose, user: userEvent.setup(), view };
}

const three = [post(1), post(2), post(3)];

beforeEach(() => {
  localStorage.clear();
  push.mockClear();
  ensureTagMeta.mockClear();
});

afterEach(cleanup);

describe("Lightbox", () => {
  it("shows the post's position in the feed", () => {
    open(three, 1);
    expect(screen.getByText(/2\/3/)).toBeTruthy();
    expect(screen.getByAltText("post 2")).toBeTruthy();
  });

  it("locks page scrolling while open and restores it on close", () => {
    const { view } = open(three);
    expect(document.body.style.overflow).toBe("hidden");
    view.unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("pages with the arrow keys and closes on Escape", async () => {
    const { onIndexChange, onClose, user } = open(three, 1);
    await user.keyboard("{ArrowRight}");
    expect(onIndexChange).toHaveBeenCalledWith(2);
    await user.keyboard("{ArrowLeft}");
    expect(onIndexChange).toHaveBeenCalledWith(0);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("stops at both ends of the feed", async () => {
    const { onIndexChange, user } = open(three, 0);
    await user.keyboard("{ArrowLeft}");
    expect(onIndexChange).not.toHaveBeenCalled();
    cleanup();

    const last = open(three, 2);
    await last.user.keyboard("{ArrowRight}");
    expect(last.onIndexChange).not.toHaveBeenCalled();
  });

  it("plays a video inline instead of linking away", () => {
    const { view } = open([post(1, "clip.mp4")]);
    const video = view.container.querySelector("video");
    expect(video?.getAttribute("src")).toBe("clip.mp4");
    expect(video?.hasAttribute("controls")).toBe(true);
    expect(view.container.querySelector("img[alt='post 1']")).toBeNull();
  });

  it("offers the original file in a new tab", () => {
    open([post(1, "https://cdn/x.jpeg")]);
    const link = screen.getByRole("link", { name: "Open original" });
    expect(link.getAttribute("href")).toBe("https://cdn/x.jpeg");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("likes and unlikes the post it is showing", async () => {
    const { user } = open(three, 0);
    await user.click(screen.getByRole("button", { name: "Like" }));
    expect(JSON.parse(localStorage.getItem("forYou:likes")!)[0].id).toBe(1);
    await user.click(screen.getByRole("button", { name: "Unlike" }));
    expect(JSON.parse(localStorage.getItem("forYou:likes")!)).toEqual([]);
  });

  it("reveals score, rating, size and tags on demand", async () => {
    const { user } = open([post(1)], 0);
    await user.click(screen.getByRole("button", { name: "Post details" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("42")).toBeTruthy();
    expect(within(dialog).getByText("explicit")).toBeTruthy();
    expect(within(dialog).getByText("800×600")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "tag1" })).toBeTruthy();
  });

  it("searches a tag from the details panel and closes", async () => {
    const { onClose, user } = open([post(1)], 0);
    await user.click(screen.getByRole("button", { name: "Post details" }));
    await user.click(screen.getByRole("button", { name: "tag1" }));
    expect(onClose).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/?tags=tag1");
  });

  it("searches the post's distinctive tags for 'more like this'", async () => {
    const { onClose, user } = open([post(1, "f.jpg", "1girls miku_(vocaloid)")]);
    await user.click(screen.getByRole("button", { name: "More like this" }));
    expect(onClose).toHaveBeenCalled();
    // The generic tag is dropped; the qualified one identifies the search.
    expect(push).toHaveBeenCalledWith("/?tags=miku_(vocaloid)");
  });

  it("only offers 'not interested' where the feed learns from it", async () => {
    open(three);
    expect(screen.queryByRole("button", { name: "Not interested" })).toBeNull();
    cleanup();

    const { onIndexChange, user } = open(three, 0, { dismissable: true });
    await user.click(screen.getByRole("button", { name: "Not interested" }));
    expect(JSON.parse(localStorage.getItem("forYou:dismissed")!)[0].id).toBe(1);
    // The feed removes the dismissed post itself, sliding the next one into
    // this index — stepping forward too would skip a post.
    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it("shows the post that slides in after a dismissal, not the one after", async () => {
    const { onIndexChange, user, view } = open(three, 1, { dismissable: true });
    await user.click(screen.getByRole("button", { name: "Not interested" }));
    expect(onIndexChange).not.toHaveBeenCalled();
    // The feed drops post 2; post 3 now sits at index 1.
    view.rerender(
      <Lightbox
        posts={[post(1), post(3)]}
        index={1}
        onIndexChange={onIndexChange}
        onClose={vi.fn()}
        dismissable
      />,
    );
    expect(screen.getByAltText("post 3")).toBeTruthy();
  });

  it("looks up the tags of the post being viewed", () => {
    open(three, 1);
    expect(ensureTagMeta).toHaveBeenCalledTimes(1);
  });

  it("groups the tags it knows the categories of", async () => {
    const { recordTagInfo } = await import("@/lib/tagmeta");
    recordTagInfo([
      { tag: "an_artist", count: 5, type: "artist" },
      { tag: "a_series", count: 5, type: "copyright" },
    ]);
    const { user } = open([post(1, "f.jpg", "sfx an_artist a_series")], 0);
    await user.click(screen.getByRole("button", { name: "Post details" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Artist")).toBeTruthy();
    expect(within(dialog).getByText("From")).toBeTruthy();
    // Undescribed tags stay visible with the general ones.
    expect(within(dialog).getByRole("button", { name: "sfx" })).toBeTruthy();
  });

  it("keeps Tab inside the viewer", async () => {
    const { user } = open(three, 0);
    // Focus starts on the dialog; tabbing forward from the last control
    // must come back round rather than escaping to the page behind.
    const buttons = screen.getAllByRole("button");
    buttons[buttons.length - 1].focus();
    await user.tab();
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(
      true,
    );
  });

  it("stops at the end when the feed has nothing more", async () => {
    const { onIndexChange, user } = open(three, 2);
    await user.keyboard("{ArrowRight}");
    expect(onIndexChange).not.toHaveBeenCalled();
    // Both the desktop and the mobile control are disabled.
    for (const button of screen.getAllByRole("button", { name: "Next post" })) {
      expect(button.hasAttribute("disabled")).toBe(true);
    }
  });

  it("asks the feed for more as the end comes into reach", () => {
    const onNeedMore = vi.fn();
    open(three, 2, { hasMore: true, onNeedMore });
    expect(onNeedMore).toHaveBeenCalled();
  });

  it("does not ask again while a page is already on its way", () => {
    const onNeedMore = vi.fn();
    open(three, 2, { hasMore: true, loadingMore: true, onNeedMore });
    expect(onNeedMore).not.toHaveBeenCalled();
  });

  it("asks once per page, however many times it re-renders", async () => {
    const onNeedMore = vi.fn();
    const { user } = open(three, 1, { hasMore: true, onNeedMore });
    expect(onNeedMore).toHaveBeenCalledTimes(1);
    // Paging, liking and toggling details must not re-trigger the request.
    await user.keyboard("{ArrowRight}");
    await user.click(screen.getByRole("button", { name: "Post details" }));
    expect(onNeedMore).toHaveBeenCalledTimes(1);
  });

  it("steps past the last loaded post and waits there", async () => {
    const { onIndexChange, user } = open(three, 2, {
      hasMore: true,
      loadingMore: true,
    });
    await user.keyboard("{ArrowRight}");
    expect(onIndexChange).toHaveBeenCalledWith(3);

    cleanup();
    // Rendered at that index, the viewer says a page is coming.
    open(three, 3, { hasMore: true, loadingMore: true });
    expect(screen.getByText("Loading more…")).toBeTruthy();
    expect(screen.getByText(/3\/3\+/)).toBeTruthy();
  });

  it("shows the post as soon as the page it was waiting for arrives", () => {
    const four = [...three, post(4)];
    open(four, 3, { hasMore: true });
    expect(screen.getByAltText("post 4")).toBeTruthy();
    expect(screen.queryByText("Loading more…")).toBeNull();
  });

  it("says so when the feed turns out to be exhausted", () => {
    open(three, 3, { hasMore: false });
    expect(screen.getByText(/end of the feed/i)).toBeTruthy();
    // Nothing to act on, so the post actions are inert.
    expect(
      screen.getByRole("button", { name: "Like" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("can still go back from the waiting frame", async () => {
    const { onIndexChange, user } = open(three, 3, { hasMore: true });
    await user.keyboard("{ArrowLeft}");
    expect(onIndexChange).toHaveBeenCalledWith(2);
  });

  it("asks again when a page arrives entirely filtered out", () => {
    const onNeedMore = vi.fn();
    const { onIndexChange, view } = open(three, 3, {
      hasMore: true,
      onNeedMore,
      pagesLoaded: 1,
    });
    expect(onNeedMore).toHaveBeenCalledTimes(1);
    // The next page lands, but every post in it was filtered out: the post
    // count is unchanged, yet paging must not stall on the loading frame.
    view.rerender(
      <Lightbox
        posts={three}
        index={3}
        onIndexChange={onIndexChange}
        onClose={vi.fn()}
        hasMore
        onNeedMore={onNeedMore}
        pagesLoaded={2}
      />,
    );
    expect(onNeedMore).toHaveBeenCalledTimes(2);
  });

  it("waits for the full image again when a new post fills the frame", async () => {
    const { onIndexChange, view } = open(three, 3, { hasMore: true });
    expect(screen.getByText("Loading more…")).toBeTruthy();
    // The awaited page lands and post 4 takes over the current index; its
    // image must start hidden until it has decoded, not inherit `loaded`.
    view.rerender(
      <Lightbox
        posts={[...three, post(4)]}
        index={3}
        onIndexChange={onIndexChange}
        onClose={vi.fn()}
        hasMore
      />,
    );
    const img = screen.getByAltText("post 4");
    expect(img.className).toContain("opacity-0");
  });

  it("closes after dismissing the last post in the feed", async () => {
    const { onClose, user } = open(three, 2, { dismissable: true });
    await user.click(screen.getByRole("button", { name: "Not interested" }));
    expect(onClose).toHaveBeenCalled();
  });
});
