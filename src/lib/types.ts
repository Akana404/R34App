import { z } from "zod";

/** Per-tag metadata, only present when a request asks for `fields=tag_info`. */
export const tagInfoSchema = z.object({
  tag: z.string(),
  count: z.number(),
  // "tag" | "metadata" | "artist" | "character" | "copyright" — kept open,
  // the API is free to introduce more categories.
  type: z.string(),
});

export type TagInfo = z.infer<typeof tagInfoSchema>;

export type TagCategory =
  | "tag"
  | "metadata"
  | "artist"
  | "character"
  | "copyright";

export interface TagMeta {
  /** Posts carrying this tag site-wide — the inverse-document-frequency term. */
  count: number;
  category: TagCategory;
}

export type TagMetaMap = Map<string, TagMeta>;

export const postSchema = z.object({
  id: z.number(),
  preview_url: z.string(),
  sample_url: z.string(),
  file_url: z.string(),
  width: z.number(),
  height: z.number(),
  sample_width: z.number(),
  sample_height: z.number(),
  rating: z.string(),
  score: z.number(),
  tags: z.string(),
  owner: z.string(),
  change: z.number(),
  comment_count: z.number().optional().default(0),
  tag_info: z.array(tagInfoSchema).optional(),
});

export type Post = z.infer<typeof postSchema>;

export const postsResponseSchema = z.array(postSchema);

export const autocompleteEntrySchema = z.object({
  label: z.string(),
  value: z.string(),
});

export type AutocompleteEntry = z.infer<typeof autocompleteEntrySchema>;

export const autocompleteResponseSchema = z.array(autocompleteEntrySchema);

export const PAGE_SIZE = 100;

export function isVideo(post: Post): boolean {
  return /\.(mp4|webm)$/i.test(post.file_url);
}

export function isGif(post: Post): boolean {
  return /\.gif$/i.test(post.file_url);
}
