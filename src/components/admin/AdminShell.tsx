"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { usePosts } from "@/hooks/use-posts";
import { ADMIN_DOMAIN } from "@/lib/access";
import { signInWithWorkspace } from "@/lib/firebase/client";
import { useIdentity } from "@/lib/auth-context";

const SECTIONS = [
  {
    href: "/admin",
    label: "Review",
    hint: "Approve or decline what came in",
  },
  {
    href: "/admin/ideas",
    label: "Ideas",
    hint: "Everything published, and its status",
  },
  {
    href: "/admin/analytics",
    label: "Analytics",
    hint: "Is the board producing validated demand",
  },
];

/**
 * The admin portal's frame: access gate, sub-navigation, and the pending
 * badge that every section can see.
 *
 * On why this is a section of the same app rather than a second dashboard
 * deployed on its own. The obvious pull is towards a separate build — it
 * *sounds* cleaner — and it costs more than it returns here. A second app
 * needs its own auth wiring, its own copy of the domain types, its own
 * Firestore client and its own deploy, and the two drift: the day someone
 * adds a status, the public board renders it and the admin dashboard shows
 * a blank chip. Everything that actually makes an admin area separate —
 * a distinct URL space, its own navigation, its own layout, noindex, and an
 * access gate enforced server-side — is achieved here with a route group and
 * a layout, while types, security rules and the vote/moderation logic stay
 * single-sourced.
 *
 * What stops it leaking is not this component. Every admin route handler
 * calls requireAdmin(), and the Firestore rules gate the pending queue on
 * the admin claim, so a non-admin who renders this UI gets a page of
 * permission errors rather than other people's unpublished submissions. The
 * gate below exists to be *honest*, not to be the defence.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isAdmin, ready } = useIdentity();

  if (!ready) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6" aria-busy="true">
        <div className="skeleton h-32" />
      </div>
    );
  }

  if (!isAdmin) return <AccessGate />;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex items-baseline gap-3">
          <h1 className="display text-[1.75rem] leading-none sm:text-[2rem]">
            Admin
          </h1>
          <span
            className="rounded-pill px-2 py-0.5 text-[11px] font-semibold"
            style={{ background: "var(--brand-tint)", color: "var(--link)" }}
          >
            not public
          </span>
        </div>
        <Link href="/" className="btn-ghost btn-sm">
          View the public board
        </Link>
      </div>

      <nav
        aria-label="Admin sections"
        className="thin-scroll mt-5 flex gap-1 overflow-x-auto border-b border-stroke pb-px"
      >
        {SECTIONS.map((s) => {
          // Exact match for /admin so the review tab does not stay lit while
          // you are three levels into analytics.
          const active =
            s.href === "/admin" ? pathname === "/admin" : pathname.startsWith(s.href);
          return (
            <Link
              key={s.href}
              href={s.href}
              title={s.hint}
              aria-current={active ? "page" : undefined}
              className="relative whitespace-nowrap px-3 pb-2.5 pt-1 text-[13.5px] font-semibold transition-colors"
              style={{ color: active ? "var(--ink)" : "var(--ink-2)" }}
            >
              {s.label}
              {s.href === "/admin" && <PendingBadge />}
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-x-2 -bottom-px h-[2px] rounded-pill"
                  style={{ background: "var(--ink)" }}
                />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mt-6">{children}</div>
    </div>
  );
}

/**
 * What a non-admin sees, and the only way in.
 *
 * One door: a verified Google account on the company domain - see
 * src/lib/access.ts. There is no fallback for anyone else, deliberately.
 * Nothing here decides access either; the button starts a Google sign-in and
 * then asks the server what it makes of the resulting token. A visitor who
 * forced this component to render would get a portal full of permission
 * errors, because every admin route calls requireAdmin() and the Firestore
 * rules restate the same check.
 *
 * Signing in links Google to the anonymous uid already in this browser
 * rather than replacing it, so an admin keeps the votes and submissions they
 * made before they were one.
 */
function AccessGate() {
  const { refresh } = useIdentity();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setProblem(null);
    try {
      await signInWithWorkspace();
      // On success the provider flips isAdmin and this gate unmounts. If it
      // does not, the Google account is real but off-domain, and saying so
      // is more use than leaving the same screen up unexplained.
      if (!(await refresh())) {
        setProblem(
          `That account is not on @${ADMIN_DOMAIN}, so it does not have admin access.`,
        );
      }
    } catch (err) {
      setProblem(signInProblem((err as { code?: string }).code));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-20 text-center sm:px-6">
      <h1 className="display text-2xl leading-[0.95]">Admins only</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
        The admin portal is for{" "}
        <span className="font-semibold text-ink">@{ADMIN_DOMAIN}</span> accounts.
        Signing in keeps everything you have already posted and voted on.
      </p>

      <div className="mt-6 flex flex-col items-center gap-2">
        <button
          type="button"
          className="btn-primary btn-lg"
          onClick={signIn}
          disabled={busy}
        >
          {busy ? "Opening Google..." : `Sign in with @${ADMIN_DOMAIN}`}
        </button>
        <Link href="/" className="btn-ghost btn-sm">
          Back to the board
        </Link>
      </div>

      {problem && (
        <p
          className="mt-4 text-[13px] leading-relaxed"
          style={{ color: "var(--label-red-fg)" }}
        >
          {problem}
        </p>
      )}
    </div>
  );
}

/**
 * Turns a Firebase auth error code into something the person in front of it
 * can act on. The two setup failures are called out by name because they are
 * what a first deploy hits, and both look identical from the browser: a
 * popup that opens and closes with nothing to show for it.
 */
function signInProblem(code: string | undefined): string | null {
  switch (code) {
    // They changed their mind. Not a problem, and saying so is noise.
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
    case "auth/user-cancelled":
      return null;
    case "auth/popup-blocked":
      return "Your browser blocked the sign-in popup. Allow popups for this site, then try again.";
    case "auth/operation-not-allowed":
      return "Google sign-in is not enabled on this Firebase project yet (Authentication -> Sign-in method -> Google).";
    case "auth/unauthorized-domain":
      return "This domain is not in the Firebase Auth authorized-domains list, so Google will not sign anyone in here.";
    case "auth/network-request-failed":
      return "Could not reach Google. Check the connection and try again.";
    default:
      return "Google sign-in did not complete. Try again.";
  }
}

/**
 * Live count of what is waiting. Deliberately in the nav rather than only on
 * the review page: the number you need to see is the one you are not
 * currently looking at.
 */
function PendingBadge() {
  const { posts } = usePosts({ sort: "new", max: 300, scope: "pending" });
  if (posts.length === 0) return null;
  return (
    <span
      className="numeric ml-1.5 inline-flex min-w-[18px] justify-center rounded-pill px-1.5 py-px text-[11px] font-bold"
      style={{
        background: "var(--label-yellow-bg)",
        color: "var(--label-yellow-fg)",
      }}
    >
      {posts.length}
    </span>
  );
}
