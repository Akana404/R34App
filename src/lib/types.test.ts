import { describe, expect, it } from "vitest";
import {
  isGif,
  isVideo,
  postSchema,
  postsResponseSchema,
  autocompleteResponseSchema,
  type Post,
} from "@/lib/types";

const raw = {
  id: 7,
  preview_url: "p",
  sample_url: "s",
  file_url: "https://cdn/images/1/x.jpeg",
  width: 100,
  height: 200,
  sample_width: 50,
  sample_height: 100,
  rating: "explicit",
  score: 3,
  tags: "a b",
  owner: "o",
  change: 1,
};

function post(file_url: string): Post {
  return postSchema.parse({ ...raw, file_url });
}

describe("postSchema", () => {
  it("defaults comment_count, which the API omits on some posts", () => {
    expect(postSchema.parse(raw).comment_count).toBe(0);
  });

  it("accepts the tag_info the API adds for fields=tag_info", () => {
    const parsed = postSchema.parse({
      ...raw,
      tag_info: [{ tag: "miku", count: 40060, type: "character" }],
    });
    expect(parsed.tag_info?.[0].count).toBe(40060);
  });

  it("keeps accepting unfamiliar tag categories", () => {
    const parsed = postSchema.parse({
      ...raw,
      tag_info: [{ tag: "x", count: 1, type: "something_new" }],
    });
    expect(parsed.tag_info?.[0].type).toBe("something_new");
  });

  it("rejects a post missing a field the grid needs", () => {
    const withoutWidth: Record<string, unknown> = { ...raw };
    delete withoutWidth.width;
    expect(() => postSchema.parse(withoutWidth)).toThrow();
  });

  it("validates a whole page of posts", () => {
    expect(postsResponseSchema.parse([raw, raw])).toHaveLength(2);
  });
});

describe("autocompleteResponseSchema", () => {
  it("accepts label/value pairs", () => {
    expect(
      autocompleteResponseSchema.parse([{ label: "miku (5)", value: "miku" }]),
    ).toHaveLength(1);
  });

  it("rejects entries without a value to search for", () => {
    expect(() => autocompleteResponseSchema.parse([{ label: "miku" }])).toThrow();
  });
});

describe("isVideo / isGif", () => {
  it("detects videos by extension, case-insensitively", () => {
    expect(isVideo(post("https://cdn/a.mp4"))).toBe(true);
    expect(isVideo(post("https://cdn/a.WEBM"))).toBe(true);
    expect(isVideo(post("https://cdn/a.jpeg"))).toBe(false);
  });

  it("detects gifs", () => {
    expect(isGif(post("https://cdn/a.gif"))).toBe(true);
    expect(isGif(post("https://cdn/a.mp4"))).toBe(false);
  });

  it("is not fooled by the extension appearing mid-path", () => {
    expect(isVideo(post("https://cdn/mp4/a.jpeg"))).toBe(false);
    expect(isGif(post("https://cdn/gif/a.png"))).toBe(false);
  });
});
