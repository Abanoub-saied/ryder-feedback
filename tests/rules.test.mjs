/**
 * Security rules tests, run against the Firestore emulator.
 *
 *   npm run test:rules
 *
 * Every claim the README and firestore.rules make about what a browser
 * cannot do is asserted here, because "the UI has no button for that" is not
 * a security property.
 *
 * The test that earned its keep is "the batched-vote trick does not work" —
 * it is the reason voting is a server route instead of a clever rule.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";

const {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} = await import("firebase/firestore");

let env;

const POST = "post_1";
const OTHER = "post_2";
/** Submitted by alice, not yet approved by an admin. */
const PENDING = "post_3";

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "ryder-feedback-rules-test",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

after(async () => {
  await env?.cleanup();
});

/** Fresh data, written with rules bypassed — this is what the server does. */
async function reset() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "boards/app"), {
      name: "App",
      slug: "app",
      description: "",
      order: 1,
      postCount: 1,
    });
    for (const id of [POST, OTHER]) {
      await setDoc(doc(db, "posts", id), {
        title: `Post ${id}`,
        body: "",
        boardId: "app",
        status: "open",
        moderation: "approved",
        isPublic: true,
        reviewedAt: new Date(),
        reviewerName: "Boss",
        reviewNote: null,
        authorId: "someone-else",
        authorName: "Someone",
        voteCount: 10,
        commentCount: 0,
        pinned: false,
        mergedInto: null,
        roadmapNote: null,
        eta: null,
        tags: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    // Alice's submission, still in the review queue.
    await setDoc(doc(db, "posts", PENDING), {
      title: "Not approved yet",
      body: "",
      boardId: "app",
      status: "open",
      moderation: "pending",
      isPublic: false,
      reviewedAt: null,
      reviewerName: null,
      reviewNote: null,
      authorId: "alice",
      authorName: "Alice",
      voteCount: 1,
      commentCount: 0,
      pinned: false,
      mergedInto: null,
      roadmapNote: null,
      eta: null,
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await setDoc(doc(db, "posts", POST, "comments", "c_alice"), {
      body: "Mine",
      authorId: "alice",
      authorName: "Alice",
      isAdmin: false,
      parentId: null,
      createdAt: new Date(),
    });
    // A receipt written the way the vote route writes it.
    await setDoc(doc(db, "posts", POST, "votes", "bob"), {
      createdAt: new Date(),
    });
    await setDoc(doc(db, "users/bob/myVotes", POST), { createdAt: new Date() });
    await setDoc(doc(db, "users/bob"), {
      uid: "bob",
      displayName: "Bob",
      email: "bob@example.com",
    });
    await setDoc(doc(db, "rateLimits/alice_post"), { hits: [1, 2, 3] });
  });
}

/** Signed-in visitor, mirroring an anonymous Firebase Auth session. */
const visitor = (uid = "alice") => env.authenticatedContext(uid).firestore();
/**
 * A Google sign-in. This is the only way anyone is an admin: the verified
 * address on the company domain *is* the credential. There is no claim to
 * grant, which is why there is no helper for granting one.
 */
const google = (email, { verified = true, uid = "staff" } = {}) =>
  env
    .authenticatedContext(uid, {
      email,
      email_verified: verified,
      firebase: { sign_in_provider: "google.com" },
    })
    .firestore();

/** An admin, spelled the only way an admin can be spelled. */
const adminCtx = (uid = "boss") => google("boss@ryder.id", { uid });
const anon = () => env.unauthenticatedContext().firestore();

/** Reads a field with rules bypassed, to check what actually landed. */
async function readField(path, field) {
  let value;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(doc(ctx.firestore(), path));
    value = snap.exists() ? snap.data()[field] : undefined;
  });
  return value;
}

/** The published board, the query the client actually sends. */
const publicBoard = (db) =>
  query(collection(db, "posts"), where("isPublic", "==", true));

