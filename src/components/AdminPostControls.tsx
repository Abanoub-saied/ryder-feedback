"use client";

import { useState } from "react";

import { useToast } from "./Toast";
import { useIdentity } from "@/lib/auth-context";
import {
  MODERATION_META,
  POST_STATUSES,
  STATUS_META,
  type Moderation,
  type Post,
} from "@/lib/types";

/**
 * Inline admin controls, shown on a ticket only when the *server* has
 * confirmed the admin claim (see /api/me). Every action here is a request to
 * an admin route that re-verifies the claim, so this component going astray
 * cannot grant anyone anything.
 */
export function AdminPostControls({ post }: { post: Post }) {
  const toast = useToast();
  const { authedFetch } = useIdentity();

  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(post.roadmapNote ?? "");
  const [eta, setEta] = useState(post.eta ?? "");
  const [statusNote, setStatusNote] = useState("");
  const [mergeTarget, setMergeTarget] = useState("");
  const [open, setOpen] = useState(false);
  const [declineNote, setDeclineNote] = useState("");
  const [declining, setDeclining] = useState(false);

  async function patch(body: Record<string, unknown>, successMessage: string) {
    setBusy(true);
    try {
      const res = await authedFetch(`/api/admin/posts/${post.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast(data.error ?? "That did not go through.", "error");
        return;
      }
      // The status note is labelled "the next status change" — it is a
      // one-shot, so spend it rather than silently reattaching the same text
      // to every later move.
      if (body.status !== undefined) setStatusNote("");
      toast(successMessage, "success");
    } catch {
      toast("Network error.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function merge() {
    const target = mergeTarget.trim();
    if (!target) return;
    setBusy(true);
    try {
      const res = await authedFetch(`/api/admin/posts/${post.id}`, {
        method: "POST",
        body: JSON.stringify({ action: "merge", targetId: target }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        votesTransferred?: number;
        duplicatesSkipped?: number;
      };
      if (!res.ok) {
        toast(data.error ?? "Merge failed.", "error");
        return;
      }
      toast(
        `Merged. ${data.votesTransferred} votes moved over, ${data.duplicatesSkipped} were already there.`,
        "success",
      );
      setMergeTarget("");
    } catch {
      toast("Network error.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="mt-6 rounded-[var(--radius-card)] border p-4"
      style={{
        borderColor: "var(--stroke-2)",
        background: "var(--surface)",
        borderStyle: "dashed",
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide" style={{ color: "var(--link)" }}>
          Admin
        </h2>
        <button
          type="button"
          className="text-[12.5px] text-[var(--ink-2)] underline decoration-dotted underline-offset-2"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? "Hide details" : "More options"}
        </button>
      </div>

      {/* Publication comes before pipeline position, and reads that way:
          an unapproved idea shows the approve/decline pair and nothing else,
          because moving a ticket to "Planned" while the public still cannot
          see it is a decision with no effect. The review queue at /admin is
          the same two actions in bulk; this is for when you arrived at the
          ticket first. */}
      {post.moderation !== "approved" ? (
        declining ? (
          <div className="mt-3">
            <label
              htmlFor="admin-decline"
              className="mb-1.5 block text-[12.5px] font-medium"
            >
              Why? The submitter sees this on their activity page.
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id="admin-decline"
                className="input min-w-[200px] flex-1"
                value={declineNote}
                onChange={(e) => setDeclineNote(e.target.value)}
                maxLength={300}
                autoFocus
              />
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={busy || declineNote.trim().length < 3}
                onClick={async () => {
                  await patch(
                    { moderation: "rejected", reviewNote: declineNote },
                    "Declined.",
                  );
                  setDeclining(false);
                  setDeclineNote("");
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
                onClick={() => setDeclining(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className="rounded-pill px-2 py-0.5 text-[11px] font-semibold"
              style={{
                background: MODERATION_META[post.moderation].bg,
                color: MODERATION_META[post.moderation].fg,
              }}
            >
              {MODERATION_META[post.moderation].label}
            </span>
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={busy}
              onClick={() =>
                patch(
                  { moderation: "approved", status: post.status },
                  "Published to the board.",
                )
              }
            >
              Approve & publish
            </button>
            {post.moderation === "pending" && (
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={busy}
                onClick={() => setDeclining(true)}
              >
                Decline
              </button>
            )}
          </div>
        )
      ) : null}

      <div
        className="mt-3 flex flex-wrap gap-1.5"
        style={
          post.moderation === "approved"
            ? undefined
            : { opacity: 0.5, pointerEvents: "none" }
        }
        aria-hidden={post.moderation !== "approved"}
      >
        {POST_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            disabled={busy || s === post.status}
            onClick={() => patch({ status: s, note: statusNote }, `Moved to ${STATUS_META[s].label}.`)}
            className="rounded-[var(--radius-pill)] border px-2.5 py-1.5 text-[12.5px] font-medium transition-colors disabled:opacity-45"
            style={
              s === post.status
                ? {
                    background: STATUS_META[s].bg,
                    borderColor: STATUS_META[s].accent,
                    color: STATUS_META[s].fg,
                  }
                : { borderColor: "var(--stroke)", color: "var(--ink-2)" }
            }
          >
            {STATUS_META[s].label}
          </button>
        ))}
        <button
          type="button"
          disabled={busy}
          onClick={() => patch({ pinned: !post.pinned }, post.pinned ? "Unpinned." : "Pinned to the top.")}
          className="btn-ghost btn-sm"
        >
          {post.pinned ? "Unpin" : "Pin"}
        </button>
      </div>

      {open && (
        <div className="mt-4 space-y-3 border-t border-[var(--stroke)] pt-4">
          <div>
            <label htmlFor="admin-status-note" className="mb-1 block text-[12.5px] font-medium">
              Note to attach to the next status change
            </label>
            <input
              id="admin-status-note"
              className="input"
              value={statusNote}
              onChange={(e) => setStatusNote(e.target.value)}
              maxLength={200}
              placeholder="e.g. Shipping with the 2.4 firmware"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
            <div>
              <label htmlFor="admin-note" className="mb-1 block text-[12.5px] font-medium">
                Roadmap note (shown publicly on the card)
              </label>
              <input
                id="admin-note"
                className="input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={200}
              />
            </div>
            <div>
              <label htmlFor="admin-eta" className="mb-1 block text-[12.5px] font-medium">
                Target
              </label>
              <input
                id="admin-eta"
                className="input"
                value={eta}
                onChange={(e) => setEta(e.target.value)}
                maxLength={40}
                placeholder="Q4 2026"
              />
            </div>
          </div>
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={busy}
            onClick={() => patch({ roadmapNote: note, eta }, "Saved.")}
          >
            Save note and target
          </button>

          <div className="border-t border-[var(--stroke)] pt-3">
            <label htmlFor="admin-merge" className="mb-1 block text-[12.5px] font-medium">
              Merge this into another ticket
            </label>
            <p className="mb-2 text-[12px] text-[var(--ink-2)]">
              Paste the target ticket id. Voters who have not already voted
              there are carried over; overlapping voters are not double
              counted.
            </p>
            <div className="flex gap-2">
              <input
                id="admin-merge"
                className="input font-mono text-[12.5px]"
                value={mergeTarget}
                onChange={(e) => setMergeTarget(e.target.value)}
                placeholder="target post id"
              />
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={busy || !mergeTarget.trim()}
                onClick={merge}
              >
                Merge
              </button>
            </div>
          </div>

          {post.moderation === "approved" && (
            <div className="border-t border-[var(--stroke)] pt-3">
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={busy}
                onClick={() =>
                  patch(
                    { moderation: "pending" as Moderation },
                    "Back in the review queue, off the public board.",
                  )
                }
              >
                Unpublish
              </button>
              <p className="mt-1.5 text-[12px] text-[var(--ink-2)]">
                Removes it from the board and returns it to the queue. Votes
                and comments are kept.
              </p>
            </div>
          )}

          <p className="pt-1 font-mono text-[11px] text-[var(--ink-2)]">
            id: {post.id}
          </p>
        </div>
      )}
    </section>
  );
}
