import { NextResponse } from "next/server";

import { grantsAdmin } from "@/lib/access";
import { requireUser } from "@/lib/firebase/admin";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";

/**
 * Who am I, according to the server?
 *
 * The client could read the admin claim out of its own token, but a claim
 * that was revoked mid-session would still look valid there. This route
 * verifies the token with `checkRevoked` on every call, so the admin UI is
 * gated on the server's answer and disappears the moment access is pulled.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    return NextResponse.json(
      {
        uid: user.uid,
        name: user.name ?? null,
        email: user.email ?? null,
        isAnonymous: user.firebase?.sign_in_provider === "anonymous",
        isAdmin: grantsAdmin(user),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
