#!/usr/bin/env node
/**
 * Deploy rules and indexes using the service account in .env.local, for when
 * the Firebase CLI's login has expired.
 *
 *   node scripts/deploy-with-key.mjs              # dry run
 *   node scripts/deploy-with-key.mjs --write      # apply
 *   node scripts/deploy-with-key.mjs --status     # just report index state
 *
 * `npm run deploy:rules` is the normal path and should be preferred — it is
 * one command and it is what the docs tell people to run. This exists because
 * `firebase login` is an interactive browser flow, and an agent, a CI box or
 * anyone on a machine without a browser cannot complete it. The service
 * account credential is already present for the app's own writes, so the same
 * key can talk to the two admin APIs directly.
 *
 * What it does, in order:
 *
 *   1. Saves the currently deployed ruleset to firestore.rules.backup, so a
 *      bad deploy can be reversed. Deploying rules changes who can read what,
 *      and this project has no version control to fall back on.
 *   2. Creates any composite index in firestore.indexes.json that does not
 *      already exist. Index creation is additive and asynchronous — the API
 *      returns immediately and Firestore builds in the background.
 *   3. Uploads firestore.rules as a new ruleset and points the release at it.
 *
 * Indexes before rules, deliberately: the new rules require queries to filter
 * on isPublic, and those queries cannot run at all until their index exists.
 * Creating the indexes first keeps the unavailable window as short as
 * possible rather than stacking two outages.
 *
 * Permissions the key needs: datastore.indexes.create / .list for step 2, and
 * firebaserules.rulesets.create + releases.update for step 3. The default
 * firebase-adminsdk service account has both. If it does not, this stops with
 * the API's own message rather than half-deploying.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { GoogleAuth } = require("google-auth-library");

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
    "\nMissing service account credentials in .env.local " +
      "(FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY).\n",
  );
  process.exit(1);
}

const write = process.argv.includes("--write");
const statusOnly = process.argv.includes("--status");

const auth = new GoogleAuth({
  credentials: { client_email: clientEmail, private_key: privateKey },
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

let token;
async function call(url, { method = "GET", body } = {}) {
  token ??= await auth.getAccessToken();
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  return { ok: res.ok, status: res.status, json };
}

const DB = `projects/${projectId}/databases/(default)`;
const FS = "https://firestore.googleapis.com/v1";
const RULES = "https://firebaserules.googleapis.com/v1";

/** Order-sensitive signature, so an index is matched rather than duplicated. */
function signature(collectionGroup, queryScope, fields) {
  const parts = fields.map(
    (f) => `${f.fieldPath}:${f.order ?? f.arrayConfig ?? ""}`,
  );
  return `${collectionGroup}|${queryScope}|${parts.join(",")}`;
}

async function listIndexes(collectionGroup) {
  const out = [];
  let pageToken;
  do {
    const url =
      `${FS}/${DB}/collectionGroups/${collectionGroup}/indexes` +
      (pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : "");
    const res = await call(url);
    if (!res.ok) {
      throw new Error(
        `listing ${collectionGroup} indexes failed (${res.status}): ` +
          (res.json.error?.message ?? JSON.stringify(res.json)),
      );
    }
    out.push(...(res.json.indexes ?? []));
    pageToken = res.json.nextPageToken;
  } while (pageToken);
  return out;
}

