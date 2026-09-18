import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

import { adminDb, requireUser } from "@/lib/firebase/admin";
import { isPubliclyVisible } from "@/lib/serialize";
import { errorResponse, readJson } from "@/lib/http";
import { consumeWithin, limitRef } from "@/lib/rate-limit";
import { ValidationError, parseId } from "@/lib/validate";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * Cast or withdraw a vote.
 *
 * Why this is a server route rather than a direct Firestore write.
 *
 * The tempting design is to let the browser write the vote receipt and a
 * +1 on the post's counter in one batch, with security rules checking that
 * the counter moved by exactly one and that no receipt already exists. It
 * looks airtight and it is not: rules evaluate each write in a batch
 * independently, against the state *before* the batch. So the rule guarding
 * the counter cannot tell "an increment accompanied by a new receipt" from
 * "an increment on its own". A client that simply never writes the receipt
 * passes the `!hasVoted` check every single time and can inflate the counter
 * without limit. tests/rules.test.mjs has that exact case.
 *
 * So the counter is not client-writable at all. This transaction is the only
 * thing that touches it, and because the receipt lives at
 * posts/{id}/votes/{uid} — document id *is* the uid — a duplicate vote has
 * nowhere to go. The read and the write happen in one transaction, so two
 * concurrent taps cannot both see "not voted yet".
 *
 * The cost is one function invocation per vote and no offline voting. The UI
 * hides the latency by updating optimistically. If you later want true
 * offline voting, the way to get it is a Cloud Function triggered on the
 * votes subcollection maintaining the counter, which needs the Blaze plan;
 * this route is the version that runs entirely on Vercel plus Firestore.
 *
 * On the round-trip budget, because this is the one hot path in the app.
 * Every Firestore transaction costs two trips — one to open and read, one to
 * commit — and at ~260ms each from a dev machine those dominate the request.
 * So this route spends exactly two: the rate-limit window is read alongside
 * the post and the receipt in a single batched read, and consumed inside this
 * transaction rather than in its own. It also skips the revocation check on
 * the caller's token, which is a live call to Firebase Auth. That is a
 * deliberate trade specific to voting — see the call site.
 */
export async function POST(req: Request, { params }: Params) {
  try {
    // No revocation check here. Verifying that costs a live call to Firebase
    // Auth on every vote; skipping it makes verification a local signature
    // check instead. The window it opens is that someone signed out moments
    // ago could still cast a vote until their token expires — and a vote is
    // one increment on a counter, capped at one per user by the receipt
    // below, and reversible. Comments and admin actions keep the check,
    // because there the stale token would buy real authority (the Ryder
    // badge, a status change) rather than a +1.
    const user = await requireUser(req, { checkRevoked: false });
    const postId = parseId((await params).id, "post");
    const body = await readJson(req);
    const remove = body.remove === true;

    const db = adminDb();
    const postRef = db.doc(`posts/${postId}`);
    const receiptRef = postRef.collection("votes").doc(user.uid);
    const indexRef = db.doc(`users/${user.uid}/myVotes/${postId}`);
    const rateRef = limitRef(user.uid, "vote");

    const result = await db.runTransaction(async (tx) => {
      // Every read up front and in one batch: three documents for the price
      // of a single round trip, and Firestore requires reads before writes
      // regardless.
      const [post, receipt, rate] = await Promise.all([
        tx.get(postRef),
        tx.get(receiptRef),
        tx.get(rateRef),
      ]);

      if (!post.exists) throw new ValidationError("That post no longer exists.");
      if (post.data()?.mergedInto)
        throw new ValidationError(
          "This post was merged into another. Vote there instead.",
        );
      // An idea still in review is visible to its author, so the vote button
      // is reachable. Votes cast before publication would be a way to seed a
      // ranking the public never got a chance to influence, so the server
      // refuses them — the author's automatic vote from submission is the one
      // exception, and it is already recorded.
      if (!isPubliclyVisible(post.data()))
        throw new ValidationError(
          "This idea is still being reviewed. Voting opens when it is published.",
        );

      // After validation, so a rejected vote never spends a slot — but before
      // the idempotent early returns below, so hammering this endpoint with
      // no-op requests still burns quota. Generous, but enough to stop a
      // script going at a single post.
      consumeWithin(tx, rate, "vote", 60, 60_000);

      const current = Number(post.data()?.voteCount ?? 0);

      if (remove) {
        if (!receipt.exists) return { voted: false, voteCount: current };
        tx.delete(receiptRef);
        tx.delete(indexRef);
        tx.update(postRef, { voteCount: FieldValue.increment(-1) });
        return { voted: false, voteCount: Math.max(0, current - 1) };
      }

      // Idempotent on purpose: a double-tap or a retried request is a no-op,
      // not an error and not a second vote.
      if (receipt.exists) return { voted: true, voteCount: current };

      tx.set(receiptRef, { createdAt: FieldValue.serverTimestamp() });
      tx.set(indexRef, { createdAt: FieldValue.serverTimestamp() });
      tx.update(postRef, { voteCount: FieldValue.increment(1) });
      return { voted: true, voteCount: current + 1 };
    });

    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
