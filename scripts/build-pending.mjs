#!/usr/bin/env node
/**
 * Normalises the raw Frill inbox dump into scripts/frill-pending.json.
 *
 *   node scripts/build-pending.mjs
 *
 * The raw file is what the Frill admin's own GraphQL cache holds for the
 * "needs approval" queue. These ideas were never public on Frill, so they
 * import as `pending` and land in the review queue here rather than on the
 * board — the same decision, still waiting to be made, just moved.
 *
 * Boards are guessed from the title and body, because Frill's inbox items
 * mostly carry no topic. The guess is a convenience for triage, not a claim
 * to be right: order matters below, and anything unmatched lands in "other".
 */

import { readFileSync, writeFileSync } from "node:fs";

const LIMITS = { titleMax: 120, bodyMax: 4000, nameMax: 60 };

const RULES = [
  // Physical object first: a "case" or "button" is hardware whatever else
  // the sentence mentions.
  [/\bclip case|\bcase for|qi2|fireproof|recovery tag|apple ?tag|power on button|btc only device|refund|exchange to a new one|debit card/i, "device"],
  // Then the app, including anything asking for a screen, a setting or an
  // integration with another piece of software.
  [/\bapp\b|language|icloud|koinly|authenticator|passkey|copy ?past|\bcurrency\b|\beuro\b|sterling|categor|portfolio|segmentation|multiple ryder|third[- ]party wallet|walletconnect|dapp|xverse|leather|passphrase|25th word|bip-?39/i, "app"],
  // Then anything that is fundamentally "please support this chain/token".
  [/monero|xmr|jitosol|liquid staking|token|injective|wbtc|\bton\b|bep20|trc20|usdt|\bzec\b|hype|hbar|xlm|zbcn|\bflr\b|avalanche|\bsui\b|usdc|nano|\bxno\b|\bltc\b|\bdgb\b|\bdash\b|squidgrow|lcai|lightchain|\bl2\b|network|coin|crypto|memecoin|stacks|\bnft\b|deposit/i, "assets"],
];

/**
 * Title first, then the body. Bodies drag classifications around - a request
 * for a coin whose author happens to mention "the app" is still a request
 * for a coin - and on this board the title is almost always the whole ask.
 */
function board(idea) {
  for (const [re, id] of RULES) if (re.test(idea.title)) return id;
  for (const [re, id] of RULES) if (re.test(idea.body)) return id;
  return "other";
}

function clip(s, max) {
  const t = (s ?? "").replace(/\r\n/g, "\n").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

const raw = JSON.parse(readFileSync("scripts/frill-pending-raw.json", "utf8"));

const out = raw.map((i) => ({
  slug: i.slug,
  boardId: board(i),
  title: clip(i.title, LIMITS.titleMax),
  body: clip(i.body, LIMITS.bodyMax),
  authorName: clip(i.authorName, LIMITS.nameMax) || "Anonymous",
  status: "open",
  moderation: "pending",
  votes: i.votes,
  createdAt: i.createdAt.replace(/\.\d+Z$/, "Z"),
  comments: [],
}));

writeFileSync("scripts/frill-pending.json", `${JSON.stringify(out, null, 2)}\n`);

const counts = {};
for (const i of out) counts[i.boardId] = (counts[i.boardId] ?? 0) + 1;
const clipped = out.filter((i, n) => i.body.endsWith("…") || i.title !== raw[n].title.trim());

console.log(`\nwrote scripts/frill-pending.json — ${out.length} ideas`);
console.log("by board:", JSON.stringify(counts));
console.log(`shortened to fit the field limits: ${clipped.length}`);
for (const i of clipped) console.log(`  ${i.slug}`);
console.log("\nboard guesses:");
for (const i of out) console.log(`  ${i.boardId.padEnd(7)} ${i.title.slice(0, 62)}`);
