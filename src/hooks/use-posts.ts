"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  where,
  type QueryConstraint,
} from "firebase/firestore";

import { getDb } from "@/lib/firebase/client";
import { sortPosts } from "@/lib/ranking";
import { toPost } from "@/lib/serialize";
import type { Moderation, Post, PostStatus, SortMode } from "@/lib/types";

export interface PostsOptions {
  boardId?: string | null;
  status?: PostStatus | null;
  sort: SortMode;
  search?: string;
  max?: number;
  /**
   * Admin escape hatch. Public views leave this alone and get the published
   * board; the admin views pass a moderation bucket (or "all") to see what
   * the public cannot.
   *
   * The security rules are what actually decide: a non-admin sending
   * `scope: "all"` gets a permission error from Firestore, not a wider board.
   */
  scope?: Moderation | "all";
}

/**
 * Live board query.
 *
 * Firestore does the filtering and the coarse ordering it can index; the
 * client does the decay-based trending sort and the text search over the
 * returned page. The split is deliberate — see src/lib/ranking.ts for why
 * trending is not a stored field.
 */
export function usePosts({
  boardId,
  status,
  sort,
  search = "",
  max = 200,
  scope,
}: PostsOptions) {
  const [raw, setRaw] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const constraints: QueryConstraint[] = [];

    // isPublic is "approved by an admin and not merged into another ticket",
    // denormalised to one boolean. Filtering on it is not a convenience: the
    // security rules require exactly this clause before they will serve a
    // list query to anyone without the admin claim, so a public view that
    // forgot it would fail loudly rather than leak the review queue.
    if (!scope) constraints.push(where("isPublic", "==", true));
    else if (scope !== "all") constraints.push(where("moderation", "==", scope));

    if (boardId) constraints.push(where("boardId", "==", boardId));
    if (status) constraints.push(where("status", "==", status));

    // "new" orders by time; trending and top both need the highest-signal
    // candidates, so they order by votes and let the client refine.
    constraints.push(
      sort === "new" ? orderBy("createdAt", "desc") : orderBy("voteCount", "desc"),
    );
    constraints.push(fsLimit(max));

    const unsub = onSnapshot(
      query(collection(getDb(), "posts"), ...constraints),
      (snap) => {
        setRaw(snap.docs.map(toPost));
        setLoading(false);
      },
      (err) => {
        // A missing composite index is the single most common first-run
        // failure, and Firebase puts a one-click creation link in the
        // message, so surface it rather than swallowing it.
        setError(err.message);
        setLoading(false);
      },
    );

    return unsub;
  }, [boardId, status, sort, max, scope]);

  const posts = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? raw.filter(
          (p) =>
            p.title.toLowerCase().includes(term) ||
            p.body.toLowerCase().includes(term) ||
            p.tags.some((t) => t.includes(term)),
        )
      : raw;
    return sortPosts(filtered, sort);
  }, [raw, search, sort]);

  return { posts, loading, error, total: raw.length };
}
