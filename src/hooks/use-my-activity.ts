"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  collectionGroup,
  documentId,
  limit as fsLimit,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import { getDb } from "@/lib/firebase/client";
import { useIdentity } from "@/lib/auth-context";
import { toComment, toPost } from "@/lib/serialize";
import type { Comment, Post } from "@/lib/types";

/** One row in the unified activity feed. */
export type ActivityItem =
  | { kind: "submitted"; at: number; post: Post }
  | { kind: "reviewed"; at: number; post: Post }
  | { kind: "status"; at: number; post: Post }
  | { kind: "voted"; at: number; post: Post }
  | { kind: "commented"; at: number; post: Post | null; comment: Comment };

/**
 * Everything this visitor has done, for /me.
 *
 * Three sources, because that is genuinely how the data is laid out:
 *
 *  - **Ideas** — `posts where authorId == me`. Live, and deliberately not
 *    filtered by isPublic: this is the one place a person can see their own
 *    pending and rejected submissions, which the rules grant precisely
 *    because the query carries their own authorId.
 *  - **Comments** — a collection group query across every post's comments
 *    subcollection. There is no other way to ask "what have I written"
 *    without reading every post on the board.
 *  - **Votes** — `users/{uid}/myVotes` gives the post ids, and the posts
 *    themselves are then fetched by id. Firestore has no join, and `in`
 *    queries cap at 30 ids per request, so this chunks.
 *
 * Ideas and comments are realtime; voted posts are fetched once per change
 * to the vote index rather than held as N live subscriptions, because a
 * person with 60 votes would otherwise open 60 listeners to render one tab.
 */
export function useMyActivity() {
  const { uid, ready } = useIdentity();

  const [ideas, setIdeas] = useState<Post[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [votedPosts, setVotedPosts] = useState<Post[]>([]);
  const [votedIds, setVotedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* --- my ideas ----------------------------------------------------- */
  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(
      query(
        collection(getDb(), "posts"),
        where("authorId", "==", uid),
        orderBy("createdAt", "desc"),
        fsLimit(200),
      ),
      (snap) => {
        setIdeas(snap.docs.map(toPost));
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );
    return unsub;
  }, [uid]);

  /* --- my comments -------------------------------------------------- */
  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(
      query(
        collectionGroup(getDb(), "comments"),
        where("authorId", "==", uid),
        orderBy("createdAt", "desc"),
        fsLimit(200),
      ),
      (snap) =>
        setComments(
          snap.docs.map((d) =>
            // The parent of a comment's collection is its post, which is how
            // a collection group result recovers the id it belongs to.
            toComment(d, d.ref.parent.parent?.id ?? ""),
          ),
        ),
      (err) => setError((prev) => prev ?? err.message),
    );
    return unsub;
  }, [uid]);

  /* --- the posts I voted on ----------------------------------------- */
  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(
      query(
        collection(getDb(), "users", uid, "myVotes"),
        orderBy("createdAt", "desc"),
        fsLimit(200),
      ),
      (snap) => setVotedIds(snap.docs.map((d) => d.id)),
      () => setVotedIds([]),
    );
    return unsub;
  }, [uid]);

  const votedKey = votedIds.join(",");

  useEffect(() => {
    if (!uid || votedIds.length === 0) {
      setVotedPosts([]);
      return;
    }
    let cancelled = false;
    const db = getDb();
    const chunks: string[][] = [];
    // Firestore caps an `in` filter at 30 values, so a heavy voter needs
    // several round trips. They run in parallel and are merged below.
    for (let i = 0; i < votedIds.length; i += 30) {
      chunks.push(votedIds.slice(i, i + 30));
    }

    Promise.all(
      chunks.map((ids) =>
        getDocs(
          query(collection(db, "posts"), where(documentId(), "in", ids)),
        ).catch(() => null),
      ),
    ).then((results) => {
      if (cancelled) return;
      const found = new Map<string, Post>();
      for (const snap of results) {
        if (!snap) continue;
        for (const d of snap.docs) found.set(d.id, toPost(d));
      }
      // Keep the vote index's order — most recently voted first — rather
      // than whatever order the chunks resolved in.
      setVotedPosts(
        votedIds.map((id) => found.get(id)).filter((p): p is Post => Boolean(p)),
      );
    });

    return () => {
      cancelled = true;
    };
    // votedKey stands in for the array so this does not re-run on every
    // snapshot that produced an identical id list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, votedKey]);

  /* --- the merged feed ---------------------------------------------- */

  const postsById = useMemo(() => {
    const map = new Map<string, Post>();
    for (const p of [...ideas, ...votedPosts]) map.set(p.id, p);
    return map;
  }, [ideas, votedPosts]);

  const activity = useMemo<ActivityItem[]>(() => {
    const items: ActivityItem[] = [];

    for (const post of ideas) {
      items.push({ kind: "submitted", at: post.createdAt, post });
      if (post.reviewedAt) {
        items.push({ kind: "reviewed", at: post.reviewedAt, post });
      }
      // A published idea whose status has moved since review is worth a row
      // of its own — "your idea is now In progress" is the update people
      // actually came back for. Without a per-event read this is inferred
      // from updatedAt, so it is only shown when it is unambiguous.
      if (
        post.moderation === "approved" &&
        post.status !== "open" &&
        post.updatedAt > (post.reviewedAt ?? post.createdAt) + 1000
      ) {
        items.push({ kind: "status", at: post.updatedAt, post });
      }
    }

    for (const comment of comments) {
      items.push({
        kind: "commented",
        at: comment.createdAt,
        post: postsById.get(comment.postId) ?? null,
        comment,
      });
    }

    // Votes have no timestamp on the post, and the receipt's own createdAt
    // is not carried here — the vote index is ordered, so position is the
    // only ordering signal available. Rather than invent a time, voted items
    // are excluded from the chronological feed and live in their own tab.

    return items.sort((a, b) => b.at - a.at).slice(0, 100);
  }, [ideas, comments, postsById]);

  return {
    ideas,
    comments,
    votedPosts,
    activity,
    postsById,
    // `loading` is only cleared by the ideas listener, which never runs
    // without a uid. Anonymous sign-in failing would otherwise leave the page
    // on a skeleton forever instead of saying so.
    loading: !ready || (Boolean(uid) && loading),
    error,
    ready,
  };
}
