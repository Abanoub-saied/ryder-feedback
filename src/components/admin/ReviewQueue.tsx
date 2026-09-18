"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { StatusBadge } from "@/components/StatusBadge";
import { useToast } from "@/components/Toast";
import { useBoards } from "@/hooks/use-boards";
import { usePosts } from "@/hooks/use-posts";
import { useIdentity } from "@/lib/auth-context";
import { relativeTime } from "@/lib/ranking";
import {
  MODERATION_META,
  POST_STATUSES,
  STATUS_META,
  type Moderation,
  type Post,
  type PostStatus,
} from "@/lib/types";

type Bucket = Moderation;

const BUCKETS: { id: Bucket; label: string }[] = [
  { id: "pending", label: "Waiting" },
  { id: "approved", label: "Published" },
  { id: "rejected", label: "Declined" },
];

/**
 * The moderation queue: the one screen that decides what the public sees.
 *
 * Two decisions shaped it.
 *
 * **Oldest first, not most-voted.** A submission nobody has answered is a
 * promise outstanding, and its cost grows with age. Sorting the queue by
 * anything else optimises for the reviewer's interest over the submitter's
 * wait — and a pending idea has barely any votes anyway, because nobody can
 * see it to vote on it.
 *
 * **Approval and status are one action.** Approving asks for the pipeline
 * status in the same control, so an idea never lands on the public board at
 * a placeholder status that somebody then has to remember to fix. The
 * default is Open, which is the honest answer for most things: published,
 * collecting votes, not yet committed to.
 *
 * Declining requires a reason, enforced in validate.ts rather than here.
 * The reason is shown to the submitter on /me, which is the difference
 * between a decision and a silence.
 */
