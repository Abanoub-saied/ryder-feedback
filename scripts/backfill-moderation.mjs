#!/usr/bin/env node
/**
 * One-off migration for boards that existed before admin approval did.
 *
 *   node scripts/backfill-moderation.mjs            # dry run, shows the plan
 *   node scripts/backfill-moderation.mjs --write    # actually write
 *   node scripts/backfill-moderation.mjs --write --pending   # gate everything
 *
 * Every post gains two fields:
 *
 *   moderation  "approved" | "pending" | "rejected"
 *   isPublic    moderation === "approved" && mergedInto == null
 *
 * The default treats existing posts as **approved**, because they are already
 * on a live public board and people have already voted on them. Flipping a
 * running board to "everything is pending" would delete it from view until
 * someone clicked through hundreds of items, and would silently reset
 * boards.postCount. Pass --pending only if you genuinely want to re-review
 * historical submissions.
 *
 * Safe to run more than once: posts that already carry a moderation field are
 * left alone, so this will not overwrite a decision an admin has since made.
 * Run it before deploying the new security rules — under the new rules a post
 * with no isPublic field is not listable by the public.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { cert, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");

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

const write = process.argv.includes("--write");
const asPending = process.argv.includes("--pending");
const target = asPending ? "pending" : "approved";

initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore();

async function main() {
  console.log(
    `\n${write ? "Backfilling" : "Dry run against"} ${projectId} — existing posts become "${target}".\n`,
  );

  const snap = await db.collection("posts").get();
  if (snap.empty) {
    console.log("No posts. Nothing to do.\n");
    return;
  }

  const todo = snap.docs.filter((d) => d.data().moderation === undefined);
  const merged = todo.filter((d) => Boolean(d.data().mergedInto)).length;

  console.log(`  ${snap.size} posts total`);
  console.log(`  ${snap.size - todo.length} already carry a moderation state`);
  console.log(`  ${todo.length} to update, of which ${merged} are merged duplicates`);
  console.log(
    `  ${target === "approved" ? todo.length - merged : 0} will be publicly visible afterwards\n`,
  );

  if (!write) {
    console.log("Dry run only. Re-run with --write to apply.\n");
    return;
  }

  // 500 writes is Firestore's per-commit ceiling; one update each means
  // chunks of 400 leave room without needing to think about it.
  const CHUNK = 400;
  let done = 0;
  for (let i = 0; i < todo.length; i += CHUNK) {
    const batch = db.batch();
    for (const doc of todo.slice(i, i + CHUNK)) {
      const mergedInto = doc.data().mergedInto ?? null;
      batch.update(doc.ref, {
        moderation: target,
        isPublic: target === "approved" && mergedInto == null,
        // No reviewer and no timestamp: nobody actually reviewed these, and
        // inventing a reviewedAt would poison the median-review-time metric
        // on the analytics dashboard with a spike of fake instant decisions.
        reviewedAt: null,
        reviewerName: null,
        reviewNote: null,
        updatedAt: doc.data().updatedAt ?? FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    done += Math.min(CHUNK, todo.length - i);
    process.stdout.write(`  ${done}/${todo.length}\r`);
  }

  console.log(`\n\nDone. ${done} posts updated.`);
  console.log("Next: npm run deploy:rules to publish the rules and indexes.\n");
}

main().catch((err) => {
  console.error("\nBackfill failed:", err.message ?? err);
  process.exit(1);
});
