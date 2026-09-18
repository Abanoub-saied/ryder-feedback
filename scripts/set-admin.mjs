#!/usr/bin/env node
/**
 * Retired. Admin access is not granted any more — it is derived.
 *
 * This script used to set an `admin: true` custom claim. Nothing reads that
 * claim now: src/lib/access.ts and firestore.rules both admit exactly one
 * thing, a verified Google account on the company domain, and neither has a
 * second path. Sign in at /admin instead.
 *
 * Kept as a stub rather than deleted because a claim granted by an older
 * copy of this script may still be sitting on a user, and `--revoke` is how
 * you clear it. The claim grants nothing today, but a stale privilege marker
 * on an account is still worth removing.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { cert, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

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

const args = process.argv.slice(2).filter((a) => a !== "--");
const revoke = args.includes("--revoke");
const identifier = args.find((a) => !a.startsWith("--"));

if (!revoke) {
  console.error(
    "\n  Admin access is no longer granted by hand.\n\n" +
      "  It is a verified Google account on the company domain, checked in\n" +
      "  src/lib/access.ts and again in firestore.rules. Open /admin and\n" +
      "  sign in; there is no second path, on purpose.\n\n" +
      "  To clear a leftover claim from before this change:\n" +
      "    node scripts/set-admin.mjs <uid or email> --revoke\n",
  );
  process.exit(1);
}

if (!identifier) {
  console.error("\nUsage: node scripts/set-admin.mjs <email or uid> --revoke\n");
  process.exit(1);
}

loadEnv();

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

if (!projectId || !clientEmail || !privateKey) {
  console.error(
    "\nMissing service account credentials in .env.local. See SETUP.md step 4.\n",
  );
  process.exit(1);
}

initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const auth = getAuth();

async function main() {
  const user = identifier.includes("@")
    ? await auth.getUserByEmail(identifier)
    : await auth.getUser(identifier);

  const claims = { ...(user.customClaims ?? {}) };
  if (!("admin" in claims)) {
    console.log(`\nNo admin claim on ${user.email ?? user.uid}. Nothing to do.\n`);
    return;
  }

  delete claims.admin;
  await auth.setCustomUserClaims(user.uid, claims);
  // Revocation is the point here: it makes the tokens already in the wild
  // stop verifying, so the claim is gone now rather than within the hour.
  await auth.revokeRefreshTokens(user.uid);

  console.log(
    `\nCleared the admin claim on ${user.email ?? user.uid} (${user.uid}).\n`,
  );
}

main().catch((err) => {
  if (err.code === "auth/user-not-found") {
    console.error(`\nNo Firebase Auth user for "${identifier}".\n`);
  } else {
    console.error("\nFailed:", err.message ?? err);
  }
  process.exit(1);
});
