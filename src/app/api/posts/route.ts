import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

import { adminDb, requireUser } from "@/lib/firebase/admin";
import { errorResponse, readJson } from "@/lib/http";
import { consume } from "@/lib/rate-limit";
import {
  LIMITS,
  ValidationError,
  looksLikeSpam,
  parseBody,
  parseEmail,
  parseId,
  parseName,
  parseTitle,
} from "@/lib/validate";

export const runtime = "nodejs";

/**
 * Create a feedback post.
 *
 * The submitter's email, if they gave one, is written to users/{uid} — which
 * only they and admins can read — and never to the post document. That is
 * the difference between a board you can put in front of customers and one
 * that quietly publishes their contact details.
 *
 * The author also gets an automatic upvote, written in the same transaction
 * as the post, so the counter and the vote receipt can never disagree.
 *
 * Nothing posted here is public yet. A new idea lands as `moderation:
 * "pending"` with `isPublic: false`, which means the security rules serve it
 * to exactly two audiences — its author and an admin — until someone on the
 * team approves it. The author's automatic vote is still recorded, so the
 * count is right the moment it goes live rather than starting at zero after
 * review.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);

    const body = await readJson(req);
    const title = parseTitle(body.title);
    const text = parseBody(body.body);
    const boardId = parseId(body.boardId, "board");
    const name = parseName(body.name ?? user.name);
    const email = parseEmail(body.email ?? user.email);

    if (looksLikeSpam(`${title}\n${text}`))
      throw new ValidationError(
        "That looks like spam to our filter. Try rephrasing without links or all-caps.",
      );

    const db = adminDb();

    const boardSnap = await db.doc(`boards/${boardId}`).get();
    if (!boardSnap.exists) throw new ValidationError("Unknown board.");

    // Rate limiting comes *after* validation on purpose. Charging a slot for
    // a request that was going to be rejected anyway means a mistyped title
    // eats into your quota, and the first thing a confused user does is
    // retry — straight into a 429 they cannot explain.
    await consume(user.uid, "post", LIMITS.postsPerWindow, LIMITS.postWindowMs);

    const postRef = db.collection("posts").doc();

    const userRef = db.doc(`users/${user.uid}`);

    await db.runTransaction(async (tx) => {
      // All reads before all writes — Firestore requires it.
      const existingUser = await tx.get(userRef);

      tx.set(postRef, {
        title,
        body: text,
        boardId,
        status: "open",
        moderation: "pending",
        isPublic: false,
        reviewedAt: null,
        reviewerName: null,
        reviewNote: null,
        authorId: user.uid,
        authorName: name,
        voteCount: 1,
        commentCount: 0,
        pinned: false,
        mergedInto: null,
        roadmapNote: null,
        eta: null,
        tags: [],
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Author's own vote, as a real receipt so the rules-enforced
      // one-vote-per-user invariant holds for them too.
      tx.set(postRef.collection("votes").doc(user.uid), {
        createdAt: FieldValue.serverTimestamp(),
      });
      // ...and its mirror in the author's own vote index, so the arrow is
      // already filled in when the board refreshes.
      tx.set(userRef.collection("myVotes").doc(postRef.id), {
        createdAt: FieldValue.serverTimestamp(),
      });

      tx.set(postRef.collection("events").doc(), {
        type: "created",
        from: null,
        to: "open",
        actorName: name,
        message: null,
        createdAt: FieldValue.serverTimestamp(),
      });

      tx.set(
        userRef,
        {
          uid: user.uid,
          displayName: name,
          ...(email ? { email } : {}),
          isAnonymous: user.firebase?.sign_in_provider === "anonymous",
          updatedAt: FieldValue.serverTimestamp(),
          // Only stamp on first write, so a repeat submitter keeps their
          // original join date.
          ...(existingUser.exists
            ? {}
            : { createdAt: FieldValue.serverTimestamp() }),
        },
        { merge: true },
      );

      // boards.postCount is a public number, so it counts *published* ideas.
      // Incrementing it here would leak the size of the moderation queue to
      // anyone watching the board chips. The approve path owns it instead.
    });

    return NextResponse.json(
      { id: postRef.id, moderation: "pending" },
      { status: 201 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
