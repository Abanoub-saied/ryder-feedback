"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { ModerationBadge } from "./ModerationBadge";
import { StatusBadge } from "./StatusBadge";
import { useBoards } from "@/hooks/use-boards";
import { useMyActivity, type ActivityItem } from "@/hooks/use-my-activity";
import { useIdentity } from "@/lib/auth-context";
import { relativeTime } from "@/lib/ranking";
import { MODERATION_META, STATUS_META, type Post } from "@/lib/types";

type Tab = "ideas" | "votes" | "comments" | "activity";

const TABS: { id: Tab; label: string }[] = [
  { id: "ideas", label: "Ideas" },
  { id: "votes", label: "Votes" },
  { id: "comments", label: "Comments" },
  { id: "activity", label: "Activity" },
];

/**
 * Everything you have done on the board, in one place.
 *
 * This page exists because a feedback board without it asks people to
 * contribute and then gives them nowhere to see what happened next. The
 * specific thing it fixes: with admin approval in front of the public board,
 * a submitted idea does not appear anywhere the submitter can find it until
 * a human says yes. That is indistinguishable from the idea being lost. The
 * Ideas tab below is the only surface where a pending — or rejected —
 * submission is visible, along with the reviewer's note, and the security
 * rules grant that read precisely because the query is scoped to your own
 * authorId.
 *
 * Identity here is the anonymous Firebase uid every visitor already gets, so
 * this works without anyone signing up. The trade is that it is per-browser:
 * clearing site data or switching devices starts a new identity, which the
 * footnote at the bottom says out loud rather than letting someone discover
 * it by losing their history.
 */
