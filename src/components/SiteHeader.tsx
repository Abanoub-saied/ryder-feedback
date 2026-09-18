"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { RyderIcon } from "./RyderIcon";
import { RyderLogo } from "./RyderLogo";
import { useCommandPalette } from "./CommandPalette";
import { useIdentity } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme";

function ThemeToggle() {
  const { theme, resolved, toggle } = useTheme();

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${resolved === "dark" ? "light" : "dark"} theme`}
      // Rendered as neither state until mounted, so the server HTML and the
      // first client render agree. The icons cross-fade rather than swap,
      // which also hides the moment the real theme resolves.
      className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full border border-stroke text-ink-2 transition-colors hover:bg-surface-hover hover:text-ink"
    >
      <span
        className="absolute grid place-items-center transition-all duration-300"
        style={{
          opacity: theme === "dark" ? 1 : 0,
          transform: `rotate(${theme === "dark" ? 0 : -70}deg) scale(${theme === "dark" ? 1 : 0.6})`,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span
        className="absolute grid place-items-center transition-all duration-300"
        style={{
          opacity: theme === "light" ? 1 : 0,
          transform: `rotate(${theme === "light" ? 0 : 70}deg) scale(${theme === "light" ? 1 : 0.6})`,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </button>
  );
}

/**
 * Tab bar with a single pill that slides between items.
 *
 * One shared element rather than a background per tab: it is the thing
 * that makes the nav feel like a control instead of three links, and it
 * costs one measured rect. The pill is only shown once measured, so it
 * never animates in from 0,0 on first paint.
 */
function Tabs({ tabs }: { tabs: { href: string; label: string }[] }) {
  const pathname = usePathname();
  const listRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  const activeHref =
    tabs.find((t) =>
      t.href === "/" ? pathname === "/" : pathname.startsWith(t.href),
    )?.href ?? null;

  useLayoutEffect(() => {
    if (!activeHref) {
      setPill(null);
      return;
    }
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-href="${activeHref}"]`);
    if (!list || !el) return;
    setPill({ left: el.offsetLeft, width: el.offsetWidth });
  }, [activeHref, tabs.length]);

  // Fonts landing changes tab widths after first layout, so re-measure once
  // they do rather than leaving the pill a few pixels off.
  useEffect(() => {
    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (cancelled || !activeHref) return;
      const el = listRef.current?.querySelector<HTMLElement>(
        `[data-href="${activeHref}"]`,
      );
      if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth });
    });
    return () => {
      cancelled = true;
    };
  }, [activeHref]);

  return (
    <nav
      ref={listRef}
      // thin-scroll rather than wrap: with four tabs plus the admin one this
      // can exceed a 375px viewport, and a nav that wraps to two lines would
      // change the header's height as you sign in as an admin.
      className="thin-scroll relative flex min-w-0 items-center overflow-x-auto rounded-pill border border-stroke p-1"
      aria-label="Sections"
    >
      {pill && (
        <span
          aria-hidden
          className="absolute top-1 bottom-1 rounded-pill transition-all duration-300"
          style={{
            left: pill.left,
            width: pill.width,
            background: "var(--surface-2)",
            transitionTimingFunction: "var(--ease-out-quint)",
          }}
        />
      )}
      {tabs.map((tab) => {
        const active = tab.href === activeHref;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            data-href={tab.href}
            aria-current={active ? "page" : undefined}
            className="relative z-10 shrink-0 rounded-pill px-2.5 py-1.5 text-[13px] font-semibold transition-colors sm:px-3"
            style={{ color: active ? "var(--ink)" : "var(--ink-2)" }}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

function SearchTrigger() {
  const { open } = useCommandPalette();
  const [mac, setMac] = useState(false);

  useEffect(() => {
    setMac(/mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent));
  }, []);

  return (
    <button
      type="button"
      onClick={open}
      className="group hidden items-center gap-2 rounded-pill border border-stroke py-1.5 pl-3 pr-1.5 text-[13px] text-ink-2 transition-colors hover:border-stroke-2 hover:text-ink sm:flex"
      aria-label="Open command palette"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
        <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      {/* "Search everything" and not just "Search": the board below has its
          own keyword box, and the two used to be indistinguishable. This one
          spans every idea on every board and takes you to one; that one
          narrows the list you are looking at. */}
      <span className="hidden md:inline">Search everything</span>
      {/* Rendered only after mount: the modifier depends on the platform,
          which the server cannot know. */}
      <span className="kbd">{mac ? "⌘K" : "Ctrl K"}</span>
    </button>
  );
}

export function SiteHeader() {
  const { isAdmin } = useIdentity();
  const { open } = useCommandPalette();
  const [scrolled, setScrolled] = useState(false);

  // The header only grows a border and a shadow once the page has moved
  // under it. At rest it should read as part of the page, not a bar.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // The one navigation surface on the page. Every other route to these
  // destinations was removed from the board hero, so this bar is where
  // "where else can I go?" gets answered — which is why "Yours" belongs in
  // it rather than hiding behind an avatar menu: a person who submitted an
  // idea that is still in review has nowhere else to find it.
  const tabs = [
    { href: "/", label: "Feedback" },
    { href: "/roadmap", label: "Roadmap" },
    { href: "/me", label: "Yours" },
    ...(isAdmin ? [{ href: "/admin", label: "Admin" }] : []),
  ];

  return (
    <header
      className="sticky top-0 z-40 transition-all duration-300"
      style={{
        background: "color-mix(in srgb, var(--page) 82%, transparent)",
        backdropFilter: "blur(14px) saturate(180%)",
        WebkitBackdropFilter: "blur(14px) saturate(180%)",
        borderBottom: `1px solid ${scrolled ? "var(--stroke)" : "transparent"}`,
        boxShadow: scrolled ? "var(--shadow-sm)" : "none",
      }}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center" aria-label="Ryder, home">
          {/* Height-constrained, width auto: the lockup is 280x71, so pinning
              the height is what keeps its proportions correct. Below 640px
              the wordmark plus two tabs plus two round buttons no longer fit
              in 375px, so the mark stands in for the lockup. */}
          <RyderIcon className="h-[20px] w-[20px] text-ink sm:hidden" />
          <RyderLogo className="hidden h-[22px] w-auto text-ink sm:block" />
        </Link>

        <span aria-hidden className="mx-1 hidden h-5 w-px bg-stroke sm:block" />

        <Tabs tabs={tabs} />

        <div className="ml-auto flex items-center gap-2">
          <SearchTrigger />
          <button
            type="button"
            onClick={open}
            className="grid h-9 w-9 place-items-center rounded-full border border-stroke text-ink-2 transition-colors hover:bg-surface-hover hover:text-ink sm:hidden"
            aria-label="Open command palette"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
