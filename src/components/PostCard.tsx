"use client";

import Link from "next/link";

import { StatusBadge } from "./StatusBadge";
import { VoteButton } from "./VoteButton";
import { relativeTime } from "@/lib/ranking";
import type { Board, Post } from "@/lib/types";

export function PostCard({
  post,
  board,
  rank,
  voted,
  pending,
  onVote,
}: {
  post: Post;
  board?: Board;
  /** Position in a demand-ordered list. Omitted when the order is by date. */
  rank?: number;
  voted: boolean;
  pending: boolean;
  onVote: () => void;
}) {
  return (
    <article
      className="card card-interactive animate-pop group relative flex gap-3 p-3.5 sm:gap-4 sm:p-4"
      style={
        post.pinned
          ? // A pinned ticket gets a brand rail rather than a louder card,
            // so the list keeps one visual rhythm.
            { boxShadow: "inset 3px 0 0 0 var(--brand)" }
          : undefined
      }
    >
      {/* Sits above the stretched card link so the vote button stays
          clickable while the rest of the card navigates. */}
      <div className="relative z-10 flex flex-col items-center gap-1.5">
        <VoteButton
          count={post.voteCount}
          voted={voted}
          pending={pending}
          onToggle={onVote}
          title={post.title}
        />
        {rank !== undefined && rank <= 3 && (
          <span
            className="numeric rounded-pill px-1.5 text-[10px] font-bold leading-4"
            style={{ background: "var(--surface-2)", color: "var(--ink-2)" }}
            title={`Ranked #${rank} right now`}
          >
            #{rank}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {post.pinned && (
            <span
              className="inline-flex items-center gap-1 text-[11px] font-semibold"
              style={{ color: "var(--link)" }}
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                <path d="M8 1l1.9 4.2 4.6.5-3.4 3.1.9 4.5L8 11.2 3.9 13.3l1-4.5L1.5 5.7l4.6-.5L8 1z" />
              </svg>
              Pinned
            </span>
          )}
          <StatusBadge status={post.status} />
          {board && (
            <span className="text-[11px] font-medium text-ink-2">{board.name}</span>
          )}
          {post.eta && (
            <span
              className="rounded-pill px-2 py-0.5 text-[11px] font-semibold"
              style={{ background: "var(--label-blue-bg)", color: "var(--label-blue-fg)" }}
            >
              {post.eta}
            </span>
          )}
        </div>

        <h3 className="mt-2 text-[15.5px] font-semibold leading-snug tracking-[-0.01em]">
          {/* The whole card is clickable via the stretched overlay, but the
              link itself carries the accessible name and the href. */}
          <Link
            href={`/p/${post.id}`}
            className="transition-colors group-hover:text-[var(--link)]"
          >
            {post.title}
            <span className="absolute inset-0" aria-hidden />
          </Link>
        </h3>

        {post.body && (
          <p className="mt-1 line-clamp-2 text-[13.5px] leading-relaxed text-ink-2">
            {post.body}
          </p>
        )}

        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-2">
          <span className="inline-flex items-center gap-1.5">
            <Avatar name={post.authorName} />
            {post.authorName}
          </span>
          <span aria-hidden>·</span>
          <time dateTime={new Date(post.createdAt).toISOString()}>
            {relativeTime(post.createdAt)}
          </time>
          {post.commentCount > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path
                    d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2v-7Z"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinejoin="round"
                  />
                </svg>
                {post.commentCount}
              </span>
            </>
          )}
        </div>
      </div>

      {/* A chevron that only resolves on hover: enough to say "this row goes
          somewhere" without adding a permanent piece of furniture. */}
      <svg
        aria-hidden
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        className="mt-1 shrink-0 self-start text-ink-3 opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:opacity-100"
      >
        <path
          d="M6 3.5 10.5 8 6 12.5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </article>
  );
}

/**
 * Initials chip. There are no uploaded avatars on this board, and a generic
 * silhouette would just be noise, so the name is the avatar.
 */
function Avatar({ name }: { name: string }) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "?";
  return (
    <span
      aria-hidden
      className="grid h-[18px] w-[18px] place-items-center rounded-full text-[9px] font-bold"
      style={{ background: "var(--surface-2)", color: "var(--ink-2)" }}
    >
      {initials}
    </span>
  );
}
