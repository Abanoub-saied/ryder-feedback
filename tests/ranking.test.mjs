/**
 * Unit tests for the trending sort.
 *
 *   npm run test:unit
 *
 * These exist because the first version of this formula was wrong in a way
 * that looked fine in code review and obviously broken on screen: the decay
 * was so steep that the trending tab listed the *least* voted items first.
 * The assertions below pin the calibration so that cannot come back.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hotScore, relativeTime, sortPosts } from "../src/lib/ranking.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 8);

function post(over = {}) {
  return {
    id: "x",
    title: "t",
    body: "",
    boardId: "app",
    status: "open",
    authorId: "a",
    authorName: "A",
    voteCount: 0,
    commentCount: 0,
    pinned: false,
    mergedInto: null,
    roadmapNote: null,
    eta: null,
    tags: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

const daysAgo = (n) => NOW - n * DAY;

describe("hotScore", () => {
  it("prefers more votes at the same age", () => {
    const a = post({ voteCount: 50, createdAt: daysAgo(10) });
    const b = post({ voteCount: 10, createdAt: daysAgo(10) });
    assert.ok(hotScore(a, NOW) > hotScore(b, NOW));
  });

  it("prefers the newer of two equally voted posts", () => {
    const fresh = post({ voteCount: 30, createdAt: daysAgo(2) });
    const old = post({ voteCount: 30, createdAt: daysAgo(200) });
    assert.ok(hotScore(fresh, NOW) > hotScore(old, NOW));
  });

  it("does not let recency beat an order-of-magnitude vote gap", () => {
    // The exact regression. 28 votes from three days ago must not outrank
    // 212 votes from six weeks ago on a board where tickets live for months.
    const small = post({ voteCount: 28, createdAt: daysAgo(3) });
    const big = post({ voteCount: 212, createdAt: daysAgo(46) });
    assert.ok(
      hotScore(big, NOW) > hotScore(small, NOW),
      "high-demand work should stay on top of the trending tab",
    );
  });

  it("still lets a fast-climbing new idea overtake an old one", () => {
    const climbing = post({ voteCount: 60, createdAt: daysAgo(2) });
    const stale = post({ voteCount: 90, createdAt: daysAgo(300) });
    assert.ok(hotScore(climbing, NOW) > hotScore(stale, NOW));
  });

  it("counts comments as a fraction of a vote", () => {
    const quiet = post({ voteCount: 10, createdAt: daysAgo(5) });
    const chatty = post({ voteCount: 10, commentCount: 30, createdAt: daysAgo(5) });
    assert.ok(hotScore(chatty, NOW) > hotScore(quiet, NOW));

    // ...but not as a full vote each.
    const voted = post({ voteCount: 40, createdAt: daysAgo(5) });
    assert.ok(hotScore(voted, NOW) > hotScore(chatty, NOW));
  });

  it("never divides by zero for a post created this instant", () => {
    const s = hotScore(post({ voteCount: 1, createdAt: NOW }), NOW);
    assert.ok(Number.isFinite(s) && s > 0);
  });

  it("tolerates a clock skew that puts createdAt in the future", () => {
    const s = hotScore(post({ voteCount: 1, createdAt: NOW + DAY }), NOW);
    assert.ok(Number.isFinite(s) && s > 0);
  });
});

describe("sortPosts", () => {
  const posts = [
    post({ id: "old-popular", voteCount: 212, createdAt: daysAgo(46) }),
    post({ id: "new-small", voteCount: 28, createdAt: daysAgo(3) }),
    post({ id: "ancient-huge", voteCount: 400, createdAt: daysAgo(900) }),
  ];

  it("orders 'top' purely by votes", () => {
    assert.deepEqual(
      sortPosts(posts, "top").map((p) => p.id),
      ["ancient-huge", "old-popular", "new-small"],
    );
  });

  it("orders 'new' purely by date", () => {
    assert.deepEqual(
      sortPosts(posts, "new").map((p) => p.id),
      ["new-small", "old-popular", "ancient-huge"],
    );
  });

  it("orders 'trending' by demand tempered with recency", () => {
    // old-popular (212 votes, 6 weeks) leads on demand. new-small then beats
    // ancient-huge despite having a fourteenth of its votes, because a
    // ticket from two and a half years ago is not trending by any reading of
    // the word — "Top" is the tab that still puts it first.
    assert.deepEqual(
      sortPosts(posts, "trending").map((p) => p.id),
      ["old-popular", "new-small", "ancient-huge"],
    );
  });

  it("floats pinned posts in every mode", () => {
    const withPin = [...posts, post({ id: "pinned", voteCount: 1, pinned: true })];
    for (const mode of ["trending", "top", "new"]) {
      assert.equal(sortPosts(withPin, mode)[0].id, "pinned", `mode: ${mode}`);
    }
  });

  it("does not mutate the array it was given", () => {
    const original = posts.map((p) => p.id);
    sortPosts(posts, "top");
    assert.deepEqual(
      posts.map((p) => p.id),
      original,
    );
  });
});

describe("relativeTime", () => {
  it("reads naturally across the ranges", () => {
    assert.equal(relativeTime(NOW, NOW), "just now");
    assert.equal(relativeTime(NOW - 5 * 60_000, NOW), "5m ago");
    assert.equal(relativeTime(NOW - 3 * 3_600_000, NOW), "3h ago");
    assert.equal(relativeTime(NOW - 4 * DAY, NOW), "4d ago");
    assert.equal(relativeTime(NOW - 60 * DAY, NOW), "2mo ago");
    assert.equal(relativeTime(NOW - 400 * DAY, NOW), "1y ago");
  });

  it("does not render a negative duration", () => {
    assert.equal(relativeTime(NOW + 10_000, NOW), "just now");
  });
});
