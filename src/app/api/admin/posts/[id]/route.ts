import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

import { adminDb, requireAdmin } from "@/lib/firebase/admin";
import { errorResponse, readJson } from "@/lib/http";
import type { Moderation, PostStatus } from "@/lib/types";
import {
  ValidationError,
  clean,
  parseId,
  parseModeration,
  parseReviewNote,
  parseStatus,
} from "@/lib/validate";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * Admin edit of a single post: moderation, status, pin, roadmap note, ETA,
 * tags.
 *
 * A status change is what moves an item onto the public roadmap, so it is
 * also appended to the post's event timeline. Customers can therefore see
 * *when* something became "planned" and who said so, rather than watching
 * items silently teleport between columns.
 *
 * Moderation and status arrive together on purpose. Reviewing an idea is one
 * decision with two halves — "yes, publish this" and "and it belongs in
 * Planned" — and splitting them into two requests would mean an idea briefly
 * appearing on the public board at the wrong status, plus two rows in the
 * timeline for one human action.
 *
 * `isPublic` is derived here and nowhere else. It is the single field public
 * queries and security rules key off, so every path that could change
 * visibility — approve, reject, un-approve, merge — has to recompute it, and
 * keeping that arithmetic in one transaction is what stops a post from being
 * listed publicly while marked pending.
 */
