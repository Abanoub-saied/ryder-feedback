#!/usr/bin/env node
/**
 * End-to-end smoke test against the emulators and a running dev server.
 *
 *   npm run test:e2e
 *
 * Exercises the real route handlers rather than mocks: anonymous sign-in,
 * posting an idea, the admin approval gate, the vote transaction (including
 * double-tap idempotency and unvoting), commenting, the admin domain gate, a
 * status change, and a merge with overlapping voters.
 *
 * Two assertions carry more weight than the rest. The merge arithmetic is
 * the classic place a feedback board silently inflates or discards demand.
 * And the approval gate is checked from the outside — a pending idea is
 * unreadable, unvotable and uncommentable, and the board's published count
 * only moves when a human approves it — because that is a promise made to
 * whoever submits an idea, not just a UI state.
 */

import assert from "node:assert/strict";

const AUTH = "http://127.0.0.1:9099";
const APP = process.env.APP_URL ?? "http://127.0.0.1:3000";
const PROJECT = process.env.FIREBASE_PROJECT_ID ?? "demo-ryder";
const KEY = "demo-key"; // the Auth emulator accepts any API key

let passed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
}

/** Mint an anonymous session straight from the Auth emulator. */
async function signInAnonymously() {
  const res = await fetch(
    `${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ returnSecureToken: true }),
    },
  );
  const data = await res.json();
  if (!data.idToken) throw new Error(`anon sign-in failed: ${JSON.stringify(data)}`);
  return { idToken: data.idToken, uid: data.localId, refreshToken: data.refreshToken };
}

/**
 * Mint a Google session for `email` straight from the Auth emulator.
 *
 * This is the only way to get an admin now: access is a verified Google
 * address on the company domain, with no claim to grant (src/lib/access.ts).
 * The emulator accepts an unsigned ID token as the IdP assertion, so the
 * claims that decide everything - sign_in_provider, email, email_verified -
 * are exactly the ones a real Google sign-in would carry.
 */
async function signInWithGoogle(email, { verified = true } = {}) {
  const assertion = JSON.stringify({
    sub: `google-${email}`,
    email,
    email_verified: verified,
  });
  const res = await fetch(
    `${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        postBody: `id_token=${assertion}&providerId=google.com`,
        requestUri: "http://localhost",
        returnSecureToken: true,
      }),
    },
  );
  const data = await res.json();
  if (!data.idToken)
    throw new Error(`google sign-in failed: ${JSON.stringify(data)}`);
  return {
    idToken: data.idToken,
    uid: data.localId,
    refreshToken: data.refreshToken,
  };
}

async function refresh(refreshToken) {
  const res = await fetch(`${AUTH}/securetoken.googleapis.com/v1/token?key=${KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  const data = await res.json();
  if (!data.id_token) throw new Error(`refresh failed: ${JSON.stringify(data)}`);
  return data.id_token;
}

async function api(path, { token, method = "POST", body } = {}) {
  const res = await fetch(`${APP}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: res.status, json };
}

/**
 * Reads a document through the Firestore emulator REST API.
 *
 * The `Bearer owner` header is the emulator's admin escape hatch. Without it
 * the REST endpoint enforces security rules as an unauthenticated caller,
 * so a private document comes back as a 403 body rather than a document —
 * which is correct behaviour, and exactly what checkDenied() below asserts.
 */
async function getDoc(path, { asOwner = true } = {}) {
  const res = await fetch(
    `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/${path}`,
    asOwner ? { headers: { authorization: "Bearer owner" } } : undefined,
  );
  if (res.status === 404) return null;
  if (res.status === 403) return { __denied: true };
  const data = await res.json();
  const out = {};
  for (const [k, v] of Object.entries(data.fields ?? {})) {
    out[k] =
      v.integerValue !== undefined
        ? Number(v.integerValue)
        : v.stringValue !== undefined
          ? v.stringValue
          : v.booleanValue !== undefined
            ? v.booleanValue
            : v.nullValue !== undefined
              ? null
              : v;
  }
  return out;
}

