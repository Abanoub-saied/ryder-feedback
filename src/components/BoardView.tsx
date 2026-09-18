"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FilterMenu, type FilterOption } from "./FilterMenu";
import { PostCard } from "./PostCard";
import { StatusBadge } from "./StatusBadge";
import { SubmitDialog } from "./SubmitDialog";
import { useToast } from "./Toast";
import { useBoards } from "@/hooks/use-boards";
import { usePosts } from "@/hooks/use-posts";
import { useVotes } from "@/hooks/use-votes";
import { useIdentity } from "@/lib/auth-context";
import {
  POST_STATUSES,
  STATUS_META,
  type PostStatus,
  type SortMode,
} from "@/lib/types";

const SORTS: { id: SortMode; label: string; hint: string }[] = [
  {
    id: "trending",
    label: "Trending",
    hint: "Votes weighted by how recent the post is",
  },
  { id: "top", label: "Top", hint: "Most votes, all time" },
  { id: "new", label: "New", hint: "Most recently posted" },
];

const SORT_IDS = new Set<string>(SORTS.map((s) => s.id));

export function BoardView() {
  const toast = useToast();
  const params = useSearchParams();
  const { error: authError } = useIdentity();
  const { boards, error: boardError } = useBoards();

  // Filters are seeded from the query string so a filtered board is a
  // shareable link, then written back with history.replaceState — which
  // updates the URL without asking the router to re-render the tree or
  // reset scroll.
  const [boardId, setBoardId] = useState<string | null>(
    () => params.get("board"),
  );
  const [status, setStatus] = useState<PostStatus | null>(() => {
    const raw = params.get("status");
    return POST_STATUSES.includes(raw as PostStatus) ? (raw as PostStatus) : null;
  });
  const [sort, setSort] = useState<SortMode>(() => {
    const raw = params.get("sort");
    return SORT_IDS.has(raw ?? "") ? (raw as SortMode) : "trending";
  });
  const [search, setSearch] = useState(() => params.get("q") ?? "");
  const [dialogOpen, setDialogOpen] = useState(() => params.get("new") === "1");

  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const next = new URLSearchParams();
    if (boardId) next.set("board", boardId);
    if (status) next.set("status", status);
    if (sort !== "trending") next.set("sort", sort);
    if (search.trim()) next.set("q", search.trim());
    const qs = next.toString();
    window.history.replaceState(null, "", qs ? `/?${qs}` : "/");
  }, [boardId, status, sort, search]);

  // `/` jumps to the filter box, the convention on every board-shaped
  // product. ⌘K is search, which is a different thing and lives in the
  // header — see the note on the toolbar below.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Status is filtered here rather than in the query. It costs one extra
  // client-side pass over a page of posts, and it buys accurate counts on
  // every status option — which is the difference between a filter you can
  // plan with and one you have to click through to learn anything.
  const { posts, loading, error } = usePosts({
    boardId,
    sort,
    search,
    max: 300,
  });
  const votes = useVotes();

  const boardsById = useMemo(
    () => new Map(boards.map((b) => [b.id, b])),
    [boards],
  );

  const counts = useMemo(() => {
    const map = new Map<PostStatus, number>();
    for (const p of posts) map.set(p.status, (map.get(p.status) ?? 0) + 1);
    return map;
  }, [posts]);

  const visible = useMemo(
    () => (status ? posts.filter((p) => p.status === status) : posts),
    [posts, status],
  );

  const vote = useCallback(
    async (postId: string) => {
      const res = await votes.toggle(postId);
      if (!res.ok && res.error) toast(res.error, "error");
    },
    [votes, toast],
  );

  const firstError = authError ?? boardError ?? error;
  const term = search.trim();
  const filtered = Boolean(boardId || status || term);
  const activeBoard = boardId ? boardsById.get(boardId) : undefined;

  const clearAll = useCallback(() => {
    setBoardId(null);
    setStatus(null);
    setSearch("");
  }, []);

  /* --- filter options ------------------------------------------------ */

  const boardOptions = useMemo<FilterOption[]>(
    () => [
      { id: null, label: "All boards" },
      ...boards.map((b) => ({
        id: b.id,
        label: b.name,
        // boards.postCount is the board's published total, which is the right
        // number *until* a keyword filter is on — then it would claim counts
        // the list below is not showing. The status counts are computed from
        // the filtered set and stay accurate either way, so the board counts
        // drop out rather than the two disagreeing.
        count: term ? undefined : b.postCount,
        hint: b.description,
      })),
    ],
    [boards, term],
  );

  const statusOptions = useMemo<FilterOption[]>(
    () => [
      { id: null, label: "Any status", count: posts.length },
      ...POST_STATUSES.map((s) => ({
        id: s,
        label: STATUS_META[s].label,
        count: counts.get(s) ?? 0,
        accent: STATUS_META[s].accent,
        hint: STATUS_META[s].description,
        disabled: (counts.get(s) ?? 0) === 0 && status !== s,
      })),
    ],
    [counts, posts.length, status],
  );

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6">
      {/* ---------------------------------------------------------------
          Hero
          --------------------------------------------------------------- */}
      <section className="animate-rise">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <div className="max-w-xl">
            <h1 className="display text-[2.25rem] sm:text-[3.25rem]">
              What should we{" "}
              {/* The line break is a typographic choice for the two-line
                  desktop lockup. On a phone the headline already wraps, so
                  forcing it there just makes three ragged lines. */}
              <br className="hidden sm:inline" />
              build next?
            </h1>
            <p className="mt-4 max-w-prose text-[15px] leading-relaxed text-ink-2">
              Post an idea or back one that is already here. The most wanted
              items move onto the{" "}
              <Link href="/roadmap" className="link">
                public roadmap
              </Link>
              .
            </p>
          </div>

          {/* One call to action, not two.
              There used to be a "See the roadmap" button sitting beside it,
              which made three routes to the same page within one screen —
              the header tab, this button, and the link in the sentence above.
              Repeating a destination does not make it easier to reach, it
              makes the primary action harder to find, so the nav tab keeps
              the navigation job and the sentence keeps the contextual one. */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-primary"
              onClick={() => setDialogOpen(true)}
              disabled={boards.length === 0}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M8 3v10M3 8h10"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                />
              </svg>
              Suggest an idea
              {/* Hidden on touch, where there is no key to press. */}
              <span
                className="kbd -mr-1 ml-1 hidden sm:inline-flex"
                style={{
                  background: "transparent",
                  borderColor: "currentColor",
                  color: "inherit",
                  opacity: 0.6,
                }}
              >
                N
              </span>
            </button>
          </div>
        </div>
      </section>

      {firstError && (
        <div
          role="alert"
          className="mt-8 rounded-card p-4 text-[13px]"
          style={{
            background: "var(--label-red-bg)",
            color: "var(--label-red-fg)",
          }}
        >
          <p className="font-semibold">Firebase is not answering yet.</p>
          <p className="mt-1 opacity-90">
            Most first-run failures are one of three things: env vars not set,
            security rules not deployed, or a composite index that Firestore
            wants you to create. The exact message is below, and Firebase
            usually includes a one-click fix link in it.
          </p>
          <pre className="mt-2 overflow-x-auto rounded-[10px] bg-page p-2.5 text-[11.5px] leading-relaxed text-ink">
            {firstError}
          </pre>
        </div>
      )}

      {/* ---------------------------------------------------------------
          Toolbar. Sticks under the header so the controls stay reachable
          however far down the list you are.

          This was three stacked rows: a chip per board, a sort group plus a
          search box, and a chip per status — around sixteen controls at
          equal visual weight, which is why nothing in it read as the
          important one. It is now one row: the thing you narrow *by* on the
          left, the thing you order *by* on the right, and everything
          currently applied restated underneath as removable pills.

          On the box being a *filter* and not a search. There were two search
          affordances on this page — this one and ⌘K in the header — which
          look identical and do different things. They are now told apart by
          label, icon and shortcut: the header searches the whole site and
          navigates to a result, this narrows the list in front of you and
          changes nothing else. One magnifier on the page, and it belongs to
          the one that searches.
          --------------------------------------------------------------- */}
      <div
        className="sticky top-16 z-30 -mx-4 mt-10 px-4 py-3 sm:-mx-6 sm:px-6"
        style={{
          background: "color-mix(in srgb, var(--page) 86%, transparent)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative order-1 min-w-[190px] flex-1 sm:max-w-sm">
            <span className="sr-only">Filter ideas by keyword</span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3"
            >
              <path
                d="M2 3.5h12L9.4 8.6v4.3l-2.8 1.4V8.6L2 3.5Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>
            <input
              ref={searchRef}
              className="input h-9 py-0 pl-10 pr-10"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter these ideas"
              type="text"
            />
            {search ? (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  searchRef.current?.focus();
                }}
                aria-label="Clear the keyword filter"
                className="absolute right-2.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-ink-2 hover:bg-surface-hover hover:text-ink"
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path
                    d="M4 4l8 8M12 4l-8 8"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            ) : (
              <span
                aria-hidden
                className="kbd pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 sm:inline-flex"
              >
                /
              </span>
            )}
          </label>

          <div className="order-3 flex items-center gap-2 sm:order-2">
            <FilterMenu
              label="Board"
              options={boardOptions}
              value={boardId}
              onChange={setBoardId}
            />
            <FilterMenu
              label="Status"
              options={statusOptions}
              value={status}
              onChange={(next) => setStatus(next as PostStatus | null)}
            />
          </div>

          <div
            role="group"
            aria-label="Sort ideas"
            className="order-2 ml-auto flex h-9 rounded-pill border border-stroke p-0.5 sm:order-3"
          >
            {SORTS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSort(s.id)}
                aria-pressed={sort === s.id}
                title={s.hint}
                className="rounded-pill px-3 text-[13px] font-semibold transition-colors"
                style={
                  sort === s.id
                    ? { background: "var(--surface-2)", color: "var(--ink)" }
                    : { color: "var(--ink-2)" }
                }
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Applied filters, restated as individually removable pills.
            A menu trigger tells you one facet is set; this tells you the
            whole state at once and lets you undo one part of it without
            reopening anything. It only exists when something is applied, so
            the toolbar is a single line at rest. */}
        {filtered && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] font-medium text-ink-3">Filtered by</span>
            {activeBoard && (
              <FilterPill
                label={activeBoard.name}
                onRemove={() => setBoardId(null)}
              />
            )}
            {status && (
              <FilterPill
                label={STATUS_META[status].label}
                accent={STATUS_META[status].accent}
                onRemove={() => setStatus(null)}
              />
            )}
            {term && (
              <FilterPill
                label={`“${term}”`}
                onRemove={() => setSearch("")}
              />
            )}
            <button
              type="button"
              onClick={clearAll}
              className="ml-1 text-[12px] font-semibold text-ink-2 underline decoration-dotted underline-offset-2 hover:text-ink"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------------
          Results
          --------------------------------------------------------------- */}
      <div className="mt-4">
        {loading ? (
          <ul className="space-y-2.5" aria-busy="true" aria-label="Loading ideas">
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} className="skeleton h-[108px]" />
            ))}
          </ul>
        ) : visible.length === 0 ? (
          <EmptyState
            search={search}
            status={status}
            onClear={clearAll}
            onNew={() => setDialogOpen(true)}
            canPost={boards.length > 0}
          />
        ) : (
          <>
            <ul className="space-y-2.5">
              {visible.map((post, i) => (
                <li key={post.id}>
                  <PostCard
                    post={post}
                    board={boardsById.get(post.boardId)}
                    // A rank number only means something when the list is
                    // ordered by demand, so "New" does not get one.
                    rank={sort === "new" || post.pinned ? undefined : i + 1}
                    voted={votes.hasVoted(post.id)}
                    pending={votes.isPending(post.id)}
                    onVote={() => vote(post.id)}
                  />
                </li>
              ))}
            </ul>
            <p className="mt-6 flex items-center justify-center gap-2 text-[12.5px] text-ink-2">
              {visible.length} {visible.length === 1 ? "idea" : "ideas"}
              {status && (
                <>
                  <span aria-hidden>·</span>
                  <StatusBadge status={status} size="sm" />
                </>
              )}
              {sort === "trending" && !status && (
                <>
                  <span aria-hidden>·</span> ranked by votes and recency
                </>
              )}
            </p>
          </>
        )}
      </div>

      <SubmitDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        boards={boards}
        defaultBoardId={boardId}
        existing={posts}
      />
    </div>
  );
}

