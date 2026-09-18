"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useIdentity } from "@/lib/auth-context";
import { useToast } from "./Toast";
import { LIMITS } from "@/lib/validate";
import type { Board, Post } from "@/lib/types";

/**
 * Submit-an-idea dialog.
 *
 * Two details that matter more than they look:
 *
 *  - Before submitting, it surfaces existing posts matching what the user is
 *    typing. Duplicate suggestions are the single biggest quality problem on
 *    a public board, and catching them here is far cheaper than merging them
 *    later.
 *  - Email is optional and clearly labelled as private. It goes to
 *    users/{uid}, which the public board cannot read.
 */
export function SubmitDialog({
  open,
  onClose,
  boards,
  defaultBoardId,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  boards: Board[];
  defaultBoardId?: string | null;
  existing: Post[];
}) {
  const router = useRouter();
  const toast = useToast();
  const { name, setName, authedFetch } = useIdentity();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [email, setEmail] = useState("");
  const [boardId, setBoardId] = useState(defaultBoardId ?? boards[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset once per opening, not on every `boards` snapshot. useBoards emits a
  // new array whenever any board doc changes — postCount ticking up because
  // somebody else posted, for instance — and re-running this on that would
  // throw away the board the user had picked while they were still typing.
  const initialized = useRef(false);
  useEffect(() => {
    if (!open) {
      initialized.current = false;
      return;
    }
    if (initialized.current) return;
    initialized.current = true;
    setBoardId(defaultBoardId ?? boards[0]?.id ?? "");
    setError(null);
  }, [open, defaultBoardId, boards]);

  // Focus after the paint so the dialog has laid out.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => firstFieldRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open]);

  // Escape to close, and keep Tab inside the dialog while it is open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);

  const term = title.trim().toLowerCase();
  const similar =
    term.length >= 4
      ? existing
          .filter((p) => {
            const t = p.title.toLowerCase();
            if (t.includes(term) || term.includes(t)) return true;
            // Loose word overlap so "add xrp support" finds "XRP support".
            const words = term.split(/\s+/).filter((w) => w.length > 3);
            return words.length > 0 && words.every((w) => t.includes(w));
          })
          .slice(0, 3)
      : [];

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await authedFetch("/api/posts", {
        method: "POST",
        body: JSON.stringify({ title, body, boardId, name, email }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        id?: string;
        error?: string;
      };

      if (!res.ok) {
        setError(data.error ?? "Could not post that. Try again.");
        return;
      }

      // Sending them to the ticket would be sending them to a page only they
      // can see, which reads as "posted and live" when it is neither. /me is
      // where a pending idea legitimately lives, and where the reviewer's
      // answer will appear.
      toast("Thanks — it is in the review queue now.", "success");
      setTitle("");
      setBody("");
      onClose();
      router.push("/me");
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      style={{ background: "var(--sheet-overlay)" }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="popup animate-pop max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-b-none p-5 sm:rounded-[var(--radius-lg)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-base font-semibold">
              Suggest an idea
            </h2>
            <p className="mt-0.5 text-[13px] text-[var(--ink-2)]">
              One idea per post. It gets your vote automatically, and goes on
              the public board once a Ryder admin approves it.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 grid h-8 w-8 place-items-center rounded-full text-[var(--ink-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <form onSubmit={submit} className="mt-4 space-y-3.5">
          <div>
            <label htmlFor="idea-title" className="mb-1.5 block text-[13px] font-medium">
              Title
            </label>
            <input
              ref={firstFieldRef}
              id="idea-title"
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={LIMITS.titleMax}
              placeholder="Short and specific, e.g. Face ID unlock for the app"
              required
            />
          </div>

          {similar.length > 0 && (
            <div
              className="rounded-[var(--radius-card)] border p-3 text-[13px]"
              style={{
                borderColor: "transparent",
                background: "var(--label-blue-bg)",
                color: "var(--label-blue-fg)",
              }}
            >
              <p className="font-medium">Already suggested?</p>
              <p className="mt-0.5 text-[var(--ink-2)]">
                Voting on an existing post counts for more than a duplicate.
              </p>
              <ul className="mt-2 space-y-1">
                {similar.map((p) => (
                  <li key={p.id}>
                    <a
                      href={`/p/${p.id}`}
                      className="font-medium underline decoration-dotted underline-offset-2"
                    >
                      {p.title}
                    </a>
                    <span className="text-[var(--ink-2)]">
                      {" "}
                      · {p.voteCount} {p.voteCount === 1 ? "vote" : "votes"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <label htmlFor="idea-body" className="mb-1.5 block text-[13px] font-medium">
              Details{" "}
              <span className="font-normal text-[var(--ink-2)]">(optional)</span>
            </label>
            <textarea
              id="idea-body"
              className="input min-h-[96px] resize-y"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={LIMITS.bodyMax}
              placeholder="What are you trying to do, and what gets in the way today?"
            />
          </div>

          <div className="grid gap-3.5 sm:grid-cols-2">
            <div>
              <label htmlFor="idea-board" className="mb-1.5 block text-[13px] font-medium">
                Board
              </label>
              <select
                id="idea-board"
                className="input"
                value={boardId}
                onChange={(e) => setBoardId(e.target.value)}
              >
                {boards.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="idea-name" className="mb-1.5 block text-[13px] font-medium">
                Your name
              </label>
              <input
                id="idea-name"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={LIMITS.nameMax}
                placeholder="Anonymous"
              />
            </div>
          </div>

          <div>
            <label htmlFor="idea-email" className="mb-1.5 block text-[13px] font-medium">
              Email{" "}
              <span className="font-normal text-[var(--ink-2)]">
                (optional, never shown publicly)
              </span>
            </label>
            <input
              id="idea-email"
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="So we can tell you when this ships"
            />
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-[var(--radius-card)] px-3 py-2 text-[13px]"
              style={{
                background: "var(--label-red-bg)",
                color: "var(--label-red-fg)",
              }}
            >
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={submitting || title.trim().length < LIMITS.titleMin}
            >
              {submitting ? "Posting…" : "Post idea"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
