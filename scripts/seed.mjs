#!/usr/bin/env node
/**
 * Seeds the boards and a set of realistic Ryder tickets spread across every
 * status, so the board and the roadmap both have something to show the
 * moment you open them.
 *
 *   npm run seed              # add anything missing, leave existing data
 *   npm run seed -- --reset   # delete every post first, then reseed
 *
 * Reads FIREBASE_* out of .env.local.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { cert, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");

// --- tiny .env.local reader (no dependency needed) -------------------------
function loadEnv(path = ".env.local") {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = value;
  }
}

loadEnv();

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

if (!projectId || !clientEmail || !privateKey) {
  console.error(
    "\nMissing service account credentials.\n" +
      "Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY\n" +
      "in .env.local first. See SETUP.md step 4.\n",
  );
  process.exit(1);
}

initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore();

const BOARDS = [
  {
    id: "app",
    name: "Ryder App",
    slug: "app",
    description: "The mobile companion app.",
    order: 1,
  },
  {
    id: "device",
    name: "Hardware",
    slug: "device",
    description: "Ryder One, Recovery Tags and TapSafe.",
    order: 2,
  },
  {
    id: "assets",
    name: "Assets & networks",
    slug: "assets",
    description: "Chains, tokens and network support.",
    order: 3,
  },
  {
    id: "other",
    name: "Everything else",
    slug: "other",
    description: "Docs, support, integrations, anything that does not fit above.",
    order: 4,
  },
];

const DAY = 86_400_000;

/** [title, body, boardId, status, votes, daysAgo, eta, roadmapNote] */
const POSTS = [
  [
    "XRP support in the app",
    "I hold XRP alongside BTC and would rather not keep a second wallet app open just for it. Send, receive and balance would cover it.",
    "assets",
    "in-progress",
    212,
    46,
    "Q4 2026",
    "Signing and address derivation are done. Working through the app UI now.",
  ],
  [
    "Face ID / biometric unlock",
    "Typing the PIN every time I open the app to check a balance is a lot of friction for a read-only action.",
    "app",
    "planned",
    174,
    38,
    "Q4 2026",
    "Read-only views unlock with biometrics; anything that signs still asks for the PIN.",
  ],
  [
    "NFC tap-to-sign without a cable",
    "Half the reason I bought the device was tapping it. Would love the same for confirming a transaction.",
    "device",
    "in-progress",
    158,
    52,
    null,
    null,
  ],
  [
    "Portfolio value in my local currency",
    "Everything is shown in USD. I am in Egypt and convert in my head every time.",
    "app",
    "planned",
    131,
    29,
    "Q1 2027",
    null,
  ],
  [
    "Address book for frequent recipients",
    "I send to the same three addresses constantly and paste from notes every time, which is exactly the habit that gets people phished.",
    "app",
    "under-review",
    96,
    21,
    null,
    null,
  ],
  [
    "Multiple accounts on one device",
    "I would like a separate account for savings and for spending without carrying two devices.",
    "device",
    "under-review",
    88,
    33,
    null,
    null,
  ],
  [
    "Export transaction history as CSV",
    "For tax season. Right now I am screenshotting the app, which does not scale.",
    "app",
    "planned",
    74,
    25,
    "Q1 2027",
    null,
  ],
  [
    "Recovery Tag verification in-app",
    "A way to scan a Recovery Tag and confirm it matches the wallet, without doing a full restore to find out.",
    "device",
    "open",
    61,
    12,
    null,
    null,
  ],
  [
    "Dark mode",
    "The app is very bright at night.",
    "app",
    "shipped",
    143,
    120,
    null,
    "Shipped in app 2.1. Follows your system setting by default.",
  ],
  [
    "Firmware updates over USB-C",
    "Updating over the desktop tool works but it is a lot of steps.",
    "device",
    "shipped",
    97,
    95,
    null,
    "Shipped in firmware 2.2 — the app walks you through it now.",
  ],
  [
    "Stacks (STX) support",
    "Native STX would be a big deal for the Stacks community specifically.",
    "assets",
    "shipped",
    189,
    140,
    null,
    "Live since app 2.0.",
  ],
  [
    "Browser extension",
    "So I can connect the device to web apps without the mobile step in between.",
    "other",
    "open",
    54,
    9,
    null,
    null,
  ],
  [
    "Arabic language support",
    "Right-to-left layout and Arabic strings. Would help a lot of us in the region.",
    "app",
    "open",
    47,
    7,
    null,
    null,
  ],
  [
    "Push notification when a transaction confirms",
    "I currently sit and refresh.",
    "app",
    "open",
    39,
    5,
    null,
    null,
  ],
  [
    "Bulk-print Recovery Tags for a team",
    "We manage devices for a small fund and set up several at once.",
    "device",
    "declined",
    12,
    60,
    null,
    "Not something we plan to build — the per-device pairing is deliberate. Happy to talk about a bulk order though.",
  ],
  [
    "Built-in swap / exchange",
    "Swap between assets without leaving the app.",
    "assets",
    "declined",
    31,
    70,
    null,
    "We would rather not be a custodian or route your funds through a third party. Not planned.",
  ],
  [
    "Bigger font option",
    "The addresses are hard to read.",
    "app",
    "open",
    28,
    3,
    null,
    null,
  ],
  [
    "Solana support",
    "Would consolidate two more apps for me.",
    "assets",
    "under-review",
    83,
    17,
    null,
    null,
  ],
];