function FilterPill({
  label,
  accent,
  onRemove,
}: {
  label: string;
  accent?: string;
  onRemove: () => void;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-pill py-1 pl-2.5 pr-1 text-[12px] font-semibold"
      style={{ background: "var(--brand-tint)", color: "var(--link)" }}
    >
      {accent && (
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: accent }}
        />
      )}
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove the ${label} filter`}
        className="grid h-4 w-4 place-items-center rounded-full transition-colors hover:bg-[var(--brand)] hover:text-white"
      >
        <svg width="8" height="8" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </button>
    </span>
  );
}

function EmptyState({
  search,
  status,
  onClear,
  onNew,
  canPost,
}: {
  search: string;
  status: PostStatus | null;
  onClear: () => void;
  onNew: () => void;
  canPost: boolean;
}) {
  const narrowed = Boolean(search.trim() || status);
  return (
    <div className="grad-surface rounded-lg border border-stroke px-6 py-16 text-center">
      <div
        className="mx-auto grid h-12 w-12 place-items-center rounded-full"
        style={{ background: "var(--page)", color: "var(--ink-2)" }}
        aria-hidden
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.6" />
          <path d="m13.2 13.2 3.3 3.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </div>
      <p className="mt-4 text-[16px] font-semibold">
        {narrowed ? "Nothing matches those filters." : "No ideas here yet."}
      </p>
      <p className="mx-auto mt-1.5 max-w-sm text-[13.5px] leading-relaxed text-ink-2">
        {narrowed
          ? "Try a shorter phrase or a wider status — or post it as a new idea."
          : "Be the first to suggest something. It takes about twenty seconds."}
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {narrowed && (
          <button type="button" className="btn-ghost" onClick={onClear}>
            Clear filters
          </button>
        )}
        <button
          type="button"
          className="btn-primary"
          onClick={onNew}
          disabled={!canPost}
        >
          Suggest an idea
        </button>
      </div>
    </div>
  );
}
