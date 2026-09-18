import type { Post, SortMode } from "./types";

const DAY = 86_400_000;

/**
 * Decay exponent for the trending sort.
 *
 * Calibrated against real board data, not picked for looking plausible. The
 * usual Hacker News constants (age in hours, gravity 1.8) assume content
 * that is stale in a day. Feedback tickets live for months, and with those
 * constants a three-day-old post with 28 votes outranks a six-week-old one
 * with 212 — the trending tab ends up sorted almost purely by recency,
 * which is what the "New" tab is already for.
 *
 * Age in days with a 0.6 exponent puts high-demand recent work on top,
 * lets a genuinely new idea climb quickly, and sinks things shipped months
 * ago without hiding them. Raise it toward 1 to favour recency harder;
 * drop it toward 0 to approach a plain vote count.
 */
const GRAVITY = 0.6;

/**
 * Hacker-News-style hot score.
 *
 * Why compute this on the client instead of storing it?
 *
 * A stored score has to be rewritten every time it decays, which means a
 * cron job rewriting every document forever, or a Cloud Function on every
 * vote. Neither is free and neither is necessary at feedback-board scale.
 *
 * Instead the trending query fetches a bounded candidate set from Firestore
 * (top N by votes within a recency window, which Firestore *can* index) and
 * this function re-orders that page. The result is identical to a stored
 * score for any realistic board size, costs nothing, and is always current
 * rather than as-fresh-as-the-last-cron.
 */
export function hotScore(post: Post, now = Date.now()): number {
  const ageDays = Math.max(0, (now - post.createdAt) / DAY);
  // Comments count for a third of a vote: discussion is a weaker but real
  // signal of interest, and the fraction stops one loud thread from
  // outweighing actual demand.
  const weight = post.voteCount + post.commentCount / 3;
  return (weight + 1) / Math.pow(ageDays + 2, GRAVITY);
}

export function sortPosts(posts: Post[], mode: SortMode): Post[] {
  const now = Date.now();
  const out = [...posts];
  switch (mode) {
    case "trending":
      out.sort((a, b) => hotScore(b, now) - hotScore(a, now));
      break;
    case "top":
      out.sort(
        (a, b) => b.voteCount - a.voteCount || b.createdAt - a.createdAt,
      );
      break;
    case "new":
      out.sort((a, b) => b.createdAt - a.createdAt);
      break;
  }
  // Pinned posts always float, in whatever order the active mode gave them.
  out.sort((a, b) => Number(b.pinned) - Number(a.pinned));
  return out;
}

export function relativeTime(ms: number, now = Date.now()): string {
  const diff = Math.max(0, now - ms);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/**
 * Validation score, for the admin dashboard's "most validated" list.
 *
 * This is a different question from the public trending sort, and it wants
 * a different formula. Trending asks "what should be at the top of the
 * board right now", so it decays hard and lets a brand new idea climb.
 * Validation asks "has this earned engineering time", where a steady
 * 200-vote request from eighteen months ago is a *stronger* signal than a
 * three-day-old spike, not a weaker one.
 *
 * So there is no age decay here at all. Instead:
 *
 *  - total votes are the base, because that is the demand;
 *  - comments are worth two thirds of a vote — more than in the trending
 *    formula, because someone taking the time to describe their use case
 *    is better evidence than a click;
 *  - recent votes are added on top rather than replacing the total, so
 *    momentum breaks ties between two equally-wanted ideas instead of
 *    deciding the ranking on its own.
 *
 * The output is not normalised to anything and is only meaningful as a
 * relative ordering, which is all the dashboard uses it for.
 */
export function validationScore(input: {
  voteCount: number;
  commentCount: number;
  recentVotes: number;
}): number {
  return (
    input.voteCount + input.commentCount * 0.66 + input.recentVotes * 1.5
  );
}

/** UTC YYYY-MM-DD, the bucket key for every timeline chart. */
export function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
