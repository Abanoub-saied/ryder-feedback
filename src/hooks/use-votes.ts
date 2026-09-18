"use client";

import { useCallback, useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";

import { getDb } from "@/lib/firebase/client";
import { useIdentity } from "@/lib/auth-context";

const CACHE_KEY = "ryder.feedback.voted";

/**
 * Tracks which posts the current visitor has voted on, and casts votes.
 *
 * The vote itself goes to POST /api/posts/{id}/vote, which owns the counter
 * inside a transaction — see that file for why this cannot be a direct
 * Firestore write. Everything here is about making a network round trip feel
 * like it isn't one:
 *
 *  - The voted set is painted from localStorage on mount, so the filled-in
 *    arrows are already right before any request completes.
 *  - It is then reconciled against users/{uid}/myVotes, one query for the
 *    whole board rather than a read per card.
 *  - The toggle updates state immediately and rolls back if the request
 *    fails. The live Firestore snapshot corrects the number either way.
 *
 * A stale cache can only ever cause a rejected or no-op request, never a
 * wrong vote: the server is the only writer.
 */
export function useVotes() {
  const { uid, authedFetch } = useIdentity();
  const [voted, setVoted] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Set<string>>(new Set());

  const persist = useCallback((next: Set<string>) => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify([...next]));
    } catch {
      /* private mode: the server copy is the real one anyway */
    }
  }, []);

  // Deferred to an effect rather than a useState initialiser so the server
  // render and the first client render agree.
  useEffect(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) setVoted(new Set<string>(JSON.parse(cached) as string[]));
    } catch {
      /* no-op */
    }
  }, []);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;

    getDocs(collection(getDb(), "users", uid, "myVotes"))
      .then((snap) => {
        if (cancelled) return;
        const server = new Set(snap.docs.map((d) => d.id));
        setVoted(server);
        persist(server);
      })
      .catch(() => {
        /* keep the cached view; the server still decides */
      });

    return () => {
      cancelled = true;
    };
  }, [uid, persist]);

  const toggle = useCallback(
    async (postId: string): Promise<{ ok: boolean; error?: string }> => {
      if (!uid) return { ok: false, error: "Still signing you in, one sec." };
      if (pending.has(postId)) return { ok: false };

      const wasVoted = voted.has(postId);

      setPending((p) => new Set(p).add(postId));
      setVoted((prev) => {
        const next = new Set(prev);
        if (wasVoted) next.delete(postId);
        else next.add(postId);
        persist(next);
        return next;
      });

      try {
        const res = await authedFetch(`/api/posts/${postId}/vote`, {
          method: "POST",
          body: JSON.stringify({ remove: wasVoted }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          voted?: boolean;
          error?: string;
        };

        if (!res.ok) {
          setVoted((prev) => {
            const next = new Set(prev);
            if (wasVoted) next.add(postId);
            else next.delete(postId);
            persist(next);
            return next;
          });
          return { ok: false, error: data.error ?? "Could not save your vote." };
        }

        // Trust the server's answer over our guess.
        if (typeof data.voted === "boolean") {
          setVoted((prev) => {
            const next = new Set(prev);
            if (data.voted) next.add(postId);
            else next.delete(postId);
            persist(next);
            return next;
          });
        }
        return { ok: true };
      } catch {
        setVoted((prev) => {
          const next = new Set(prev);
          if (wasVoted) next.add(postId);
          else next.delete(postId);
          persist(next);
          return next;
        });
        return { ok: false, error: "Network error. Check your connection." };
      } finally {
        setPending((p) => {
          const next = new Set(p);
          next.delete(postId);
          return next;
        });
      }
    },
    [uid, voted, pending, persist, authedFetch],
  );

  return {
    hasVoted: (postId: string) => voted.has(postId),
    isPending: (postId: string) => pending.has(postId),
    /** How many things this browser has voted for, for the board's stat row. */
    count: voted.size,
    toggle,
  };
}
