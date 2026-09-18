"use client";

import Link from "next/link";
import { useMemo } from "react";

import { StatusBadge } from "./StatusBadge";
import { VoteButton } from "./VoteButton";
import { useToast } from "./Toast";
import { useBoards } from "@/hooks/use-boards";
import { usePosts } from "@/hooks/use-posts";
import { useVotes } from "@/hooks/use-votes";
import { relativeTime } from "@/lib/ranking";
import { ROADMAP_STATUSES, STATUS_META, type Post } from "@/lib/types";

/**
 * The public roadmap.
 *
 * There is no separate roadmap data. A column is just every ticket whose
 * status an admin set to planned / in progress / shipped, ordered by votes.
 * That is the whole point: the roadmap cannot drift from the board, because
 * it *is* the board, grouped by one field.
 */
export function RoadmapView() {
  const toast = useToast();
  const { boards } = useBoards();
  // One live query for the three roadmap statuses, split client-side. Three
  // separate listeners would be three billed subscriptions for the same data.
  const { posts, loading, error } = usePosts({ sort: "top", max: 300 });
  const votes = useVotes();

  const boardsById = useMemo(
    () => new Map(boards.map((b) => [b.id, b])),
    [boards],
  );

  const columns = useMemo(() => {
    return ROADMAP_STATUSES.map((status) => ({
      status,
      items: posts
        .filter((p) => p.status === status)
        .sort((a, b) =>
          // Shipped reads best newest-first; upcoming work reads best by
          // demand, so the most wanted thing is at the top of the column.
          status === "shipped"
            ? b.updatedAt - a.updatedAt
            : b.voteCount - a.voteCount,
        ),
    }));
  }, [posts]);

  async function vote(postId: string) {
    const res = await votes.toggle(postId);
    if (!res.ok && res.error) toast(res.error, "error");
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6">
      <section className="animate-rise flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="max-w-xl">
          <h1 className="display text-[2.5rem] sm:text-[3.25rem]">Roadmap</h1>
          <p className="mt-4 max-w-prose text-[15px] leading-relaxed text-ink-2">
            Everything here started as a ticket on the{" "}
            <Link href="/" className="link">
              feedback board
            </Link>
            . Vote on anything to push it up its column.
          </p>
        </div>
      </section>

      {error && (
        <p
          role="alert"
          className="mt-6 rounded-card p-4 text-[13px]"
          style={{ background: "var(--label-red-bg)", color: "var(--label-red-fg)" }}
        >
          {error}
        </p>
      )}

      <div className="mt-9 grid gap-4 lg:grid-cols-3">
        {columns.map(({ status, items }, col) => {
          const meta = STATUS_META[status];
          return (
            <section
              key={status}
              className="animate-rise flex min-w-0 flex-col rounded-lg border border-stroke"
              style={{ animationDelay: `${col * 70}ms` }}
            >
              {/* A tinted cap per column reads as a group without needing
                  heavy borders on every card inside it. */}
              <div
                className="rounded-t-[19px] px-4 pb-3.5 pt-4"
                style={{ borderTop: `3px solid ${meta.accent}`, background: "var(--surface)" }}
              >
                <div className="flex items-center justify-between gap-2">
                  <StatusBadge status={status} size="md" />
                  <span className="numeric text-[12px] font-semibold text-ink-2">
                    {items.length}
                  </span>
                </div>
                <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">
                  {meta.description}
                </p>
              </div>

              <div className="thin-scroll flex flex-1 flex-col gap-2.5 p-3 lg:max-h-[68vh] lg:overflow-y-auto">
                {loading ? (
                  [0, 1].map((i) => <div key={i} className="skeleton h-[92px]" />)
                ) : items.length === 0 ? (
                  <p className="rounded-card border border-dashed border-stroke-2 p-6 text-center text-[13px] text-ink-2">
                    Nothing {meta.label.toLowerCase()} right now.
                  </p>
                ) : (
                  items.map((post) => (
                    <RoadmapCard
                      key={post.id}
                      post={post}
                      boardName={boardsById.get(post.boardId)?.name}
                      voted={votes.hasVoted(post.id)}
                      pending={votes.isPending(post.id)}
                      onVote={() => vote(post.id)}
                    />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function RoadmapCard({
  post,
  boardName,
  voted,
  pending,
  onVote,
}: {
  post: Post;
  boardName?: string;
  voted: boolean;
  pending: boolean;
  onVote: () => void;
}) {
  return (
    <article className="card card-interactive animate-pop relative flex gap-3 p-3" style={{ background: "var(--page)" }}>
      <div className="relative z-10">
        <VoteButton
          count={post.voteCount}
          voted={voted}
          pending={pending}
          onToggle={onVote}
          title={post.title}
          size="sm"
        />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-[14px] font-semibold leading-snug">
          <Link href={`/p/${post.id}`} className="hover:text-[var(--link)]">
            {post.title}
            <span className="absolute inset-0" aria-hidden />
          </Link>
        </h3>
        {post.roadmapNote && (
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">
            {post.roadmapNote}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-ink-2">
          {boardName && <span>{boardName}</span>}
          {post.eta && (
            <span
              className="rounded-pill px-1.5 py-0.5 font-semibold"
              style={{
                background: "var(--label-blue-bg)",
                color: "var(--label-blue-fg)",
              }}
            >
              {post.eta}
            </span>
          )}
          {post.status === "shipped" && (
            <span>shipped {relativeTime(post.updatedAt)}</span>
          )}
        </div>
      </div>
    </article>
  );
}