export function ReviewQueue() {
  const toast = useToast();
  const { authedFetch } = useIdentity();
  const { boards } = useBoards();

  const [bucket, setBucket] = useState<Bucket>("pending");
  const [busyId, setBusyId] = useState<string | null>(null);

  const { posts, loading, error } = usePosts({
    sort: "new",
    max: 300,
    scope: bucket,
  });

  const boardsById = useMemo(
    () => new Map(boards.map((b) => [b.id, b])),
    [boards],
  );

  const rows = useMemo(
    () =>
      bucket === "pending"
        ? [...posts].sort((a, b) => a.createdAt - b.createdAt)
        : [...posts].sort(
            (a, b) => (b.reviewedAt ?? b.createdAt) - (a.reviewedAt ?? a.createdAt),
          ),
    [posts, bucket],
  );

  const review = useCallback(
    async (
      post: Post,
      moderation: Moderation,
      opts: { status?: PostStatus; reviewNote?: string } = {},
    ) => {
      setBusyId(post.id);
      try {
        const res = await authedFetch(`/api/admin/posts/${post.id}`, {
          method: "PATCH",
          body: JSON.stringify({ moderation, ...opts }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          toast(data.error ?? "That did not go through.", "error");
          return false;
        }
        toast(
          moderation === "approved"
            ? `Published as ${STATUS_META[opts.status ?? post.status].label}.`
            : moderation === "rejected"
              ? "Declined. The submitter can see your reason."
              : "Moved back to the queue.",
          "success",
        );
        return true;
      } catch {
        toast("Network error.", "error");
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [authedFetch, toast],
  );

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-[18px] font-semibold">Review queue</h2>
          <p className="mt-1 max-w-prose text-[13.5px] leading-relaxed text-ink-2">
            Nothing reaches the public board until it is approved here. Oldest
            submission first, because that is the one that has been waiting
            longest.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {BUCKETS.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setBucket(b.id)}
              aria-pressed={bucket === b.id}
              className="chip"
            >
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: MODERATION_META[b.id].accent }}
              />
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-5 rounded-card p-4 text-[13px]"
          style={{ background: "var(--label-red-bg)", color: "var(--label-red-fg)" }}
        >
          {error}
        </p>
      )}

      <div className="mt-5 space-y-3">
        {loading ? (
          [0, 1, 2].map((i) => <div key={i} className="skeleton h-[150px]" />)
        ) : rows.length === 0 ? (
          <div className="grad-surface rounded-lg border border-stroke px-6 py-16 text-center">
            <p className="text-[16px] font-semibold">
              {bucket === "pending"
                ? "Nothing waiting. Good place to be."
                : `Nothing ${bucket === "approved" ? "published" : "declined"} yet.`}
            </p>
            {bucket === "pending" && (
              <p className="mx-auto mt-1.5 max-w-sm text-[13.5px] text-ink-2">
                New submissions land here the moment they are posted.
              </p>
            )}
          </div>
        ) : (
          rows.map((post) => (
            <ReviewCard
              key={post.id}
              post={post}
              boardName={boardsById.get(post.boardId)?.name}
              busy={busyId === post.id}
              onReview={review}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ReviewCard({
  post,
  boardName,
  busy,
  onReview,
}: {
  post: Post;
  boardName?: string;
  busy: boolean;
  onReview: (
    post: Post,
    moderation: Moderation,
    opts?: { status?: PostStatus; reviewNote?: string },
  ) => Promise<boolean>;
}) {
  const [status, setStatus] = useState<PostStatus>(post.status);
  const [note, setNote] = useState("");
  const [declining, setDeclining] = useState(false);

  const pending = post.moderation === "pending";
  const waitedHours = (Date.now() - post.createdAt) / 3_600_000;
  // Three days without an answer is where a feedback board starts to read as
  // abandoned, so the queue says so rather than leaving it to be noticed.
  const stale = pending && waitedHours > 72;

  return (
    <article
      className="card p-4"
      style={
        stale
          ? { boxShadow: "inset 3px 0 0 0 var(--label-red-fg)" }
          : pending
            ? { boxShadow: "inset 3px 0 0 0 var(--label-yellow-fg)" }
            : undefined
      }
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-ink-2">
        <span className="font-medium text-ink">{post.authorName}</span>
        <span aria-hidden>·</span>
        <time dateTime={new Date(post.createdAt).toISOString()}>
          {relativeTime(post.createdAt)}
        </time>
        {boardName && (
          <>
            <span aria-hidden>·</span>
            <span>{boardName}</span>
          </>
        )}
        {stale && (
          <span
            className="rounded-pill px-2 py-0.5 text-[11px] font-semibold"
            style={{
              background: "var(--label-red-bg)",
              color: "var(--label-red-fg)",
            }}
          >
            waiting {Math.round(waitedHours / 24)} days
          </span>
        )}
        {!pending && <StatusBadge status={post.status} />}
      </div>

      <h3 className="mt-1.5 text-[16px] font-semibold leading-snug">
        {post.moderation === "approved" ? (
          <Link href={`/p/${post.id}`} className="hover:text-[var(--link)]">
            {post.title}
          </Link>
        ) : (
          post.title
        )}
      </h3>

      {post.body && (
        <p className="mt-1.5 whitespace-pre-line text-[13.5px] leading-relaxed text-ink-2">
          {post.body}
        </p>
      )}

      {post.reviewNote && (
        <p className="mt-2 text-[12.5px] text-ink-2">
          <span className="font-semibold">{post.reviewerName}:</span>{" "}
          {post.reviewNote}
        </p>
      )}

      {pending ? (
        declining ? (
          <div className="mt-3 border-t border-stroke pt-3">
            <label
              htmlFor={`decline-${post.id}`}
              className="mb-1.5 block text-[12.5px] font-medium"
            >
              Why are you declining this? The submitter sees it.
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id={`decline-${post.id}`}
                className="input min-w-[220px] flex-1"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={300}
                placeholder="e.g. Already covered by the XRP support ticket"
                autoFocus
              />
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={busy || note.trim().length < 3}
                onClick={async () => {
                  const ok = await onReview(post, "rejected", {
                    reviewNote: note,
                  });
                  if (ok) setDeclining(false);
                }}
                style={{
                  borderColor: "var(--label-red-fg)",
                  color: "var(--label-red-fg)",
                }}
              >
                Decline
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => {
                  setDeclining(false);
                  setNote("");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stroke pt-3">
            <label
              htmlFor={`status-${post.id}`}
              className="text-[12.5px] text-ink-2"
            >
              Publish as
            </label>
            <select
              id={`status-${post.id}`}
              className="input w-auto py-1.5 text-[12.5px]"
              value={status}
              onChange={(e) => setStatus(e.target.value as PostStatus)}
              disabled={busy}
            >
              {POST_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s].label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={busy}
              onClick={() => onReview(post, "approved", { status })}
            >
              {busy ? "Publishing…" : "Approve & publish"}
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={busy}
              onClick={() => setDeclining(true)}
            >
              Decline
            </button>
          </div>
        )
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stroke pt-3 text-[12.5px] text-ink-2">
          <span>
            {MODERATION_META[post.moderation].label}
            {post.reviewerName ? ` by ${post.reviewerName}` : ""}
            {post.reviewedAt ? ` ${relativeTime(post.reviewedAt)}` : ""}
          </span>
          <button
            type="button"
            className="btn-ghost btn-sm ml-auto"
            disabled={busy}
            onClick={() => onReview(post, "pending")}
            title="Takes it back off the public board and returns it to the queue"
          >
            {post.moderation === "approved" ? "Unpublish" : "Reopen"}
          </button>
          {post.moderation === "rejected" && (
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={busy}
              onClick={() => onReview(post, "approved", { status: post.status })}
            >
              Publish after all
            </button>
          )}
        </div>
      )}
    </article>
  );
}
