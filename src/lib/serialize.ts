import type { Comment, Moderation, Post, PostEvent } from "./types";

/**
 * Firestore hands back Timestamps from the client SDK and a different
 * Timestamp class from the admin SDK. Both expose toMillis(). Server
 * components also need plain numbers so payloads stay serialisable across
 * the RSC boundary, so everything is normalised here, once.
 */
type TimestampLike = { toMillis: () => number } | number | null | undefined;

export function ms(value: TimestampLike, fallback = 0): number {
  if (value == null) return fallback;
  if (typeof value === "number") return value;
  if (typeof value.toMillis === "function") return value.toMillis();
  return fallback;
}

type Doc = { id: string; data: () => Record<string, unknown> | undefined };

export function toPost(doc: Doc): Post {
  const d = doc.data() ?? {};
  const created = ms(d.createdAt as TimestampLike, Date.now());
  return {
    id: doc.id,
    title: String(d.title ?? ""),
    body: String(d.body ?? ""),
    boardId: String(d.boardId ?? ""),
    status: (d.status as Post["status"]) ?? "open",
    authorId: String(d.authorId ?? ""),
    authorName: String(d.authorName ?? "Anonymous"),
    voteCount: Number(d.voteCount ?? 0),
    commentCount: Number(d.commentCount ?? 0),
    pinned: Boolean(d.pinned),
    // Documents written before moderation existed have neither field. They
    // are live posts on a running board, so they read as approved rather
    // than silently disappearing behind the new gate. scripts/backfill.mjs
    // writes the real values; this is the safety net if it has not run.
    moderation: ((d.moderation as Moderation | undefined) ?? "approved"),
    isPublic:
      d.isPublic === undefined ? d.mergedInto == null : Boolean(d.isPublic),
    reviewedAt: d.reviewedAt == null ? null : ms(d.reviewedAt as TimestampLike),
    reviewerName: (d.reviewerName as string | null) ?? null,
    reviewNote: (d.reviewNote as string | null) ?? null,
    mergedInto: (d.mergedInto as string | null) ?? null,
    roadmapNote: (d.roadmapNote as string | null) ?? null,
    eta: (d.eta as string | null) ?? null,
    tags: Array.isArray(d.tags) ? (d.tags as string[]) : [],
    createdAt: created,
    updatedAt: ms(d.updatedAt as TimestampLike, created),
  };
}

export function toComment(doc: Doc, postId: string): Comment {
  const d = doc.data() ?? {};
  return {
    id: doc.id,
    postId,
    body: String(d.body ?? ""),
    authorId: String(d.authorId ?? ""),
    authorName: String(d.authorName ?? "Anonymous"),
    isAdmin: Boolean(d.isAdmin),
    parentId: (d.parentId as string | null) ?? null,
    createdAt: ms(d.createdAt as TimestampLike, Date.now()),
  };
}

export function toEvent(doc: Doc): PostEvent {
  const d = doc.data() ?? {};
  return {
    id: doc.id,
    type: (d.type as PostEvent["type"]) ?? "status",
    from: (d.from as PostEvent["from"]) ?? null,
    to: (d.to as PostEvent["to"]) ?? null,
    actorName: String(d.actorName ?? "Ryder"),
    message: (d.message as string | null) ?? null,
    createdAt: ms(d.createdAt as TimestampLike, Date.now()),
  };
}

/**
 * Is this raw post document visible to the public right now?
 *
 * The same compatibility fallback as toPost(): a document written before
 * moderation existed has no `isPublic` field, and it is a live post on a
 * running board, so absence means "yes, unless it was merged away". Kept
 * next to toPost() so the two can never disagree about what an old document
 * means — the server uses this one to decide whether a vote or a comment is
 * allowed, and the client uses toPost() to decide what to draw.
 */
export function isPubliclyVisible(
  data: Record<string, unknown> | undefined,
): boolean {
  if (!data) return false;
  if (data.isPublic === undefined) return data.mergedInto == null;
  return Boolean(data.isPublic);
}