const NAMES = [
  "Mina F.", "Owen S.", "Nish S.", "Friedger", "Louise", "Alex",
  "Rena", "Anonymous", "K. Patel", "J. Okonkwo", "S. Haddad", "T. Lindqvist",
];

/** Deterministic pseudo-random so reseeding produces the same-looking board. */
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

async function deleteAllPosts() {
  const snap = await db.collection("posts").get();
  console.log(`  removing ${snap.size} existing posts…`);
  for (const doc of snap.docs) {
    // recursiveDelete takes the subcollections (votes, comments, events) too.
    await db.recursiveDelete(doc.ref);
  }
  const users = await db.collection("users").get();
  for (const doc of users.docs) await db.recursiveDelete(doc.ref);
}

async function main() {
  const reset = process.argv.includes("--reset");

  console.log(`\nSeeding ${projectId}…\n`);

  if (reset) {
    console.log("--reset given:");
    await deleteAllPosts();
  }

  console.log("  boards…");
  const batch = db.batch();
  for (const board of BOARDS) {
    batch.set(
      db.doc(`boards/${board.id}`),
      { ...board, postCount: 0 },
      { merge: true },
    );
  }
  await batch.commit();

  const existing = await db.collection("posts").get();
  const seen = new Set(existing.docs.map((d) => d.data().title));

  const random = rng(20260908);
  const counts = new Map();
  let created = 0;

  for (const [title, body, boardId, status, votes, daysAgo, eta, note] of POSTS) {
    if (seen.has(title)) continue;

    const createdAt = new Date(Date.now() - daysAgo * DAY);
    const updatedAt = new Date(
      createdAt.getTime() + Math.floor(random() * daysAgo * DAY * 0.6),
    );
    const postRef = db.collection("posts").doc();
    const authorName = NAMES[Math.floor(random() * NAMES.length)];

    const writer = db.batch();

    writer.set(postRef, {
      title,
      body,
      boardId,
      status,
      authorId: `seed_${postRef.id}`,
      authorName,
      voteCount: votes,
      commentCount: 0,
      pinned: false,
      // Seeded ideas are already published — the point of the seed is a board
      // with something on it. The review queue is exercised by the two
      // pending submissions added at the end of this run.
      moderation: "approved",
      isPublic: true,
      reviewedAt: updatedAt,
      reviewerName: "Ryder team",
      reviewNote: null,
      mergedInto: null,
      roadmapNote: note,
      eta,
      tags: [],
      createdAt,
      updatedAt,
    });

    writer.set(postRef.collection("events").doc(), {
      type: "created",
      from: null,
      to: "open",
      actorName: authorName,
      message: null,
      createdAt,
    });

    writer.set(postRef.collection("events").doc(), {
      type: "approved",
      from: null,
      to: status,
      actorName: "Ryder team",
      message: null,
      createdAt: updatedAt,
    });

    if (status !== "open") {
      writer.set(postRef.collection("events").doc(), {
        type: "status",
        from: "open",
        to: status,
        actorName: "Ryder team",
        message: note,
        createdAt: updatedAt,
      });
    }

    // A couple of comments on the busier tickets so threading is visible.
    if (votes > 80) {
      const c1 = postRef.collection("comments").doc();
      writer.set(c1, {
        body: "Adding a +1 with a use case: this is the one thing keeping me on a second app.",
        authorId: `seed_c_${c1.id}`,
        authorName: NAMES[Math.floor(random() * NAMES.length)],
        isAdmin: false,
        parentId: null,
        createdAt: new Date(createdAt.getTime() + DAY),
      });
      const c2 = postRef.collection("comments").doc();
      writer.set(c2, {
        body:
          note ??
          "Thanks — this is on our list. We will update this ticket when it moves.",
        authorId: "seed_admin",
        authorName: "Ryder team",
        isAdmin: true,
        parentId: c1.id,
        createdAt: new Date(createdAt.getTime() + DAY * 2),
      });
      writer.update(postRef, { commentCount: 2 });
    }

    await writer.commit();
    counts.set(boardId, (counts.get(boardId) ?? 0) + 1);
    created++;
    process.stdout.write(".");
  }

  process.stdout.write("\n");

  // Two unreviewed submissions, so /admin opens on a queue with something in
  // it rather than on an empty state that gives no sense of the workflow.
  const PENDING = [
    [
      "Widget for the lock screen",
      "Balance and the last transaction without unlocking. I check it ten times a day.",
      "app",
    ],
    [
      "CSV export for the whole transaction history",
      "My accountant wants the full year in one file. Right now it is month by month.",
      "other",
    ],
  ];

  let pendingCreated = 0;
  for (const [title, body, boardId] of PENDING) {
    if (seen.has(title)) continue;

    const postRef = db.collection("posts").doc();
    const createdAt = new Date(Date.now() - Math.floor(random() * 3 * DAY));
    const authorName = NAMES[Math.floor(random() * NAMES.length)];

    const writer = db.batch();
    writer.set(postRef, {
      title,
      body,
      boardId,
      status: "open",
      moderation: "pending",
      isPublic: false,
      reviewedAt: null,
      reviewerName: null,
      reviewNote: null,
      authorId: `seed_${postRef.id}`,
      authorName,
      voteCount: 1,
      commentCount: 0,
      pinned: false,
      mergedInto: null,
      roadmapNote: null,
      eta: null,
      tags: [],
      createdAt,
      updatedAt: createdAt,
    });
    writer.set(postRef.collection("events").doc(), {
      type: "created",
      from: null,
      to: "open",
      actorName: authorName,
      message: null,
      createdAt,
    });
    // The author's own vote receipt, matching what the real submit path
    // writes — so voteCount is backed by a receipt rather than being a bare
    // number that merging or the analytics rollup would contradict.
    writer.set(postRef.collection("votes").doc(`seed_${postRef.id}`), {
      createdAt,
    });

    await writer.commit();
    pendingCreated++;
    process.stdout.write("+");
  }
  if (pendingCreated) process.stdout.write("\n");

  // boards.postCount is the count of *published* ideas, so the pending pair
  // above is deliberately not tallied here. Approving one increments it.
  const tally = db.batch();
  for (const [boardId, n] of counts) {
    tally.update(db.doc(`boards/${boardId}`), {
      postCount: FieldValue.increment(n),
    });
  }
  if (counts.size) await tally.commit();

  console.log(
    `\nDone. ${BOARDS.length} boards, ${created} published posts` +
      (pendingCreated ? `, ${pendingCreated} awaiting review` : "") +
      (created === 0 && pendingCreated === 0
        ? " (everything was already there)"
        : "") +
      ".\n",
  );
  console.log("Next: npm run dev, then open http://localhost:3000");
  console.log(
    "Then grant yourself admin (npm run admin:grant -- you@ryder.id) and work\n" +
      "the review queue at /admin — nothing new reaches the public board until\n" +
      "someone approves it.\n",
  );
}

main().catch((err) => {
  console.error("\nSeed failed:", err.message ?? err);
  process.exit(1);
});
