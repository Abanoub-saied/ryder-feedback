import "server-only";

import {
  FieldValue,
  type DocumentReference,
  type DocumentSnapshot,
  type Transaction,
} from "firebase-admin/firestore";
import { adminDb } from "./firebase/admin";

export class RateLimitError extends Error {
  readonly status = 429;
  constructor(readonly retryAfterSec: number) {
    super(
      `Slow down a moment. Try again in ${retryAfterSec}s.`,
    );
  }
}

/** Where a user's window for one action lives. */
export function limitRef(uid: string, action: string): DocumentReference {
  return adminDb().doc(`rateLimits/${uid}_${action}`);
}

/**
 * The sliding-window arithmetic, shared by both forms below.
 *
 * Drops the timestamps that have aged out, refuses if what is left already
 * fills the quota, and otherwise returns the list with `now` appended. Throws
 * *before* the caller writes anything, which is what lets a refused request
 * cost nothing.
 */
function nextHits(
  snap: DocumentSnapshot,
  now: number,
  max: number,
  windowMs: number,
): number[] {
  const cutoff = now - windowMs;
  const hits: number[] = snap.exists
    ? ((snap.data()?.hits as number[] | undefined) ?? []).filter(
        (t) => t > cutoff,
      )
    : [];

  if (hits.length >= max) {
    const oldest = Math.min(...hits);
    throw new RateLimitError(
      Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    );
  }

  return [...hits, now];
}

/**
 * Firestore-backed sliding window, keyed by uid + action.
 *
 * A single transaction reads the stored timestamps, drops the expired ones
 * and appends the new one, so two requests racing from the same user cannot
 * both slip through. Anonymous auth means a determined person can mint a new
 * uid, which is exactly what App Check is for (see SETUP.md) — this is the
 * cheap first line, not the only one.
 *
 * Note that this owns its transaction, which costs a round trip to open and
 * another to commit. On a hot path that is worth avoiding: see
 * `consumeWithin` and the vote route for the version that shares the caller's
 * transaction instead.
 */
export async function consume(
  uid: string,
  action: string,
  max: number,
  windowMs: number,
): Promise<void> {
  const ref = limitRef(uid, action);

  await adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const hits = nextHits(snap, Date.now(), max, windowMs);
    tx.set(
      ref,
      { hits, action, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  });
}

/**
 * The same window, consumed inside a transaction the caller already owns.
 *
 * The caller reads the limit document itself — batched alongside whatever
 * else it needs, so the read is free in round-trip terms — and hands the
 * snapshot here. That collapses rate limiting from its own two round trips
 * (open + commit) down to zero extra.
 *
 * Firestore requires every read in a transaction to precede every write, so
 * this must be called after the caller has finished reading. It throws
 * RateLimitError before writing anything, so an over-quota request still
 * leaves no trace.
 */
export function consumeWithin(
  tx: Transaction,
  snap: DocumentSnapshot,
  action: string,
  max: number,
  windowMs: number,
): void {
  const hits = nextHits(snap, Date.now(), max, windowMs);
  tx.set(
    snap.ref,
    { hits, action, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
}
