"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { FilterMenu, type FilterOption } from "@/components/FilterMenu";
import { StatusBadge } from "@/components/StatusBadge";
import { ModerationBadge } from "@/components/ModerationBadge";
import { useToast } from "@/components/Toast";
import { useBoards } from "@/hooks/use-boards";
import { usePosts } from "@/hooks/use-posts";
import { useIdentity } from "@/lib/auth-context";
import { relativeTime } from "@/lib/ranking";
import {
  POST_STATUSES,
  STATUS_META,
  type Post,
  type PostStatus,
} from "@/lib/types";

type SortKey = "votes" | "new" | "comments";

/**
 * Every idea on the board, in one table, with status editable in place.
 *
 * This is the "after review" half of the admin portal: the review queue
 * decides what exists publicly, and this decides where each published thing
 * sits in the pipeline. Keeping them apart matters because they are used at
 * different rhythms — review is a daily inbox you empty, this is a weekly
 * planning pass — and merging them produced a single table where the
 * urgent rows were buried among hundreds of settled ones.
 *
 * Scope is "all", so merged and declined ideas are reachable too; without
 * that, a mistakenly merged ticket would be invisible to the only people who
 * could undo it.
 */
export function IdeasTable() {
  const toast = useToast();
  const { authedFetch } = useIdentity();
  const { boards } = useBoards();
  const { posts, loading, error } = usePosts({ sort: "top", max: 400, scope: "all" });

  const [boardId, setBoardId] = useState<string | null>(null);
  const [status, setStatus] = useState<PostStatus | null>(null);
  const [sort, setSort] = useState<SortKey>("votes");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const boardsById = useMemo(
    () => new Map(boards.map((b) => [b.id, b])),
    [boards],
  );

  // Only published ideas belong in a pipeline view — a pending idea has no
  // pipeline position yet, and showing it here would mean two screens
  // disagreeing about whether it is real.
  const published = useMemo(
    () => posts.filter((p) => p.moderation === "approved"),
    [posts],
  );

  const counts = useMemo(() => {
    const map = new Map<PostStatus, number>();
    for (const p of published) map.set(p.status, (map.get(p.status) ?? 0) + 1);
    return map;
  }, [published]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = published.filter(
      (p) =>
        (!boardId || p.boardId === boardId) &&
        (!status || p.status === status) &&
        (!term ||
          p.title.toLowerCase().includes(term) ||
          p.authorName.toLowerCase().includes(term)),
    );
    return [...filtered].sort((a, b) =>
      sort === "new"
        ? b.createdAt - a.createdAt
        : sort === "comments"
          ? b.commentCount - a.commentCount
          : b.voteCount - a.voteCount,
    );
  }, [published, boardId, status, search, sort]);

  async function setPostStatus(post: Post, next: PostStatus) {
    setBusyId(post.id);
    try {
      const res = await authedFetch(`/api/admin/posts/${post.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) toast(data.error ?? "That did not go through.", "error");
      else toast(`Moved to ${STATUS_META[next].label}.`, "success");
    } catch {
      toast("Network error.", "error");
    } finally {
      setBusyId(null);
    }
  }

  const boardOptions: FilterOption[] = [
    { id: null, label: "All boards" },
    ...boards.map((b) => ({ id: b.id, label: b.name })),
  ];

  const statusOptions: FilterOption[] = [
    { id: null, label: "Any status", count: published.length },
    ...POST_STATUSES.map((s) => ({
      id: s,
      label: STATUS_META[s].label,
      count: counts.get(s) ?? 0,
      accent: STATUS_META[s].accent,
    })),
  ];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-[18px] font-semibold">Published ideas</h2>
          <p className="mt-1 text-[13.5px] text-ink-2">
            Move anything through the pipeline. Roadmap notes, targets and
            merging duplicates live on each ticket page.
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <label className="relative min-w-[190px] flex-1 sm:max-w-xs">
          <span className="sr-only">Filter by title or author</span>
          <input
            className="input h-9 py-0"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by title or author"
          />
        </label>
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
        <div
          role="group"
          aria-label="Sort ideas"
          className="ml-auto flex h-9 rounded-pill border border-stroke p-0.5"
        >
          {(
            [
              { id: "votes", label: "Votes" },
              { id: "comments", label: "Comments" },
              { id: "new", label: "New" },
            ] as { id: SortKey; label: string }[]
          ).map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSort(s.id)}
              aria-pressed={sort === s.id}
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

      {error && (
        <p
          role="alert"
          className="mt-5 rounded-card p-4 text-[13px]"
          style={{ background: "var(--label-red-bg)", color: "var(--label-red-fg)" }}
        >
          {error}
        </p>
      )}

      <div className="card mt-4 overflow-x-auto">
        {loading ? (
          <div className="skeleton h-48 border-0" aria-busy="true" />
        ) : rows.length === 0 ? (
          <p className="p-10 text-center text-[13.5px] text-ink-2">
            Nothing matches those filters.
          </p>
        ) : (
          <table className="w-full min-w-[760px] text-left text-[13.5px]">
            <thead>
              <tr className="border-b border-stroke text-[12px] uppercase tracking-wide text-ink-2">
                <th className="px-4 py-2.5 font-medium">Idea</th>
                <th className="px-3 py-2.5 text-right font-medium">Votes</th>
                <th className="px-3 py-2.5 text-right font-medium">Comments</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Move to</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((post) => (
                <tr
                  key={post.id}
                  className="border-b border-stroke last:border-0 hover:bg-surface-hover"
                >
                  <td className="max-w-[340px] px-4 py-3">
                    <Link
                      href={`/p/${post.id}`}
                      className="font-medium hover:underline"
                    >
                      {post.title}
                    </Link>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-ink-2">
                      {boardsById.get(post.boardId)?.name ?? post.boardId} ·{" "}
                      {post.authorName} · {relativeTime(post.createdAt)}
                      {post.mergedInto && (
                        <span
                          className="rounded-pill px-1.5 py-0.5 text-[10.5px] font-semibold"
                          style={{
                            background: "var(--surface-2)",
                            color: "var(--ink-2)",
                          }}
                        >
                          merged
                        </span>
                      )}
                      {post.pinned && (
                        <span
                          className="rounded-pill px-1.5 py-0.5 text-[10.5px] font-semibold"
                          style={{
                            background: "var(--brand-tint)",
                            color: "var(--link)",
                          }}
                        >
                          pinned
                        </span>
                      )}
                      {!post.isPublic && !post.mergedInto && (
                        <ModerationBadge moderation={post.moderation} />
                      )}
                    </div>
                  </td>
                  <td className="numeric px-3 py-3 text-right font-semibold">
                    {post.voteCount}
                  </td>
                  <td className="numeric px-3 py-3 text-right text-ink-2">
                    {post.commentCount}
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge status={post.status} />
                  </td>
                  <td className="px-4 py-3">
                    <select
                      aria-label={`Change status of ${post.title}`}
                      className="input w-auto py-1.5 text-[12.5px]"
                      value={post.status}
                      disabled={busyId === post.id}
                      onChange={(e) =>
                        setPostStatus(post, e.target.value as PostStatus)
                      }
                    >
                      {POST_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_META[s].label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="mt-4 text-[12.5px] text-ink-2">
        {rows.length} of {published.length} published ideas.
      </p>
    </div>
  );
}
