/**
 * Shared domain types. These are the wire shapes used by both the client
 * (Firestore reads) and the server (route handlers), with Firestore
 * Timestamps normalised to epoch milliseconds at the boundary so that
 * nothing downstream has to care which SDK produced the object.
 */

export const POST_STATUSES = [
  "open",
  "under-review",
  "planned",
  "in-progress",
  "shipped",
  "declined",
] as const;

export type PostStatus = (typeof POST_STATUSES)[number];

/**
 * Publication state, which is a different axis from `status`.
 *
 * `status` answers "where is this in our pipeline?" and is the thing the
 * public roadmap groups by. `moderation` answers "may the public see this
 * at all?" and is owned entirely by admins. Conflating them — adding a
 * seventh "pending" status — would have meant every status filter, every
 * roadmap column and every count had to remember to exclude one magic
 * value, and an admin could not say "this is approved AND planned" in one
 * move. Two fields, two questions.
 */
export const MODERATION_STATES = ["pending", "approved", "rejected"] as const;

export type Moderation = (typeof MODERATION_STATES)[number];

export interface ModerationMeta {
  label: string;
  bg: string;
  fg: string;
  accent: string;
  /** Shown to the submitter on their own idea. */
  authorNote: string;
}

export const MODERATION_META: Record<Moderation, ModerationMeta> = {
  pending: {
    label: "Awaiting review",
    bg: "var(--label-yellow-bg)",
    fg: "var(--label-yellow-fg)",
    accent: "var(--label-yellow-fg)",
    authorNote:
      "Only you can see this. It goes on the public board once a Ryder admin approves it.",
  },
  approved: {
    label: "Published",
    bg: "var(--label-green-bg)",
    fg: "var(--label-green-fg)",
    accent: "var(--earn-high)",
    authorNote: "Live on the public board.",
  },
  rejected: {
    label: "Not published",
    bg: "var(--label-red-bg)",
    fg: "var(--label-red-fg)",
    accent: "var(--label-red-fg)",
    authorNote: "This one will not go on the public board.",
  },
};

/** The three columns the public roadmap renders, in order. */
export const ROADMAP_STATUSES: PostStatus[] = [
  "planned",
  "in-progress",
  "shipped",
];

export interface StatusMeta {
  label: string;
  /** Chip fill — a Label background token from the colour system. */
  bg: string;
  /** Chip text — the matching Label content token. */
  fg: string;
  /**
   * The status at full strength, for dots, rails and timeline markers
   * where the colour has to carry on its own rather than inside a chip.
   */
  accent: string;
  onRoadmap: boolean;
  description: string;
}

/**
 * Status colours, drawn from the colour system's Label scales.
 *
 * Six statuses against four label hues, so the extra separation comes
 * from *weight* rather than from inventing a fifth hue: the three states
 * that are not on the public roadmap stay quiet (neutral, and the low
 * contrast yellow / red), while in-progress — the only status that means
 * "happening right now" — takes the high contrast Medium pair and is
 * deliberately the loudest chip on the page.
 */
export const STATUS_META: Record<PostStatus, StatusMeta> = {
  open: {
    label: "Open",
    bg: "var(--surface-2)",
    fg: "var(--ink-2)",
    accent: "var(--stroke-2)",
    onRoadmap: false,
    description: "Collecting votes and comments.",
  },
  "under-review": {
    label: "Under review",
    bg: "var(--label-yellow-bg)",
    fg: "var(--label-yellow-fg)",
    accent: "var(--label-yellow-fg)",
    onRoadmap: false,
    description: "We are looking at this and scoping it.",
  },
  planned: {
    label: "Planned",
    bg: "var(--label-blue-bg)",
    fg: "var(--label-blue-fg)",
    accent: "var(--brand)",
    onRoadmap: true,
    description: "Committed. Not started yet.",
  },
  "in-progress": {
    label: "In progress",
    bg: "var(--hc-medium-bg)",
    fg: "var(--hc-medium-fg)",
    accent: "var(--hc-medium-bg)",
    onRoadmap: true,
    description: "Being built right now.",
  },
  shipped: {
    label: "Shipped",
    bg: "var(--label-green-bg)",
    fg: "var(--label-green-fg)",
    accent: "var(--earn-high)",
    onRoadmap: true,
    description: "Live for everyone.",
  },
  declined: {
    label: "Declined",
    bg: "var(--label-red-bg)",
    fg: "var(--label-red-fg)",
    accent: "var(--label-red-fg)",
    onRoadmap: false,
    description: "Not something we plan to build.",
  },
};