export function MeView() {
  const { uid, name, ready } = useIdentity();
  const { boards } = useBoards();
  const { ideas, comments, votedPosts, activity, loading, error } =
    useMyActivity();
  const [tab, setTab] = useState<Tab>("ideas");

  const boardsById = useMemo(
    () => new Map(boards.map((b) => [b.id, b])),
    [boards],
  );

  const pendingCount = ideas.filter((i) => i.moderation === "pending").length;

  const counts: Record<Tab, number> = {
    ideas: ideas.length,
    votes: votedPosts.length,
    comments: comments.length,
    activity: activity.length,
  };

  if (!ready) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6" aria-busy="true">
        <div className="skeleton h-32" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 pb-16 pt-8 sm:px-6">
      <section className="animate-rise">
        <h1 className="display text-[2.25rem] sm:text-[2.75rem]">
          Your activity
        </h1>
        <p className="mt-3 max-w-prose text-[15px] leading-relaxed text-ink-2">
          {name ? `Posting as ${name}. ` : ""}
          Everything you have suggested, backed and replied to.
          {pendingCount > 0 && (
            <>
              {" "}
              <span style={{ color: "var(--label-yellow-fg)" }}>
                {pendingCount} {pendingCount === 1 ? "idea is" : "ideas are"}{" "}
                waiting on review.
              </span>
            </>
          )}
        </p>

        <dl className="mt-7 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Stat label="Ideas posted" value={ideas.length} />
          <Stat label="Published" value={ideas.filter((i) => i.moderation === "approved").length} accent="var(--earn-high)" />
          <Stat label="Votes cast" value={votedPosts.length} accent="var(--brand)" />
          <Stat label="Comments" value={comments.length} />
        </dl>
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

      <div
        role="tablist"
        aria-label="Your activity"
        className="thin-scroll mt-8 flex gap-1.5 overflow-x-auto border-b border-stroke pb-px"
      >
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={active}
              aria-controls={`panel-${t.id}`}
              id={`tab-${t.id}`}
              onClick={() => setTab(t.id)}
              className="relative whitespace-nowrap px-3 pb-2.5 pt-1 text-[13.5px] font-semibold transition-colors"
              style={{ color: active ? "var(--ink)" : "var(--ink-2)" }}
            >
              {t.label}
              <span className="numeric ml-1.5 text-[12px] text-ink-3">
                {counts[t.id]}
              </span>
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-x-2 -bottom-px h-[2px] rounded-pill"
                  style={{ background: "var(--ink)" }}
                />
              )}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        className="mt-5"
      >
        {loading ? (
          <div className="space-y-2.5" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-[88px]" />
            ))}
          </div>
        ) : !uid ? (
          <Empty
            title="Signing you in."
            body="Every visitor gets an anonymous account automatically. One moment."
          />
        ) : tab === "ideas" ? (
          ideas.length === 0 ? (
            <Empty
              title="You have not posted an idea yet."
              body="Ideas you submit show up here, including while they are waiting on review."
              action={{ href: "/?new=1", label: "Suggest an idea" }}
            />
          ) : (
            <ul className="space-y-2.5">
              {ideas.map((post) => (
                <li key={post.id}>
                  <IdeaRow
                    post={post}
                    boardName={boardsById.get(post.boardId)?.name}
                  />
                </li>
              ))}
            </ul>
          )
        ) : tab === "votes" ? (
          votedPosts.length === 0 ? (
            <Empty
              title="No votes yet."
              body="Backing an idea is the fastest way to change what gets built next."
              action={{ href: "/", label: "Browse the board" }}
            />
          ) : (
            <ul className="space-y-2.5">
              {votedPosts.map((post) => (
                <li key={post.id}>
                  <VoteRow
                    post={post}
                    boardName={boardsById.get(post.boardId)?.name}
                  />
                </li>
              ))}
            </ul>
          )
        ) : tab === "comments" ? (
          comments.length === 0 ? (
            <Empty
              title="You have not commented yet."
              body="Use cases and details on an existing idea carry real weight in review."
              action={{ href: "/", label: "Browse the board" }}
            />
          ) : (
            <ul className="space-y-2.5">
              {comments.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/p/${c.postId}`}
                    className="card card-interactive block p-3.5"
                  >
                    <p className="line-clamp-3 text-[13.5px] leading-relaxed text-ink">
                      {c.body}
                    </p>
                    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-2">
                      <time dateTime={new Date(c.createdAt).toISOString()}>
                        {relativeTime(c.createdAt)}
                      </time>
                      {c.parentId && (
                        <>
                          <span aria-hidden>·</span>
                          <span>in reply to another comment</span>
                        </>
                      )}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : activity.length === 0 ? (
          <Empty
            title="Nothing here yet."
            body="Post an idea or leave a comment and it will show up on this timeline."
            action={{ href: "/?new=1", label: "Suggest an idea" }}
          />
        ) : (
          <ol className="relative space-y-0 pl-1">
            {activity.map((item, i) => (
              <ActivityRow
                key={`${item.kind}-${i}`}
                item={item}
                last={i === activity.length - 1}
              />
            ))}
          </ol>
        )}
      </div>

      <p className="mt-10 border-t border-stroke pt-5 text-[12px] leading-relaxed text-ink-3">
        This page is tied to the anonymous account this browser was given, so
        no sign-up is needed — but clearing site data or switching device
        starts a fresh one, and this history will not follow you across.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------
   Rows
   ------------------------------------------------------------------ */

function IdeaRow({ post, boardName }: { post: Post; boardName?: string }) {
  const meta = MODERATION_META[post.moderation];
  const published = post.moderation === "approved";

  return (
    <article
      className="card p-3.5"
      // A pending or rejected idea carries a coloured rail, so the tab reads
      // as a status list at a glance rather than a list you have to parse.
      style={
        published ? undefined : { boxShadow: `inset 3px 0 0 0 ${meta.accent}` }
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <ModerationBadge moderation={post.moderation} />
        {published && <StatusBadge status={post.status} />}
        {boardName && (
          <span className="text-[11px] font-medium text-ink-2">{boardName}</span>
        )}
      </div>

      <h3 className="mt-2 text-[15px] font-semibold leading-snug">
        {/* A pending idea has no public page worth linking to — the detail
            view would render it, but only for this person, and a link that
            works for you and 404s for everyone you send it to is worse than
            no link. */}
        {published ? (
          <Link href={`/p/${post.id}`} className="hover:text-[var(--link)]">
            {post.title}
          </Link>
        ) : (
          post.title
        )}
      </h3>

      {post.reviewNote && (
        <p
          className="mt-2 rounded-[10px] px-3 py-2 text-[12.5px] leading-relaxed"
          style={{ background: meta.bg, color: meta.fg }}
        >
          <span className="font-semibold">
            {post.reviewerName ?? "The Ryder team"}:
          </span>{" "}
          {post.reviewNote}
        </p>
      )}

      <p className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-ink-2">
        <time dateTime={new Date(post.createdAt).toISOString()}>
          posted {relativeTime(post.createdAt)}
        </time>
        {published && (
          <>
            <span aria-hidden>·</span>
            <span className="numeric">
              {post.voteCount} {post.voteCount === 1 ? "vote" : "votes"}
            </span>
            <span aria-hidden>·</span>
            <span className="numeric">
              {post.commentCount}{" "}
              {post.commentCount === 1 ? "comment" : "comments"}
            </span>
          </>
        )}
        {!published && (
          <>
            <span aria-hidden>·</span>
            <span>{meta.authorNote}</span>
          </>
        )}
      </p>
    </article>
  );
}

function VoteRow({ post, boardName }: { post: Post; boardName?: string }) {
  return (
    <Link
      href={`/p/${post.id}`}
      className="card card-interactive flex items-center gap-3 p-3.5"
    >
      <span
        className="numeric grid h-9 w-11 shrink-0 place-items-center rounded-[10px] text-[13px] font-bold"
        style={{ background: "var(--brand-tint)", color: "var(--link)" }}
      >
        {post.voteCount}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-semibold">
          {post.title}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
          <StatusBadge status={post.status} />
          {boardName}
        </span>
      </span>
    </Link>
  );
}

function ActivityRow({ item, last }: { item: ActivityItem; last: boolean }) {
  const { dot, text, href } = describe(item);

  return (
    <li className="relative flex gap-3 pb-5">
      {!last && (
        <span
          aria-hidden
          className="absolute left-[5px] top-4 h-full w-px"
          style={{ background: "var(--stroke)" }}
        />
      )}
      <span
        aria-hidden
        className="relative z-10 mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-4"
        style={{ background: dot, ["--tw-ring-color" as string]: "var(--page)" }}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] leading-relaxed">
          {text}{" "}
          {href && (
            <Link href={href} className="link font-medium">
              {item.kind === "commented"
                ? (item.post?.title ?? "the idea")
                : item.post?.title}
            </Link>
          )}
        </p>
        <time
          dateTime={new Date(item.at).toISOString()}
          className="text-[11.5px] text-ink-3"
        >
          {relativeTime(item.at)}
        </time>
      </div>
    </li>
  );
}

function describe(item: ActivityItem): {
  dot: string;
  text: string;
  href: string | null;
} {
  switch (item.kind) {
    case "submitted":
      return {
        dot: "var(--stroke-2)",
        text: "You suggested",
        href: item.post.moderation === "approved" ? `/p/${item.post.id}` : null,
      };
    case "reviewed":
      return item.post.moderation === "approved"
        ? {
            dot: "var(--earn-high)",
            text: "Published to the board:",
            href: `/p/${item.post.id}`,
          }
        : {
            dot: "var(--label-red-fg)",
            text: "Not published:",
            href: null,
          };
    case "status":
      return {
        dot: STATUS_META[item.post.status].accent,
        text: `Moved to ${STATUS_META[item.post.status].label}:`,
        href: `/p/${item.post.id}`,
      };
    case "voted":
      return {
        dot: "var(--brand)",
        text: "You backed",
        href: `/p/${item.post.id}`,
      };
    case "commented":
      return {
        dot: "var(--link)",
        text: "You commented on",
        href: item.comment.postId ? `/p/${item.comment.postId}` : null,
      };
  }
}

/* ------------------------------------------------------------------
   Bits
   ------------------------------------------------------------------ */

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <div className="card px-4 py-3.5">
      <dt className="flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
        {accent && (
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: accent }}
          />
        )}
        {label}
      </dt>
      <dd className="numeric mt-1 text-[26px] font-semibold leading-none tracking-tight">
        {value}
      </dd>
    </div>
  );
}

function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="grad-surface rounded-lg border border-stroke px-6 py-14 text-center">
      <p className="text-[15.5px] font-semibold">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-[13.5px] leading-relaxed text-ink-2">
        {body}
      </p>
      {action && (
        <Link href={action.href} className="btn-primary mt-5">
          {action.label}
        </Link>
      )}
    </div>
  );
}
