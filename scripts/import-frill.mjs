#!/usr/bin/env node
/**
 * Imports the real board from Frill (feedback.ryder.id) into Firestore.
 *
 *   node scripts/import-frill.mjs                  # dry run: prints the plan
 *   node scripts/import-frill.mjs --write          # import, keeping what is there
 *   node scripts/import-frill.mjs --write --reset  # wipe every post first
 *
 * Reads scripts/frill-export.json, which was pulled from the public board.
 * Keeping the export as a checked-in file rather than scraping on each run is
 * deliberate: the import is then reproducible, reviewable in a diff, and does
 * not depend on Frill still being up or still rendering the same markup.
 *
 * What comes across: title, body, author name, status, vote count, comments
 * and the original submission date. What does not:
 *
 *  - Individual voters. Frill's public board exposes totals, not who voted,
 *    so votes arrive as a count with no receipts behind them. The number is
 *    real; the one-vote-per-person rule simply has nothing to enforce against
 *    for historical votes, and starts working from the first vote cast here.
 *  - Comment threading. Frill's replies are flattened to top-level comments,
 *    because the public feed does not expose the parent relationship.
 *
 * Everything imported is published (moderation: approved), since it was
 * already public on Frill. Nothing lands in the review queue.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { cert, initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

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

const write = process.argv.includes("--write");
const reset = process.argv.includes("--reset");

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.split(
  String.fromCharCode(92) + "n",
).join("\n");

if (!projectId || !clientEmail || !privateKey) {
  console.error("\nMissing service account credentials in .env.local.\n");
  process.exit(1);
}

initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

const BOARDS = [
  { id: "app", name: "Ryder App", slug: "app", description: "The mobile companion app.", order: 1 },
  { id: "device", name: "Hardware", slug: "device", description: "Ryder One, Recovery Tags and TapSafe.", order: 2 },
  { id: "assets", name: "Assets & networks", slug: "assets", description: "Chains, tokens and network support.", order: 3 },
  { id: "other", name: "Everything else", slug: "other", description: "Docs, support, integrations, anything that does not fit above.", order: 4 },
];

const ideas = JSON.parse(readFileSync("scripts/frill-export.json", "utf8"));

/** A stable id per Frill idea, so re-running does not duplicate anything. */
const postId = (slug) => `frill_${slug}`.slice(0, 1500);

function ts(iso) {
  return Timestamp.fromDate(new Date(iso));
}

async function deleteEverything() {
  const posts = await db.collection("posts").get();
  console.log(`  deleting ${posts.size} posts (and their comments, votes, events)`);
  for (const doc of posts.docs) await db.recursiveDelete(doc.ref);
  const users = await db.collection("users").get();
  console.log(`  deleting ${users.size} user records`);
  for (const doc of users.docs) await db.recursiveDelete(doc.ref);
}

async function main() {
  const totalComments = ideas.reduce((n, i) => n + i.comments.length, 0);
  const totalVotes = ideas.reduce((n, i) => n + i.votes, 0);

  console.log(`\n${write ? "Importing into" : "Dry run against"} ${projectId}\n`);
  console.log(`  ${ideas.length} ideas`);
  console.log(`  ${totalComments} comments`);
  console.log(`  ${totalVotes} votes carried over as counts`);

  const byBoard = {};
  const byStatus = {};
  for (const i of ideas) {
    byBoard[i.boardId] = (byBoard[i.boardId] ?? 0) + 1;
    byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
  }
  console.log("\n  by board: ", JSON.stringify(byBoard));
  console.log("  by status:", JSON.stringify(byStatus));

  if (!write) {
    console.log(
      `\n  Dry run only.${reset ? " --reset would delete every existing post." : ""}` +
        "\n  Re-run with --write to apply.\n",
    );
    return;
  }

  if (reset) {
    console.log("\n--reset given:");
    await deleteEverything();
  }

  const boards = db.batch();
  for (const b of BOARDS) {
    const { id, ...rest } = b;
    boards.set(db.collection("boards").doc(id), rest, { merge: true });
  }
  await boards.commit();
  console.log(`\n  ${BOARDS.length} boards ready`);

  let written = 0;
  for (const idea of ideas) {
    const ref = db.collection("posts").doc(postId(idea.slug));
    const createdAt = ts(idea.createdAt);
    const batch = db.batch();

    batch.set(ref, {
      title: idea.title,
      body: idea.body,
      boardId: idea.boardId,
      status: idea.status,
      authorId: `frill_${idea.slug}`,
      authorName: idea.authorName,
      voteCount: idea.votes,
      commentCount: idea.comments.length,
      pinned: false,
      // Already public on Frill, so it is public here. Nothing from this
      // import belongs in the review queue.
      moderation: "approved",
      isPublic: true,
      reviewedAt: createdAt,
      reviewerName: "Imported from Frill",
      reviewNote: null,
      mergedInto: null,
      roadmapNote: null,
      eta: null,
      tags: [],
      createdAt,
      updatedAt: createdAt,
    });

    batch.set(ref.collection("events").doc(), {
      type: "created",
      from: null,
      to: "open",
      actorName: idea.authorName,
      note: null,
      createdAt,
    });

    // Only the statuses that are not the default get a timeline entry, so a
    // plain open ticket does not show a pointless "moved to open".
    if (idea.status !== "open") {
      batch.set(ref.collection("events").doc(), {
        type: "status",
        from: "open",
        to: idea.status,
        actorName: "Ryder team",
        note: null,
        createdAt,
      });
    }

    for (const c of idea.comments) {
      batch.set(ref.collection("comments").doc(), {
        body: c.body,
        authorId: `frill_c_${idea.slug}_${c.createdAt}`,
        authorName: c.authorName,
        isAdmin: false,
        parentId: null,
        createdAt: ts(c.createdAt),
      });
    }

    await batch.commit();
    written++;
    process.stdout.write(`\r  ${written}/${ideas.length} ideas written`);
  }

  console.log(`\n\nDone. ${written} ideas, ${totalComments} comments.\n`);
}

main().catch((err) => {
  console.error("\nFailed:", err.message ?? err);
  process.exit(1);
});
