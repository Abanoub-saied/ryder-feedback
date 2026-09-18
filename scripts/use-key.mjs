#!/usr/bin/env node
/**
 * Copies the three values from a Firebase service account JSON file into
 * .env.local for you.
 *
 *   node scripts/use-key.mjs
 *   node scripts/use-key.mjs "C:\\Users\\me\\Downloads\\my-key.json"
 *
 * With no argument it looks in the project folder and your Downloads folder
 * for the most recently downloaded file that looks like a Firebase service
 * account, and uses that.
 *
 * It never prints the private key, and it makes a backup of .env.local
 * before changing anything.
 */

import { readdirSync, readFileSync, statSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const ENV_FILE = resolve(".env.local");

function die(message, hint) {
  console.error(`\n  ${message}\n`);
  if (hint) console.error(`  ${hint}\n`);
  process.exit(1);
}

function looksLikeServiceAccount(path) {
  try {
    if (statSync(path).size > 32_000) return false;
    const raw = readFileSync(path, "utf8");
    const json = JSON.parse(raw);
    return (
      typeof json.private_key === "string" &&
      json.private_key.includes("BEGIN PRIVATE KEY") &&
      typeof json.client_email === "string" &&
      typeof json.project_id === "string"
    );
  } catch {
    return false;
  }
}

/** Newest matching .json across the project folder and Downloads. */
function findKeyFile() {
  const places = [process.cwd(), join(homedir(), "Downloads"), homedir()];
  const found = [];

  for (const dir of places) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.toLowerCase().endsWith(".json")) continue;
      const full = join(dir, name);
      if (!looksLikeServiceAccount(full)) continue;
      found.push({ full, mtime: statSync(full).mtimeMs });
    }
  }

  found.sort((a, b) => b.mtime - a.mtime);
  return found[0]?.full ?? null;
}

const given = process.argv[2];
const keyPath = given ? resolve(given.replace(/^"|"$/g, "")) : findKeyFile();

if (!keyPath) {
  die(
    "Could not find your Firebase key file.",
    'Drag the downloaded .json file into this folder and run this again, or\n  pass the full path: node scripts/use-key.mjs "C:\\path\\to\\key.json"',
  );
}

if (!existsSync(keyPath)) die(`No file at: ${keyPath}`);
if (!looksLikeServiceAccount(keyPath)) {
  die(
    `That file is not a Firebase service account key: ${keyPath}`,
    "You want the file from Project settings -> Service accounts ->\n  Generate new private key. It contains project_id, client_email and\n  private_key.",
  );
}

const sa = JSON.parse(readFileSync(keyPath, "utf8"));

if (!existsSync(ENV_FILE)) {
  die(
    "No .env.local file here.",
    "Run this from inside the ryder-feedback folder (the one with\n  package.json in it).",
  );
}

let env = readFileSync(ENV_FILE, "utf8");

// JSON already stores newlines as the two characters \ and n, which is
// exactly the form .env.local wants, so the value goes across untouched.
const escapedKey = sa.private_key.replace(/\r?\n/g, "\\n");

function setVar(text, name, value) {
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  return pattern.test(text) ? text.replace(pattern, line) : `${text.trimEnd()}\n${line}\n`;
}

env = setVar(env, "FIREBASE_PROJECT_ID", sa.project_id);
env = setVar(env, "FIREBASE_CLIENT_EMAIL", sa.client_email);
env = setVar(env, "FIREBASE_PRIVATE_KEY", `"${escapedKey}"`);

copyFileSync(ENV_FILE, `${ENV_FILE}.backup`);
writeFileSync(ENV_FILE, env, "utf8");

const publicId = /^NEXT_PUBLIC_FIREBASE_PROJECT_ID=(.*)$/m.exec(env)?.[1]?.trim();

console.log(`
  Done. Read the key from:
    ${keyPath}

  Wrote into .env.local:
    FIREBASE_PROJECT_ID    = ${sa.project_id}
    FIREBASE_CLIENT_EMAIL  = ${sa.client_email}
    FIREBASE_PRIVATE_KEY   = (hidden, ${sa.private_key.length} characters)

  A copy of the old file is at .env.local.backup
`);

if (publicId && publicId !== sa.project_id) {
  console.log(`  Heads up: this key belongs to project "${sa.project_id}" but the
  app is pointed at "${publicId}". Those should match. Tell Claude if you
  are not sure which is right.
`);
} else {
  console.log(`  The key matches the project the app is pointed at. Good to go.
`);
}

console.log(`  Next: npx firebase login
`);