async function main() {
  console.log(
    `\n${statusOnly ? "Index status for" : write ? "Deploying to" : "Dry run against"} ${projectId}\n`,
  );

  const wanted = JSON.parse(readFileSync("firestore.indexes.json", "utf8"))
    .indexes;

  const groups = [...new Set(wanted.map((i) => i.collectionGroup))];
  const existing = new Map();
  for (const group of groups) {
    for (const idx of await listIndexes(group)) {
      // __name__ is appended by Firestore itself and is not written in the
      // config file, so it is dropped before comparing.
      const fields = (idx.fields ?? []).filter(
        (f) => f.fieldPath !== "__name__",
      );
      existing.set(
        signature(group, idx.queryScope, fields),
        idx,
      );
    }
  }

  if (statusOnly) {
    let ready = 0;
    let building = 0;
    for (const idx of wanted) {
      const found = existing.get(
        signature(idx.collectionGroup, idx.queryScope, idx.fields),
      );
      const state = found?.state ?? "MISSING";
      if (state === "READY") ready++;
      else building++;
      console.log(
        `  ${state.padEnd(9)} ${idx.collectionGroup} ` +
          idx.fields.map((f) => f.fieldPath).join(" + "),
      );
    }
    console.log(`\n  ${ready} ready, ${building} not ready.\n`);
    return;
  }

  const missing = wanted.filter(
    (idx) =>
      !existing.has(signature(idx.collectionGroup, idx.queryScope, idx.fields)),
  );

  console.log(`  ${wanted.length} indexes in firestore.indexes.json`);
  console.log(`  ${wanted.length - missing.length} already exist`);
  console.log(`  ${missing.length} to create\n`);

  if (!write) {
    for (const idx of missing) {
      console.log(
        `    would create  ${idx.collectionGroup}: ` +
          idx.fields.map((f) => `${f.fieldPath} ${f.order}`).join(", "),
      );
    }
    console.log("\nDry run only. Re-run with --write to apply.\n");
    return;
  }

  /* --- 1. back up the deployed rules ------------------------------- */

  const release = await call(`${RULES}/projects/${projectId}/releases`);
  if (release.ok) {
    const current = (release.json.releases ?? []).find((r) =>
      r.name.endsWith("/cloud.firestore"),
    );
    if (current?.rulesetName) {
      const ruleset = await call(`${RULES}/${current.rulesetName}`);
      const source = ruleset.json.source?.files?.[0]?.content;
      if (source) {
        writeFileSync("firestore.rules.backup", source, "utf8");
        console.log(
          "  saved the live rules to firestore.rules.backup " +
            `(${current.rulesetName.split("/").pop()})`,
        );
      }
    }
  } else {
    console.log(
      `  could not read the current rules (${release.status}) — continuing ` +
        "without a backup",
    );
  }

  /* --- 2. indexes --------------------------------------------------- */

  let created = 0;
  for (const idx of missing) {
    const res = await call(
      `${FS}/${DB}/collectionGroups/${idx.collectionGroup}/indexes`,
      {
        method: "POST",
        body: {
          queryScope: idx.queryScope,
          fields: idx.fields.map((f) => ({
            fieldPath: f.fieldPath,
            ...(f.order ? { order: f.order } : {}),
            ...(f.arrayConfig ? { arrayConfig: f.arrayConfig } : {}),
          })),
        },
      },
    );
    const label =
      `${idx.collectionGroup}: ` + idx.fields.map((f) => f.fieldPath).join(" + ");
    if (res.ok) {
      created++;
      console.log(`  creating  ${label}`);
    } else if (res.json.error?.status === "ALREADY_EXISTS") {
      console.log(`  exists    ${label}`);
    } else {
      throw new Error(
        `creating index (${label}) failed (${res.status}): ` +
          (res.json.error?.message ?? JSON.stringify(res.json)),
      );
    }
  }

  console.log(
    `\n  ${created} index${created === 1 ? "" : "es"} queued. Firestore builds ` +
      "these in the background.\n",
  );

  /* --- 3. rules ----------------------------------------------------- */

  const source = readFileSync("firestore.rules", "utf8");
  const ruleset = await call(`${RULES}/projects/${projectId}/rulesets`, {
    method: "POST",
    body: {
      source: {
        files: [{ name: "firestore.rules", content: source }],
      },
    },
  });
  if (!ruleset.ok) {
    throw new Error(
      `uploading rules failed (${ruleset.status}): ` +
        (ruleset.json.error?.message ?? JSON.stringify(ruleset.json)),
    );
  }

  const releaseName = `projects/${projectId}/releases/cloud.firestore`;
  // The release already exists, so this is an update. PATCH on the release
  // resource is what actually points production at the new ruleset —
  // uploading a ruleset on its own changes nothing.
  const put = await call(`${RULES}/${releaseName}`, {
    method: "PATCH",
    body: { release: { name: releaseName, rulesetName: ruleset.json.name } },
  });
  if (!put.ok) {
    throw new Error(
      `publishing rules failed (${put.status}): ` +
        (put.json.error?.message ?? JSON.stringify(put.json)),
    );
  }

  console.log(`  rules published (${ruleset.json.name.split("/").pop()})`);
  console.log(
    "\nDone. Check index progress with:\n" +
      "  node scripts/deploy-with-key.mjs --status\n",
  );
}

main().catch((err) => {
  console.error(`\nDeploy failed: ${err.message}\n`);
  console.error(
    "Nothing is half-applied that cannot be re-run: creating an index twice " +
      "is a no-op, and the rules are only live once the release is updated.\n",
  );
  process.exit(1);
});