export interface Board {
  id: string;
  name: string;
  slug: string;
  description: string;
  order: number;
  postCount: number;
}

export interface Post {
  id: string;
  title: string;
  body: string;
  boardId: string;
  status: PostStatus;
  /** Firebase Auth uid of the submitter. Anonymous uids are fine. */
  authorId: string;
  /** Display name only. Email never lives on a publicly readable doc. */
  authorName: string;
  voteCount: number;
  commentCount: number;
  pinned: boolean;
  /** Publication gate. New posts land as "pending" and are private to the author. */
  moderation: Moderation;
  /**
   * Denormalised `moderation === "approved" && mergedInto === null`.
   *
   * Every public query filters on exactly this one field. Keeping it as a
   * single boolean rather than two separate equality filters is what stops
   * the composite index set from doubling, and it is the field the security
   * rules key public reads off — so "invisible in the UI" and "unreadable
   * from the database" are the same condition rather than two that can
   * drift apart. Server-owned; nothing else may write it.
   */
  isPublic: boolean;
  /** When an admin approved or rejected it. Null while pending. */
  reviewedAt: number | null;
  /** Display name of the admin who reviewed it. */
  reviewerName: string | null;
  /** Why it was rejected, or a note on approval. Shown to the author. */
  reviewNote: string | null;
  /** Set when an admin merges this post into another. Merged posts are hidden. */
  mergedInto: string | null;
  /** Optional short note an admin can surface on the roadmap card. */
  roadmapNote: string | null;
  /** Free-text target, e.g. "Q4 2026". Deliberately not a hard date. */
  eta: string | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Comment {
  id: string;
  postId: string;
  body: string;
  authorId: string;
  authorName: string;
  /**
   * Verified server-side from the caller's token, never from the request
   * body. It is the only mark a Ryder reply carries.
   */
  isAdmin: boolean;
  parentId: string | null;
  createdAt: number;
}

export type PostEventType =
  | "created"
  | "status"
  | "merged"
  | "note"
  | "approved"
  | "rejected";

export interface PostEvent {
  id: string;
  type: PostEventType;
  from: PostStatus | null;
  to: PostStatus | null;
  actorName: string;
  message: string | null;
  createdAt: number;
}

export type SortMode = "trending" | "top" | "new";

export interface UserProfile {
  uid: string;
  displayName: string | null;
  /** Private. Lives on users/{uid}, readable only by the owner and admins. */
  email: string | null;
  isAnonymous: boolean;
  isAdmin: boolean;
  createdAt: number;
}

/* ------------------------------------------------------------------
   Admin analytics
   ------------------------------------------------------------------ */

/** One day's worth of activity, for the dashboard's timeline charts. */
export interface DayBucket {
  /** YYYY-MM-DD, UTC. */
  day: string;
  ideas: number;
  votes: number;
  comments: number;
}

export interface BoardStat {
  boardId: string;
  name: string;
  ideas: number;
  votes: number;
  comments: number;
  shipped: number;
}

/**
 * What the admin dashboard reports.
 *
 * Split into three groups on purpose, because they answer three different
 * questions: `queue` is "what do I owe people right now", `validation` is
 * "which ideas have actually earned a slot on the roadmap", and `funnel`
 * is "does this board convert submissions into shipped work at all".
 */
export interface AdminAnalytics {
  generatedAt: number;
  windowDays: number;
  queue: {
    pending: number;
    /** Age in hours of the oldest thing still waiting. */
    oldestPendingHours: number | null;
    /** Median hours from submission to an approve/reject decision. */
    medianReviewHours: number | null;
    approvalRate: number;
    reviewedInWindow: number;
  };
  engagement: {
    totalIdeas: number;
    publishedIdeas: number;
    totalVotes: number;
    totalComments: number;
    uniqueVoters: number;
    /** Voters who backed more than one idea — the repeat-engagement signal. */
    repeatVoters: number;
    votesPerIdea: number;
    commentsPerIdea: number;
    /** Share of published ideas with at least one vote beyond the author's. */
    validatedShare: number;
    /** Share with no vote but the author's own. */
    zeroTractionShare: number;
  };
  funnel: {
    submitted: number;
    approved: number;
    planned: number;
    inProgress: number;
    shipped: number;
    declined: number;
  };
  timeline: DayBucket[];
  boards: BoardStat[];
  /** Top ideas by the validation score in src/lib/ranking.ts. */
  topValidated: {
    id: string;
    title: string;
    boardName: string;
    status: PostStatus;
    voteCount: number;
    commentCount: number;
    /** Votes cast in the last `windowDays`. */
    recentVotes: number;
    score: number;
  }[];
}
