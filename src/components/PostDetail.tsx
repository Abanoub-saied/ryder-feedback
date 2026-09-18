"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { AdminPostControls } from "./AdminPostControls";
import { StatusBadge } from "./StatusBadge";
import { VoteButton } from "./VoteButton";
import { useToast } from "./Toast";
import { usePost } from "@/hooks/use-post";
import { useVotes } from "@/hooks/use-votes";
import { useIdentity } from "@/lib/auth-context";
import { relativeTime } from "@/lib/ranking";
import { MODERATION_META, STATUS_META, type Comment } from "@/lib/types";
import { LIMITS } from "@/lib/validate";

export function PostDetail({ postId }: { postId: string }) {
  const toast = useToast();
  const { post, comments, events, loading, missing } = usePost(postId);
  const votes = useVotes();
  const { isAdmin, name, setName, authedFetch } = useIdentity();

  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [sending, setSending] = useState(false);

  // Comments arrive flat and get grouped into one level of threading. Doing
  // it here rather than storing a tree keeps the write path a single doc.
  const threads = useMemo(() => {
    const roots = comments.filter((c) => !c.parentId);
    const byParent = new Map<string, Comment[]>();
    for (const c of comments) {
      if (!c.parentId) continue;
      const list = byParent.get(c.parentId) ?? [];
      list.push(c);
      byParent.set(c.parentId, list);
    }
    return roots.map((root) => ({ root, replies: byParent.get(root.id) ?? [] }));
  }, [comments]);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6" aria-busy="true">
        <div className="skeleton h-40" />
      </div>
    );
  }

  if (missing || !post) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
        <h1 className="display text-2xl leading-[0.95]">That idea is not here.</h1>
        <p className="mt-2 text-[14px] text-[var(--ink-2)]">
          It may have been merged into another ticket or removed.
        </p>
        <Link href="/" className="btn-primary mt-5">
          Back to the board
        </Link>
      </div>
    );
  }

  async function submitComment(e: React.FormEvent) {
    e.preventDefault();
    if (sending || !draft.trim()) return;
    setSending(true);
    try {
      const res = await authedFetch(`/api/posts/${postId}/comments`, {
        method: "POST",
        body: JSON.stringify({
          body: draft,
          name,
          parentId: replyTo?.id ?? null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast(data.error ?? "Could not post that comment.", "error");
        return;
      }
      setDraft("");
      setReplyTo(null);
    } catch {
      toast("Network error. Try again.", "error");
    } finally {
      setSending(false);
    }
  }

  async function vote() {
    const res = await votes.toggle(postId);
    if (!res.ok && res.error) toast(res.error, "error");
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-[13px] text-[var(--ink-2)] hover:text-[var(--ink)]"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M9.5 3.5 5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        All feedback
      </Link>

      {post.mergedInto && (
        <div
          className="mt-4 rounded-card p-3.5 text-[13px]"
          style={{ background: "var(--label-blue-bg)", color: "var(--label-blue-fg)" }}
        >
          This was merged into another ticket.{" "}
          <Link
            href={`/p/${post.mergedInto}`}
            className="font-medium underline decoration-dotted underline-offset-2"
          >
            Go there instead
          </Link>{" "}
          — your vote moved with it.
        </div>
      )}

      {/* Only two people can reach this page while an idea is in review — its
          author and an admin — so the banner tells whichever one it is what
          they are looking at, rather than letting a page that is invisible to
          everyone else render as though it were live. */}
      {post.moderation !== "approved" && (
        <div
          className="mt-4 rounded-card p-3.5 text-[13px] leading-relaxed"
          style={{
            background: MODERATION_META[post.moderation].bg,
            color: MODERATION_META[post.moderation].fg,
          }}
        >
          <p className="font-semibold">
            {MODERATION_META[post.moderation].label}
          </p>
          <p className="mt-0.5">{MODERATION_META[post.moderation].authorNote}</p>
          {post.reviewNote && (
            <p className="mt-1.5">
              <span className="font-semibold">
                {post.reviewerName ?? "The Ryder team"}:
              </span>{" "}
              {post.reviewNote}
            </p>
          )}
        </div>
      )}

      <article className="mt-4 flex gap-4">
        <VoteButton
          count={post.voteCount}
          voted={votes.hasVoted(post.id)}
          pending={votes.isPending(post.id)}
          onToggle={vote}
          title={post.title}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={post.status} size="md" />
            {post.eta && (
              <span
                className="rounded-pill px-2 py-0.5 text-[11px] font-semibold"
                style={{
                  background: "var(--label-blue-bg)",
                  color: "var(--label-blue-fg)",
                }}
              >
                {post.eta}
              </span>
            )}
            {post.tags.map((t) => (
              <span
                key={t}
                className="rounded-[var(--radius-pill)] bg-[var(--surface)] px-2 py-0.5 text-[11px] text-[var(--ink-2)]"
              >
                {t}
              </span>
            ))}
          </div>
          <h1 className="display mt-2 text-2xl leading-[0.95] sm:text-[28px]">
            {post.title}
          </h1>
          <p className="mt-1.5 text-[12.5px] text-[var(--ink-2)]">
            {post.authorName} · {relativeTime(post.createdAt)}
          </p>
          {post.body && (
            <div className="mt-3 whitespace-pre-wrap text-[14.5px] leading-relaxed text-[var(--ink)]">
              {post.body}
            </div>
          )}
          {post.roadmapNote && (
            <p
              className="mt-3 rounded-[var(--radius-card)] p-3 text-[13.5px] leading-relaxed"
              style={{
                background: "var(--label-blue-bg)",
                color: "var(--label-blue-fg)",
              }}
            >
              <span className="font-semibold">From the team: </span>
              {post.roadmapNote}
            </p>
          )}
        </div>
      </article>

      {isAdmin && <AdminPostControls post={post} />}

      {/* Status timeline */}
      {events.length > 1 && (
        <section className="mt-8">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--ink-2)]">
            History
          </h2>
          <ol className="mt-3 space-y-2.5">
            {events.map((ev) => (
              <li key={ev.id} className="flex gap-3 text-[13px]">
                <span
                  aria-hidden
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                  style={{
                    background: ev.to
                      ? STATUS_META[ev.to].accent
                      : "var(--stroke-2)",
                  }}
                />
                <div className="min-w-0">
                  <span className="text-[var(--ink)]">
                    {ev.type === "created" && "Posted"}
                    {ev.type === "status" && (
                      <>
                        Moved to{" "}
                        <span className="font-medium">
                          {ev.to ? STATUS_META[ev.to].label : "unknown"}
                        </span>
                      </>
                    )}
                    {ev.type === "approved" && "Published to the board"}
                    {ev.type === "rejected" && "Declined"}
                    {ev.type === "merged" && ev.message}
                    {ev.type === "note" && ev.message}
                  </span>
                  <span className="text-[var(--ink-2)]">
                    {" · "}
                    {ev.actorName} · {relativeTime(ev.createdAt)}
                  </span>
                  {(ev.type === "status" ||
                    ev.type === "approved" ||
                    ev.type === "rejected") &&
                    ev.message && (
                      <p className="mt-0.5 text-[var(--ink-2)]">{ev.message}</p>
                    )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Comments */}
      <section className="mt-8">
        <h2 className="text-[15px] font-semibold">
          {post.commentCount === 0
            ? "No comments yet"
            : `${post.commentCount} ${post.commentCount === 1 ? "comment" : "comments"}`}
        </h2>

        <ul className="mt-4 space-y-4">
          {threads.map(({ root, replies }) => (
            <li key={root.id}>
              <CommentRow comment={root} onReply={() => setReplyTo(root)} />
              {replies.length > 0 && (
                <ul className="ml-6 mt-3 space-y-3 border-l border-[var(--stroke)] pl-4">
                  {replies.map((r) => (
                    <li key={r.id}>
                      <CommentRow comment={r} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>

        <form onSubmit={submitComment} className="card mt-6 p-4">
          {replyTo && (
            <p className="mb-2 flex items-center gap-2 text-[12.5px] text-[var(--ink-2)]">
              Replying to <span className="font-medium">{replyTo.authorName}</span>
              <button
                type="button"
                className="underline decoration-dotted underline-offset-2"
                onClick={() => setReplyTo(null)}
              >
                cancel
              </button>
            </p>
          )}
          <label htmlFor="comment-body" className="sr-only">
            Add a comment
          </label>
          <textarea
            id="comment-body"
            className="input min-h-[80px] resize-y"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={LIMITS.commentMax}
            placeholder={
              isAdmin
                ? "Reply as the Ryder team…"
                : "Add context, a use case, or a +1 with detail…"
            }
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="sr-only" htmlFor="comment-name">
              Your name
            </label>
            <input
              id="comment-name"
              className="input max-w-[180px]"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={LIMITS.nameMax}
              placeholder="Your name"
            />
            <button
              type="submit"
              className="btn-primary ml-auto"
              disabled={sending || !draft.trim()}
            >
              {sending ? "Posting…" : "Comment"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function CommentRow({
  comment,
  onReply,
}: {
  comment: Comment;
  onReply?: () => void;
}) {
  return (
    <div
      className="rounded-[var(--radius-card)] p-3"
      style={{ background: "var(--surface)", border: "1px solid transparent" }}
    >
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="font-semibold text-[var(--ink)]">{comment.authorName}</span>
        {comment.isAdmin && (
          <span
            className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide"
            style={{ background: "var(--brand)", color: "#ffffff" }}
          >
            Ryder
          </span>
        )}
        <span className="text-[var(--ink-2)]">
          {relativeTime(comment.createdAt)}
        </span>
        {onReply && (
          <button
            type="button"
            onClick={onReply}
            className="ml-auto text-[12px] text-[var(--ink-2)] underline decoration-dotted underline-offset-2 hover:text-[var(--ink)]"
          >
            Reply
          </button>
        )}
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-[14px] leading-relaxed">
        {comment.body}
      </p>
    </div>
  );
}