describe("public reads", () => {
  before(reset);

  it("serves the published board to a visitor who never signed in", async () => {
    await assertSucceeds(getDoc(doc(anon(), "posts", POST)));
    await assertSucceeds(getDocs(publicBoard(anon())));
    await assertSucceeds(getDocs(collection(anon(), "boards")));
  });

  it("serves comments and the status timeline publicly", async () => {
    await assertSucceeds(getDocs(collection(anon(), "posts", POST, "comments")));
    await assertSucceeds(getDocs(collection(anon(), "posts", POST, "events")));
  });
});

describe("who counts as an admin", () => {
  before(reset);

  // The queue is the thing worth stealing, so it is the probe used
  // throughout: if a token can list pending posts, it is an admin here.
  const readsTheQueue = (db) =>
    getDocs(query(collection(db, "posts"), where("moderation", "==", "pending")));

  it("admits a verified Google account on the domain", async () => {
    await assertSucceeds(readsTheQueue(google("someone@ryder.id")));
  });

  it("is case-insensitive about the address", async () => {
    await assertSucceeds(readsTheQueue(google("Someone@Ryder.ID")));
  });

  it("refuses an account on any other domain", async () => {
    await assertFails(readsTheQueue(google("someone@gmail.com")));
    await assertFails(readsTheQueue(google("someone@notryder.id")));
  });

  // The two that a substring check would wave through.
  it("refuses a lookalike domain", async () => {
    await assertFails(readsTheQueue(google("someone@ryder.id.example.com")));
    await assertFails(readsTheQueue(google("ryder.id@example.com")));
  });

  it("refuses an unverified address", async () => {
    await assertFails(
      readsTheQueue(google("someone@ryder.id", { verified: false })),
    );
  });

  /**
   * The reason the provider is checked at all. If this passed, then the day
   * someone enables email/password sign-up in the Firebase console, anyone
   * could register as whoever@ryder.id and read the queue. Google Workspace
   * is what makes the address mean anything, so only Google mints admins.
   */
  it("refuses a domain address that Google did not vouch for", async () => {
    const forged = env
      .authenticatedContext("mallory", {
        email: "ceo@ryder.id",
        email_verified: true,
        firebase: { sign_in_provider: "password" },
      })
      .firestore();
    await assertFails(readsTheQueue(forged));
  });

  it("refuses an ordinary anonymous visitor", async () => {
    await assertFails(readsTheQueue(visitor("mallory")));
    await assertFails(readsTheQueue(anon()));
  });

  /**
   * There is no break-glass path, and this is the test that keeps it that
   * way. A custom claim outlives the account it was given to and answers to
   * nobody's offboarding, which is the whole reason access is derived from
   * the domain instead of granted.
   */
  it("refuses an admin custom claim on its own", async () => {
    const claimed = env
      .authenticatedContext("mallory", { admin: true })
      .firestore();
    await assertFails(readsTheQueue(claimed));
  });
});

describe("admin approval gate", () => {
  before(reset);

  // The whole point of the feature: an idea is not public until an admin
  // says so, and that is a database fact rather than a client-side filter.
  it("hides a pending idea from everyone but its author and an admin", async () => {
    await assertFails(getDoc(doc(anon(), "posts", PENDING)));
    await assertFails(getDoc(doc(visitor("mallory"), "posts", PENDING)));
    await assertSucceeds(getDoc(doc(visitor("alice"), "posts", PENDING)));
    await assertSucceeds(getDoc(doc(adminCtx(), "posts", PENDING)));
  });

  // Without this, dropping the isPublic filter would be a way to read the
  // entire review queue. Rules check the query, not the rows it returns, so
  // an unfiltered list has to be refused outright.
  it("refuses a list query that does not filter on isPublic", async () => {
    await assertFails(getDocs(collection(anon(), "posts")));
    await assertFails(getDocs(collection(visitor("mallory"), "posts")));
    await assertFails(
      getDocs(query(collection(anon(), "posts"), where("isPublic", "==", false))),
    );
  });

  it("lets an admin list everything, including the queue", async () => {
    await assertSucceeds(getDocs(collection(adminCtx(), "posts")));
    await assertSucceeds(
      getDocs(
        query(collection(adminCtx(), "posts"), where("moderation", "==", "pending")),
      ),
    );
  });

  it("lets you list your own submissions, and only your own", async () => {
    await assertSucceeds(
      getDocs(
        query(collection(visitor("alice"), "posts"), where("authorId", "==", "alice")),
      ),
    );
    await assertFails(
      getDocs(
        query(
          collection(visitor("mallory"), "posts"),
          where("authorId", "==", "alice"),
        ),
      ),
    );
  });

  it("still refuses to let anyone set their own moderation state", async () => {
    await assertFails(
      updateDoc(doc(visitor("alice"), "posts", PENDING), {
        moderation: "approved",
        isPublic: true,
      }),
    );
    // Not even an admin: approval goes through the route handler, which is
    // where the event, the board counter and isPublic are kept consistent.
    await assertFails(
      updateDoc(doc(adminCtx(), "posts", PENDING), { isPublic: true }),
    );
    assert.equal(await readField(`posts/${PENDING}`, "isPublic"), false);
  });
});

