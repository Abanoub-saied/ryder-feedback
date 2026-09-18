import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";

import { adminDb, requireAdmin } from "@/lib/firebase/admin";
import { errorResponse } from "@/lib/http";
import { dayKey, validationScore } from "@/lib/ranking";
import { ms } from "@/lib/serialize";
import type {
  AdminAnalytics,
  BoardStat,
  DayBucket,
  Moderation,
  PostStatus,
} from "@/lib/types";

export const runtime = "nodejs";
/** Always recomputed. A cached dashboard is a dashboard nobody trusts. */
export const dynamic = "force-dynamic";

const DAY = 86_400_000;
const MAX_WINDOW = 180;

/**
 * The admin dashboard's numbers.
 *
 * Why a server route rather than deriving this in the browser from the post
 * stream the admin views already hold:
 *
 *  1. Vote *timestamps* live on the receipt documents, not on the post. The
 *     post only carries a total. So "votes this week" — the single most
 *     useful validation signal, because it separates an idea with momentum
 *     from one that peaked eight months ago — is unanswerable client-side
 *     without reading every receipt on every post.
 *  2. Unique and repeat voters are a set union across every post, which is
 *     the same problem.
 *  3. Security rules do let an admin list vote receipts, so the browser
 *     *could* do it — at the cost of streaming every receipt on the board to
 *     a laptop. Here it is one server-side collection group query bounded by
 *     the reporting window.
 *
 * The two reads are: every post, and every vote receipt inside the window.
 * Both are plain reads rather than count() aggregations, because the derived
 * figures below — medians, voter sets, per-board rollups — are not things an
 * aggregation query can answer anyway.
 */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);

    const url = new URL(req.url);
    const windowDays = clampWindow(url.searchParams.get("days"));
    const since = Date.now() - windowDays * DAY;

    const db = adminDb();

    const [postsSnap, boardsSnap, votesSnap] = await Promise.all([
      db.collection("posts").get(),
      db.collection("boards").get(),
      // Receipts carry only createdAt, so the window filter is the whole
      // query. Older votes still count towards lifetime totals through
      // posts.voteCount; they are just not needed document by document.
      db
        .collectionGroup("votes")
        .where("createdAt", ">=", Timestamp.fromMillis(since))
        .get(),
    ]);

    const boardNames = new Map<string, string>();
    for (const b of boardsSnap.docs) {
      boardNames.set(b.id, String(b.data().name ?? b.id));
    }

    /* --- votes inside the window ------------------------------------- */

    // The receipt's document id is the voter's uid and its grandparent is the
    // post. That addressing is what makes both rollups below a single pass.
    const votesByPost = new Map<string, number>();
    const votesPerVoter = new Map<string, number>();
    const voteDays = new Map<string, number>();

    for (const receipt of votesSnap.docs) {
      const postId = receipt.ref.parent.parent?.id;
      if (postId) votesByPost.set(postId, (votesByPost.get(postId) ?? 0) + 1);
      votesPerVoter.set(receipt.id, (votesPerVoter.get(receipt.id) ?? 0) + 1);
      const at = ms(receipt.data().createdAt as never, 0);
      if (at) {
        const key = dayKey(at);
        voteDays.set(key, (voteDays.get(key) ?? 0) + 1);
      }
    }

    /* --- posts -------------------------------------------------------- */

    const ideaDays = new Map<string, number>();
    const commentDays = new Map<string, number>();
    const boardStats = new Map<string, BoardStat>();
    const reviewLatencies: number[] = [];
    const statusCounts = new Map<PostStatus, number>();
    const scored: AdminAnalytics["topValidated"] = [];

    let totalIdeas = 0;
    let publishedIdeas = 0;
    let pending = 0;
    let approvedEver = 0;
    let reviewedInWindow = 0;
    let approvedInWindow = 0;
    let totalVotes = 0;
    let totalComments = 0;
    let validated = 0;
    let zeroTraction = 0;
    let oldestPendingAt: number | null = null;

    for (const doc of postsSnap.docs) {
      const d = doc.data();
      const moderation = (d.moderation as Moderation) ?? "approved";
      const status = (d.status as PostStatus) ?? "open";
      const boardId = String(d.boardId ?? "");
      const createdAt = ms(d.createdAt as never, 0);
      const voteCount = Number(d.voteCount ?? 0);
      const commentCount = Number(d.commentCount ?? 0);
      const merged = Boolean(d.mergedInto);

      totalIdeas += 1;
      if (createdAt) {
        const key = dayKey(createdAt);
        ideaDays.set(key, (ideaDays.get(key) ?? 0) + 1);
        // Comment timestamps live on the comment documents. Reading every
        // comment on every post to bucket them by day would roughly double
        // the cost of this route for a secondary chart, so discussion is
        // attributed to the day its idea was submitted. That is right for the
        // shape of the curve and wrong for any single day's exact figure,
        // which is why the chart says "discussion on ideas from that day".
        if (commentCount) {
          commentDays.set(key, (commentDays.get(key) ?? 0) + commentCount);
        }
      }

      if (moderation === "pending") {
        pending += 1;
        if (
          createdAt &&
          (oldestPendingAt === null || createdAt < oldestPendingAt)
        ) {
          oldestPendingAt = createdAt;
        }
      }
      if (moderation === "approved") approvedEver += 1;

      const reviewedAt = d.reviewedAt == null ? 0 : ms(d.reviewedAt as never, 0);
      if (reviewedAt && createdAt) {
        reviewLatencies.push(reviewedAt - createdAt);
        if (reviewedAt >= since) {
          reviewedInWindow += 1;
          if (moderation === "approved") approvedInWindow += 1;
        }
      }

      const stat = boardStats.get(boardId) ?? {
        boardId,
        name: boardNames.get(boardId) ?? boardId,
        ideas: 0,
        votes: 0,
        comments: 0,
        shipped: 0,
      };

      if (moderation === "approved" && !merged) {
        publishedIdeas += 1;
        totalVotes += voteCount;
        totalComments += commentCount;
        statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);

        // Every idea starts with its author's own vote, so "more than one" is
        // the line between something other people wanted and something only
        // its author wanted. That distinction is the entire point of the
        // dashboard, so it gets its own metric rather than being buried in an
        // average.
        if (voteCount > 1) validated += 1;
        else zeroTraction += 1;

        stat.ideas += 1;
        stat.votes += voteCount;
        stat.comments += commentCount;
        if (status === "shipped") stat.shipped += 1;

        const recentVotes = votesByPost.get(doc.id) ?? 0;
        scored.push({
          id: doc.id,
          title: String(d.title ?? ""),
          boardName: boardNames.get(boardId) ?? boardId,
          status,
          voteCount,
          commentCount,
          recentVotes,
          score: validationScore({ voteCount, commentCount, recentVotes }),
        });
      }

      boardStats.set(boardId, stat);
    }

    scored.sort((a, b) => b.score - a.score);

    const analytics: AdminAnalytics = {
      generatedAt: Date.now(),
      windowDays,
      queue: {
        pending,
        oldestPendingHours:
          oldestPendingAt === null
            ? null
            : round1((Date.now() - oldestPendingAt) / 3_600_000),
        // Median, not mean: one idea that sat unreviewed over a holiday
        // would drag a mean past the point of being actionable.
        medianReviewHours:
          reviewLatencies.length === 0
            ? null
            : round1(median(reviewLatencies) / 3_600_000),
        // Scoped to the window rather than all time: an approval rate that
        // includes the board's first month says nothing about today's bar.
        approvalRate:
          reviewedInWindow === 0 ? 0 : approvedInWindow / reviewedInWindow,
        reviewedInWindow,
      },
      engagement: {
        totalIdeas,
        publishedIdeas,
        totalVotes,
        totalComments,
        uniqueVoters: votesPerVoter.size,
        repeatVoters: [...votesPerVoter.values()].filter((n) => n > 1).length,
        votesPerIdea: publishedIdeas ? totalVotes / publishedIdeas : 0,
        commentsPerIdea: publishedIdeas ? totalComments / publishedIdeas : 0,
        validatedShare: publishedIdeas ? validated / publishedIdeas : 0,
        zeroTractionShare: publishedIdeas ? zeroTraction / publishedIdeas : 0,
      },
      funnel: {
        submitted: totalIdeas,
        approved: approvedEver,
        planned: statusCounts.get("planned") ?? 0,
        inProgress: statusCounts.get("in-progress") ?? 0,
        shipped: statusCounts.get("shipped") ?? 0,
        declined: statusCounts.get("declined") ?? 0,
      },
      timeline: buildTimeline(windowDays, ideaDays, voteDays, commentDays),
      boards: [...boardStats.values()]
        .filter((b) => b.boardId)
        .sort((a, b) => b.votes - a.votes),
      topValidated: scored.slice(0, 10),
    };

    return NextResponse.json(analytics, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

function clampWindow(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 30;
  return Math.min(MAX_WINDOW, Math.max(7, Math.round(n)));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * One bucket per day, empty days included, so a chart renders a quiet week
 * as a quiet week instead of closing the gap and implying activity that
 * never happened.
 */
function buildTimeline(
  windowDays: number,
  ideas: Map<string, number>,
  votes: Map<string, number>,
  comments: Map<string, number>,
): DayBucket[] {
  const out: DayBucket[] = [];
  const today = Date.now();
  for (let i = windowDays - 1; i >= 0; i--) {
    const day = dayKey(today - i * DAY);
    out.push({
      day,
      ideas: ideas.get(day) ?? 0,
      votes: votes.get(day) ?? 0,
      comments: comments.get(day) ?? 0,
    });
  }
  return out;
}
