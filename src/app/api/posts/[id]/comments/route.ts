import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

import { grantsAdmin } from "@/lib/access";
import { adminDb, requireUser } from "@/lib/firebase/admin";
import { isPubliclyVisible } from "@/lib/serialize";
import { errorResponse, readJson } from "@/lib/http";
import { consume } from "@/lib/rate-limit";
import {
  LIMITS,
  ValidationError,
  looksLikeSpam,
  parseComment,
  parseId,
  parseName,
} from "@/lib/validate";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * Post a comment.
 *
 * `isAdmin` is derived from the caller's verified token - the same rule the
 * admin portal is gated on - never from the request body. That is the whole
 * reason comments do not go straight to Firestore from the browser: the
 * Ryder badge has to mean something, and it is the only thing distinguishing
 * a Ryder reply, so nothing else gets to assert it.
 */
export async function POST(req: Request, { params }: Params) {
  try {
    const user = await requireUser(req);
    const postId = parseId((await params).id, "post");

    const body = await readJson(req);
    const text = parseComment(body.body);
    const name = parseName(body.name ?? user.name);
    const parentId = body.parentId ? parseId(body.parentId, "parent") : null;

    if (looksLikeSpam(text))
      throw new ValidationError(
        "That looks like spam to our filter. Try again without links or all-caps.",
      );

    // After validation, so a rejected comment does not spend a slot.
    await consume(
      user.uid,
      "comment",
      LIMITS.commentsPerWindow,
      LIMITS.commentWindowMs,
    );

    const db = adminDb();
    const postRef = db.doc(`posts/${postId}`);
    const commentRef = postRef.collection("comments").doc();
    const isAdmin = grantsAdmin(user);

    await db.runTransaction(async (tx) => {
      const post = await tx.get(postRef);
      if (!post.exists) throw new ValidationError("That post no longer exists.");
      if (post.data()?.mergedInto)
        throw new ValidationError(
          "This post was merged into another. Comment there instead.",
        );
      // Admins can reply during review — that is how a "can you clarify?"
      // conversation happens before publication. Everyone else has to wait,
      // and in practice the only other person who can even see the thread is
      // the author.
      if (!isPubliclyVisible(post.data()) && !isAdmin)
        throw new ValidationError(
          "This idea is still being reviewed. Comments open when it is published.",
        );

      if (parentId) {
        const parent = await tx.get(postRef.collection("comments").doc(parentId));
        if (!parent.exists)
          throw new ValidationError("The comment you replied to is gone.");
        // One level of nesting only. Replies to replies attach to the root,
        // which keeps the thread readable on a phone.
        if (parent.data()?.parentId)
          throw new ValidationError("Replies only nest one level deep.");
      }

      tx.set(commentRef, {
        body: text,
        authorId: user.uid,
        authorName: name,
        isAdmin,
        parentId,
        createdAt: FieldValue.serverTimestamp(),
      });

      tx.update(postRef, {
        commentCount: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return NextResponse.json({ id: commentRef.id }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