export async function PATCH(req: Request, { params }: Params) {
  try {
    const admin = await requireAdmin(req);
    const postId = parseId((await params).id, "post");
    const body = await readJson(req);

    const db = adminDb();
    const postRef = db.doc(`posts/${postId}`);

    const updates: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    let nextStatus: PostStatus | null = null;
    let nextModeration: Moderation | null = null;

    if (body.status !== undefined) {
      nextStatus = parseStatus(body.status);
      updates.status = nextStatus;
    }
    if (body.moderation !== undefined) {
      nextModeration = parseModeration(body.moderation);
      // A reason is mandatory when rejecting and optional otherwise — see
      // parseReviewNote for why that asymmetry is enforced down there rather
      // than in the UI.
      updates.moderation = nextModeration;
      updates.reviewNote = parseReviewNote(
        body.reviewNote,
        nextModeration === "rejected",
      );
      updates.reviewedAt =
        nextModeration === "pending" ? null : FieldValue.serverTimestamp();
    }
    if (body.pinned !== undefined) updates.pinned = Boolean(body.pinned);
    if (body.roadmapNote !== undefined)
      updates.roadmapNote = clean(body.roadmapNote, 200) || null;
    if (body.eta !== undefined) updates.eta = clean(body.eta, 40) || null;
    if (body.tags !== undefined) {
      if (!Array.isArray(body.tags)) throw new ValidationError("tags must be an array.");
      updates.tags = body.tags
        .slice(0, 8)
        .map((t) => clean(t, 24).toLowerCase())
        .filter(Boolean);
    }

    if (Object.keys(updates).length === 1)
      throw new ValidationError("Nothing to update.");

    const actorName = clean(admin.name ?? "Ryder team", 60) || "Ryder team";

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(postRef);
      if (!snap.exists) throw new ValidationError("That post no longer exists.");
      const prev = snap.data() ?? {};

      // Anything written before moderation existed is treated as already
      // approved, matching toPost()'s fallback — so an old post does not get
      // yanked off the board the first time an admin edits its ETA.
      const prevModeration = (prev.moderation as Moderation) ?? "approved";
      const moderation = nextModeration ?? prevModeration;
      const moderationChanged =
        nextModeration !== null && nextModeration !== prevModeration;

      if (moderationChanged) {
        updates.reviewerName = actorName;
      }

      // Merged posts stay hidden whatever their moderation says: a duplicate
      // that an admin approves should still not reappear beside the ticket it
      // was folded into.
      updates.isPublic = moderation === "approved" && !prev.mergedInto;

      tx.update(postRef, updates);

      // boards.postCount counts what the public can see, so it moves on the
      // approve/un-approve edge rather than on submission.
      const boardId = typeof prev.boardId === "string" ? prev.boardId : null;
      if (boardId && moderationChanged) {
        const wasCounted = prevModeration === "approved";
        const isCounted = moderation === "approved";
        if (wasCounted !== isCounted) {
          tx.update(db.doc(`boards/${boardId}`), {
            postCount: FieldValue.increment(isCounted ? 1 : -1),
          });
        }
      }

      if (moderationChanged) {
        tx.set(postRef.collection("events").doc(), {
          type: moderation === "approved" ? "approved" : "rejected",
          from: null,
          to: nextStatus ?? (prev.status as PostStatus) ?? null,
          actorName,
          message: (updates.reviewNote as string | null) ?? null,
          createdAt: FieldValue.serverTimestamp(),
        });
      }

      if (nextStatus && prev.status !== nextStatus) {
        tx.set(postRef.collection("events").doc(), {
          type: "status",
          from: prev.status ?? null,
          to: nextStatus,
          actorName,
          message: clean(body.note, 200) || null,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Merge this post into another (duplicate handling).
 *
 * Votes are *transferred*, not discarded: every voter on the duplicate who
 * has not already voted on the target gets a real receipt there, and the
 * target's counter is bumped by exactly that number. So merging two posts
 * with 40 and 30 votes that share 5 voters gives you 65, not 70 and not 40.
 * Getting this wrong is the classic feedback-board bug — it either inflates
 * demand or throws away the signal you merged for.
 */
export async function POST(req: Request, { params }: Params) {
  try {
    const admin = await requireAdmin(req);
    const sourceId = parseId((await params).id, "post");
    const body = await readJson(req);

    if (body.action !== "merge")
      throw new ValidationError("Unsupported action.");

    const targetId = parseId(body.targetId, "target");
    if (targetId === sourceId)
      throw new ValidationError("A post cannot be merged into itself.");

    const db = adminDb();
    const sourceRef = db.doc(`posts/${sourceId}`);
    const targetRef = db.doc(`posts/${targetId}`);

    const [source, target] = await Promise.all([sourceRef.get(), targetRef.get()]);
    if (!source.exists || !target.exists)
      throw new ValidationError("Both posts must exist.");
    if (target.data()?.mergedInto)
      throw new ValidationError("The target post is itself already merged.");
    if (source.data()?.mergedInto)
      throw new ValidationError("This post is already merged.");

    // Read both voter sets outside the transaction: these can be large, and
    // the set difference is what we actually need to write.
    const [sourceVotes, targetVotes] = await Promise.all([
      sourceRef.collection("votes").get(),
      targetRef.collection("votes").get(),
    ]);

    const alreadyThere = new Set(targetVotes.docs.map((d) => d.id));
    const incoming = sourceVotes.docs
      .map((d) => d.id)
      .filter((uid) => !alreadyThere.has(uid));

    const actorName = clean(admin.name ?? "Ryder team", 60) || "Ryder team";

    // Each transferred voter needs both the receipt on the target and an
    // entry in their own vote index, so their UI agrees with the server.
    // Chunked at 200 voters (two writes each) to stay under the 500-write
    // ceiling on a single commit.
    const CHUNK = 200;
    for (let i = 0; i < incoming.length; i += CHUNK) {
      const batch = db.batch();
      for (const uid of incoming.slice(i, i + CHUNK)) {
        batch.set(targetRef.collection("votes").doc(uid), {
          createdAt: FieldValue.serverTimestamp(),
        });
        batch.set(db.doc(`users/${uid}/myVotes/${targetId}`), {
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }

    const finalBatch = db.batch();
    finalBatch.update(targetRef, {
      voteCount: FieldValue.increment(incoming.length),
      updatedAt: FieldValue.serverTimestamp(),
    });
    finalBatch.update(sourceRef, {
      mergedInto: targetId,
      // The duplicate drops out of every public query the moment it is
      // merged. isPublic is the only field those queries filter on, so this
      // line is what actually hides it.
      isPublic: false,
      pinned: false,
      updatedAt: FieldValue.serverTimestamp(),
    });
    finalBatch.set(sourceRef.collection("events").doc(), {
      type: "merged",
      from: null,
      to: null,
      actorName,
      message: `Merged into ${target.data()?.title ?? targetId}`,
      createdAt: FieldValue.serverTimestamp(),
    });
    finalBatch.set(targetRef.collection("events").doc(), {
      type: "merged",
      from: null,
      to: null,
      actorName,
      message: `Absorbed "${source.data()?.title ?? sourceId}" (+${incoming.length} votes)`,
      createdAt: FieldValue.serverTimestamp(),
    });
    await finalBatch.commit();

    return NextResponse.json({
      ok: true,
      votesTransferred: incoming.length,
      duplicatesSkipped: sourceVotes.size - incoming.length,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