describe("my activity", () => {
  before(reset);

  it("lets you collection-group your own comments", async () => {
    await assertSucceeds(
      getDocs(
        query(
          collectionGroup(visitor("alice"), "comments"),
          where("authorId", "==", "alice"),
        ),
      ),
    );
  });

  it("refuses a collection-group sweep of everyone's comments", async () => {
    await assertFails(getDocs(collectionGroup(visitor("alice"), "comments")));
    await assertFails(
      getDocs(
        query(
          collectionGroup(visitor("mallory"), "comments"),
          where("authorId", "==", "alice"),
        ),
      ),
    );
  });
});

describe("privacy", () => {
  before(reset);

  it("does not let anyone enumerate who voted for what", async () => {
    await assertFails(getDocs(collection(visitor(), "posts", POST, "votes")));
    await assertFails(getDocs(collection(anon(), "posts", POST, "votes")));
  });

  it("lets you check your own receipt but not someone else's", async () => {
    await assertSucceeds(getDoc(doc(visitor("bob"), "posts", POST, "votes", "bob")));
    await assertFails(getDoc(doc(visitor("alice"), "posts", POST, "votes", "bob")));
  });

  it("keeps a submitter's email away from other users", async () => {
    await assertFails(getDoc(doc(visitor("alice"), "users/bob")));
    await assertFails(getDoc(doc(anon(), "users/bob")));
    await assertSucceeds(getDoc(doc(visitor("bob"), "users/bob")));
  });

  it("lets an admin read a user profile", async () => {
    await assertSucceeds(getDoc(doc(adminCtx(), "users/bob")));
  });

  it("keeps one visitor's vote index private to them", async () => {
    await assertSucceeds(getDocs(collection(visitor("bob"), "users/bob/myVotes")));
    await assertFails(getDocs(collection(visitor("alice"), "users/bob/myVotes")));
  });

  it("hides the rate limit ledger from everyone", async () => {
    await assertFails(getDoc(doc(visitor("alice"), "rateLimits/alice_post")));
    await assertFails(getDoc(doc(adminCtx(), "rateLimits/alice_post")));
  });
});