async function main() {
  console.log(`\nSmoke test against ${APP}\n`);

  const alice = await signInAnonymously();
  const bob = await signInAnonymously();
  const carol = await signInAnonymously();

  // A separate account rather than promoting one of the three above, because
  // an admin is now a different *identity*, not a flag on an existing one:
  // the domain on a verified Google address is the whole credential. Alice,
  // Bob and Carol stay anonymous, which keeps real non-admins around for the
  // "blocks a non-admin" checks below.
  const { idToken: adminToken } = await signInWithGoogle("boss@ryder.id");

  /** Approve a post the way the review queue does, so it becomes public. */
  async function publish(postId, status = "open") {
    const res = await api(`/api/admin/posts/${postId}`, {
      token: adminToken,
      method: "PATCH",
      body: { moderation: "approved", status },
    });
    assert.equal(res.status, 200, `publish failed: ${JSON.stringify(res.json)}`);
  }

  let postA;
  let postB;

  await check("rejects an unauthenticated write", async () => {
    const { status } = await api("/api/posts", {
      body: { title: "No token here", boardId: "app" },
    });
    assert.equal(status, 401);
  });

  await check("rejects a garbage token", async () => {
    const { status } = await api("/api/posts", {
      token: "not-a-real-token",
      body: { title: "Forged token", boardId: "app" },
    });
    assert.equal(status, 401);
  });

  await check("creates a post and gives the author one vote", async () => {
    const { status, json } = await api("/api/posts", {
      token: alice.idToken,
      body: {
        title: "Smoke test: passkey unlock",
        body: "Posted by the e2e suite.",
        boardId: "app",
        name: "Alice",
        email: "alice@example.com",
      },
    });
    assert.equal(status, 201, JSON.stringify(json));
    postA = json.id;
    const doc = await getDoc(`posts/${postA}`);
    assert.equal(doc.voteCount, 1, "author's own vote should be counted");
    assert.equal(doc.status, "open");
    assert.equal(doc.moderation, "pending", "a new idea starts unpublished");
    assert.equal(doc.isPublic, false);
  });

  await check("keeps an unapproved idea off the public board", async () => {
    // The rules, not the UI: an unapproved post is unreadable without a
    // claim, and the routes that would give it traction refuse to run.
    const asPublic = await getDoc(`posts/${postA}`, { asOwner: false });
    assert.ok(
      asPublic === null || asPublic.__denied,
      `a pending idea was publicly readable: ${JSON.stringify(asPublic)}`,
    );

    const vote = await api(`/api/posts/${postA}/vote`, { token: bob.idToken });
    assert.equal(vote.status, 400, "voting must wait for publication");

    const comment = await api(`/api/posts/${postA}/comments`, {
      token: bob.idToken,
      body: { body: "Can I comment on this yet?", name: "Bob" },
    });
    assert.equal(comment.status, 400, "commenting must wait too");

    const stillOne = await getDoc(`posts/${postA}`);
    assert.equal(stillOne.voteCount, 1, "the counter must not have moved");
    assert.equal(stillOne.commentCount, 0);
  });

  await check("blocks a non-admin from publishing an idea", async () => {
    const { status } = await api(`/api/admin/posts/${postA}`, {
      token: bob.idToken,
      method: "PATCH",
      body: { moderation: "approved" },
    });
    assert.equal(status, 403);
    const doc = await getDoc(`posts/${postA}`);
    assert.equal(doc.moderation, "pending", "moderation must not have moved");
  });

  await check("requires a reason before declining", async () => {
    const { status } = await api(`/api/admin/posts/${postA}`, {
      token: adminToken,
      method: "PATCH",
      body: { moderation: "rejected", reviewNote: "  " },
    });
    assert.equal(status, 400, "a silent rejection must not be possible");
  });

  await check("publishes an idea when an admin approves it", async () => {
    const board = await getDoc("boards/app");
    const countBefore = board?.postCount ?? 0;

    await publish(postA);

    const doc = await getDoc(`posts/${postA}`);
    assert.equal(doc.moderation, "approved");
    assert.equal(doc.isPublic, true);
    assert.ok(doc.reviewedAt, "an approval should be timestamped");

    const after = await getDoc("boards/app");
    assert.equal(
      after.postCount,
      countBefore + 1,
      "the board count tracks published ideas, not submissions",
    );
  });

  await check("keeps the submitter's email off the public post", async () => {
    const doc = await getDoc(`posts/${postA}`);
    assert.ok(!("email" in doc), "email must not be on the post document");
    assert.ok(!("authorEmail" in doc));
    // It belongs on the private profile instead...
    const profile = await getDoc(`users/${alice.uid}`);
    assert.ok(profile, `no profile doc at users/${alice.uid}`);
    assert.equal(
      profile.email,
      "alice@example.com",
      `expected the email on the profile; got ${JSON.stringify(profile)}`,
    );

    // ...where the public cannot reach it. Reading the same path without the
    // emulator's owner override goes through the real security rules.
    const asPublic = await getDoc(`users/${alice.uid}`, { asOwner: false });
    assert.ok(
      asPublic === null || asPublic.__denied || !("email" in asPublic),
      `an unauthenticated read exposed the profile: ${JSON.stringify(asPublic)}`,
    );

    // And the post itself is public, so this is not just a blanket denial.
    const publicPost = await getDoc(`posts/${postA}`, { asOwner: false });
    assert.equal(publicPost.title, "Smoke test: passkey unlock");
  });

  await check("rejects a too-short title", async () => {
    const { status } = await api("/api/posts", {
      token: alice.idToken,
      body: { title: "ab", boardId: "app" },
    });
    assert.equal(status, 400);
  });

  await check("rejects an unknown board", async () => {
    const { status } = await api("/api/posts", {
      token: alice.idToken,
      body: { title: "Valid enough title", boardId: "does-not-exist" },
    });
    assert.equal(status, 400);
  });

  await check("rejects a malformed email", async () => {
    const { status } = await api("/api/posts", {
      token: bob.idToken,
      body: { title: "Another fine title", boardId: "app", email: "not-an-email" },
    });
    assert.equal(status, 400);
  });

  await check("counts a second person's vote", async () => {
    const { status, json } = await api(`/api/posts/${postA}/vote`, {
      token: bob.idToken,
    });
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.voted, true);
    assert.equal(json.voteCount, 2);
  });

  await check("treats a double tap as one vote, not two", async () => {
    const first = await api(`/api/posts/${postA}/vote`, { token: bob.idToken });
    const second = await api(`/api/posts/${postA}/vote`, { token: bob.idToken });
    assert.equal(first.json.voteCount, 2);
    assert.equal(second.json.voteCount, 2);
    const doc = await getDoc(`posts/${postA}`);
    assert.equal(doc.voteCount, 2, "the stored counter must not drift");
  });

  await check("survives concurrent taps from the same person", async () => {
    // Five requests at once. The transaction must serialise them into one
    // vote, not five.
    await Promise.all(
      Array.from({ length: 5 }, () =>
        api(`/api/posts/${postA}/vote`, { token: carol.idToken }),
      ),
    );
    const doc = await getDoc(`posts/${postA}`);
    assert.equal(doc.voteCount, 3, `expected 3, got ${doc.voteCount}`);
  });

  await check("withdraws a vote, and withdrawing twice is a no-op", async () => {
    const off = await api(`/api/posts/${postA}/vote`, {
      token: carol.idToken,
      body: { remove: true },
    });
    assert.equal(off.json.voted, false);
    assert.equal(off.json.voteCount, 2);
    const again = await api(`/api/posts/${postA}/vote`, {
      token: carol.idToken,
      body: { remove: true },
    });
    assert.equal(again.json.voteCount, 2);
  });

  await check("accepts a comment and bumps the count", async () => {
    const { status, json } = await api(`/api/posts/${postA}/comments`, {
      token: bob.idToken,
      body: { body: "Would use this daily.", name: "Bob" },
    });
    assert.equal(status, 201, JSON.stringify(json));
    const doc = await getDoc(`posts/${postA}`);
    assert.equal(doc.commentCount, 1);
  });

  await check("refuses an empty comment", async () => {
    const { status } = await api(`/api/posts/${postA}/comments`, {
      token: bob.idToken,
      body: { body: "   " },
    });
    assert.equal(status, 400);
  });

  await check("strips the Ryder badge from a non-admin comment", async () => {
    const { json } = await api(`/api/posts/${postA}/comments`, {
      token: bob.idToken,
      // Bob signs himself as the Ryder team and asks for the badge. The
      // route reads neither - isAdmin comes from the token or not at all.
      body: { body: "Ryder here, trust me.", name: "Ryder team", isAdmin: true },
    });
    const doc = await getDoc(`posts/${postA}/comments/${json.id}`);
    assert.equal(doc.isAdmin, false, "isAdmin must come from the token");
  });

  await check("blocks a non-admin from changing status", async () => {
    const { status } = await api(`/api/admin/posts/${postA}`, {
      token: bob.idToken,
      method: "PATCH",
      body: { status: "shipped" },
    });
    assert.equal(status, 403);
    const doc = await getDoc(`posts/${postA}`);
    assert.equal(doc.status, "open", "status must not have moved");
  });

  await check("blocks a non-admin from merging", async () => {
    const { status } = await api(`/api/admin/posts/${postA}`, {
      token: bob.idToken,
      body: { action: "merge", targetId: postA },
    });
    assert.equal(status, 403);
  });

  // --- The same admin routes, now exercised with the claim ---------------

  await check("lets an admin move a ticket onto the roadmap", async () => {
    const { status, json } = await api(`/api/admin/posts/${postA}`, {
      token: adminToken,
      method: "PATCH",
      body: { status: "planned", note: "Scoped for Q1.", eta: "Q1 2027" },
    });
    assert.equal(status, 200, JSON.stringify(json));
    const doc = await getDoc(`posts/${postA}`);
    assert.equal(doc.status, "planned");
    assert.equal(doc.eta, "Q1 2027");
  });

  await check("rejects a status that is not in the enum", async () => {
    const { status } = await api(`/api/admin/posts/${postA}`, {
      token: adminToken,
      method: "PATCH",
      body: { status: "definitely-shipping" },
    });
    assert.equal(status, 400);
  });

  await check("transfers votes on merge without double counting", async () => {
    // postB gets three voters: alice (author), bob, carol.
    const created = await api("/api/posts", {
      token: alice.idToken,
      body: {
        title: "Smoke test: duplicate of passkey unlock",
        boardId: "app",
        name: "Alice",
      },
    });
    postB = created.json.id;
    await publish(postB);
    await api(`/api/posts/${postB}/vote`, { token: bob.idToken });
    await api(`/api/posts/${postB}/vote`, { token: carol.idToken });

    const before = await getDoc(`posts/${postA}`);
    const dup = await getDoc(`posts/${postB}`);
    assert.equal(dup.voteCount, 3);

    // postA already has alice and bob. So of postB's three voters, only
    // carol is new: 2 + 1 = 3, not 2 + 3 = 5.
    const { status, json } = await api(`/api/admin/posts/${postB}`, {
      token: adminToken,
      body: { action: "merge", targetId: postA },
    });
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.votesTransferred, 1, "only carol was new");
    assert.equal(json.duplicatesSkipped, 2, "alice and bob were already there");

    const after = await getDoc(`posts/${postA}`);
    assert.equal(
      after.voteCount,
      before.voteCount + 1,
      `expected ${before.voteCount + 1}, got ${after.voteCount}`,
    );
    const merged = await getDoc(`posts/${postB}`);
    assert.equal(merged.mergedInto, postA);
  });

  await check("freezes voting on a merged post", async () => {
    const { status } = await api(`/api/posts/${postB}/vote`, { token: carol.idToken });
    assert.equal(status, 400);
  });

  await check("takes a merged duplicate off the public board", async () => {
    // isPublic is the only field public queries filter on, so merging has to
    // clear it — otherwise the duplicate keeps showing up beside the ticket
    // it was folded into.
    const doc = await getDoc(`posts/${postB}`);
    assert.equal(doc.isPublic, false, "a merged post must not stay public");
    assert.equal(doc.moderation, "approved", "merging is not a rejection");
  });

  await check("unpublishing puts an idea back in the queue", async () => {
    const board = await getDoc("boards/app");
    const countBefore = board?.postCount ?? 0;

    const off = await api(`/api/admin/posts/${postA}`, {
      token: adminToken,
      method: "PATCH",
      body: { moderation: "pending" },
    });
    assert.equal(off.status, 200, JSON.stringify(off.json));

    const doc = await getDoc(`posts/${postA}`);
    assert.equal(doc.isPublic, false);
    assert.equal(doc.reviewedAt, null, "back in the queue means undecided");

    const after = await getDoc("boards/app");
    assert.equal(after.postCount, countBefore - 1, "the count comes back down");

    // Votes and comments survive, so republishing restores the ticket whole.
    assert.ok(doc.voteCount > 1, "votes must not be discarded");

    await publish(postA, "planned");
    const restored = await getDoc(`posts/${postA}`);
    assert.equal(restored.isPublic, true);
    assert.equal(restored.status, "planned");
  });

  await check("rate limits a burst of new posts", async () => {
    const dave = await signInAnonymously();
    const codes = [];
    for (let i = 0; i < 5; i++) {
      const { status } = await api("/api/posts", {
        token: dave.idToken,
        body: { title: `Rate limit probe number ${i}`, boardId: "app" },
      });
      codes.push(status);
    }
    // Three allowed per ten minutes, so the fourth and fifth must be 429.
    assert.deepEqual(codes.slice(0, 3), [201, 201, 201], `got ${codes}`);
    assert.ok(
      codes.slice(3).every((c) => c === 429),
      `expected 429s after the limit, got ${codes}`,
    );
  });

  /**
   * The rule the portal now rests on, checked at the route rather than in
   * the UI: a real Google account, signed in properly, that simply is not on
   * the company domain. It gets a 403 like anyone else.
   */
  await check("refuses an admin route to a Google account off the domain", async () => {
    const outsider = await signInWithGoogle("someone@gmail.com");
    const { status } = await api(`/api/admin/posts/${postA}`, {
      token: outsider.idToken,
      method: "PATCH",
      body: { status: "planned" },
    });
    assert.equal(status, 403);
  });

  await check("/api/me reports admin access from the domain, and not from anywhere else", async () => {
    const mine = await api("/api/me", { token: adminToken, method: "GET" });
    assert.equal(mine.json.isAdmin, true);
    const theirs = await api("/api/me", { token: bob.idToken, method: "GET" });
    assert.equal(theirs.json.isAdmin, false);
    assert.equal(theirs.json.isAnonymous, true);
  });

  console.log(
    `\n${passed} passed, ${failures.length} failed${failures.length ? ":" : ""}`,
  );
  for (const f of failures) console.log(`  - ${f.name}: ${f.err.message}`);
  console.log();
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error("\nSmoke test crashed:", err);
  process.exit(1);
});