describe("vote integrity", () => {
  before(reset);

  it("does not let a client touch the vote counter", async () => {
    await assertFails(
      updateDoc(doc(visitor("alice"), "posts", POST), { voteCount: increment(1) }),
    );
    await assertFails(
      updateDoc(doc(visitor("alice"), "posts", POST), { voteCount: 99999 }),
    );
    assert.equal(await readField(`posts/${POST}`, "voteCount"), 10);
  });

  /**
   * The attack that decided the architecture.
   *
   * Rules evaluate each write in a batch against pre-batch state, so a rule
   * of the form "allow +1 when no receipt exists yet" is satisfied by an
   * increment sent with no receipt at all — over and over. Since the counter
   * is not client-writable, the whole family of tricks dies here.
   */
  it("blocks the batched-vote trick, receipt or no receipt", async () => {
    const db = visitor("alice");

    const withReceipt = writeBatch(db);
    withReceipt.set(doc(db, "posts", POST, "votes", "alice"), {
      createdAt: serverTimestamp(),
    });
    withReceipt.update(doc(db, "posts", POST), { voteCount: increment(1) });
    await assertFails(withReceipt.commit());

    const bareIncrement = writeBatch(db);
    bareIncrement.update(doc(db, "posts", POST), { voteCount: increment(1) });
    await assertFails(bareIncrement.commit());

    assert.equal(await readField(`posts/${POST}`, "voteCount"), 10);
  });

  it("does not let a client write its own vote receipt", async () => {
    const db = visitor("alice");
    await assertFails(
      setDoc(doc(db, "posts", POST, "votes", "alice"), {
        createdAt: serverTimestamp(),
      }),
    );
  });

  it("does not let anyone delete someone else's vote", async () => {
    await assertFails(
      deleteDoc(doc(visitor("alice"), "posts", POST, "votes", "bob")),
    );
    // Not even their own: withdrawing a vote goes through the route too, so
    // the counter can never fall out of step with the receipts.
    await assertFails(deleteDoc(doc(visitor("bob"), "posts", POST, "votes", "bob")));
  });

  it("does not let a forged vote index create a vote", async () => {
    await assertFails(
      setDoc(doc(visitor("alice"), "users/alice/myVotes", POST), {
        createdAt: serverTimestamp(),
      }),
    );
    assert.equal(await readField(`posts/${POST}`, "voteCount"), 10);
  });
});

describe("content integrity", () => {
  before(reset);

  it("blocks creating a post from the browser", async () => {
    await assertFails(
      setDoc(doc(visitor(), "posts/forged"), {
        title: "Straight into the database",
        boardId: "app",
        status: "planned",
        voteCount: 9999,
      }),
    );
  });

  it("blocks rewriting someone else's post", async () => {
    await assertFails(updateDoc(doc(visitor(), "posts", POST), { title: "Mine now" }));
  });

  it("blocks putting an item on the public roadmap", async () => {
    await assertFails(updateDoc(doc(visitor(), "posts", POST), { status: "shipped" }));
    await assertFails(
      updateDoc(doc(visitor(), "posts", POST), { roadmapNote: "Coming soon!" }),
    );
    assert.equal(await readField(`posts/${POST}`, "status"), "open");
  });

  it("blocks pinning your own post to the top", async () => {
    await assertFails(updateDoc(doc(visitor(), "posts", POST), { pinned: true }));
  });

  it("blocks merging one post into another", async () => {
    await assertFails(
      updateDoc(doc(visitor(), "posts", POST), { mergedInto: OTHER }),
    );
  });

  it("blocks deleting a post", async () => {
    await assertFails(deleteDoc(doc(visitor(), "posts", POST)));
  });

  it("blocks forging a comment with a Ryder badge", async () => {
    await assertFails(
      setDoc(doc(visitor(), "posts", POST, "comments", "c1"), {
        body: "Ryder response, definitely",
        authorId: "alice",
        authorName: "Ryder team",
        isAdmin: true,
        parentId: null,
        createdAt: serverTimestamp(),
      }),
    );
  });

  it("blocks forging a status event", async () => {
    await assertFails(
      setDoc(doc(visitor(), "posts", POST, "events", "e1"), {
        type: "status",
        to: "shipped",
        actorName: "Ryder team",
        createdAt: serverTimestamp(),
      }),
    );
  });

  it("blocks editing a board", async () => {
    await assertFails(updateDoc(doc(visitor(), "boards/app"), { name: "Mine" }));
  });

  it("blocks writing a user profile, including your own", async () => {
    await assertFails(
      setDoc(doc(visitor("alice"), "users/alice"), { email: "alice@example.com" }),
    );
  });

  /**
   * An admin's browser is still a browser. Privilege lives in the route
   * handlers, which verify the claim server-side and use the Admin SDK. If
   * an admin session token leaks, it grants nothing at the database layer.
   */
  it("gives an admin's client no write access either", async () => {
    await assertFails(updateDoc(doc(adminCtx(), "posts", POST), { status: "shipped" }));
    await assertFails(updateDoc(doc(adminCtx(), "boards/app"), { name: "Mine" }));
    await assertFails(
      setDoc(doc(adminCtx(), "posts", POST, "comments", "c2"), {
        body: "hi",
        isAdmin: true,
      }),
    );
  });
});
