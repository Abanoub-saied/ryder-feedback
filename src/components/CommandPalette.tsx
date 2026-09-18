"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { StatusBadge } from "./StatusBadge";
import { usePosts } from "@/hooks/use-posts";
import { useIdentity } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme";
import { STATUS_META, type Post } from "@/lib/types";

/* ------------------------------------------------------------------
   Context
   ------------------------------------------------------------------ */

const PaletteContext = createContext<{
  open: () => void;
  close: () => void;
  isOpen: boolean;
} | null>(null);

export function useCommandPalette() {
  const ctx = useContext(PaletteContext);
  if (!ctx)
    throw new Error("useCommandPalette must be used inside <CommandPalette>");
  return ctx;
}

/* ------------------------------------------------------------------
   Provider + global shortcuts
   ------------------------------------------------------------------ */

/** True when a keystroke belongs to whatever the user is typing into. */
function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  );
}

export function CommandPalette({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    // `g` starts a two-key sequence (g then f / r / y / a), the convention
    // every keyboard-first tool uses. It expires so a stray g does not
    // hijack the next unrelated keystroke.
    let goPending = false;
    let goTimer = 0;

    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsOpen((v) => !v);
        return;
      }
      if (e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target)) return;

      if (goPending) {
        goPending = false;
        window.clearTimeout(goTimer);
        const to =
          e.key === "f"
            ? "/"
            : e.key === "r"
              ? "/roadmap"
              : e.key === "y"
                ? "/me"
                : e.key === "a"
                  ? "/admin"
                  : null;
        if (to) {
          e.preventDefault();
          router.push(to);
          return;
        }
      }

      if (e.key === "g") {
        goPending = true;
        goTimer = window.setTimeout(() => (goPending = false), 900);
        return;
      }
      if (e.key === "n") {
        e.preventDefault();
        router.push("/?new=1");
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(goTimer);
    };
  }, [router]);

  const value = useMemo(() => ({ open, close, isOpen }), [open, close, isOpen]);

  return (
    <PaletteContext.Provider value={value}>
      {children}
      {/* Mounted only while open, so the palette's Firestore listener is
          not a permanent subscription on every page of the site. */}
      {isOpen && <Palette onClose={close} />}
    </PaletteContext.Provider>
  );
}

/* ------------------------------------------------------------------
   The palette itself
   ------------------------------------------------------------------ */

type Item =
  | { kind: "action"; id: string; label: string; hint?: string; icon: Icon; run: () => void }
  | { kind: "post"; id: string; post: Post };

type Icon =
  | "board"
  | "map"
  | "shield"
  | "plus"
  | "sun"
  | "moon"
  | "link"
  | "user"
  | "chart";

function Palette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { isAdmin } = useIdentity();
  const { resolved, toggle } = useTheme();
  const { posts, loading } = usePosts({ sort: "top", max: 200 });

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const go = useCallback(
    (href: string) => {
      onClose();
      router.push(href);
    },
    [onClose, router],
  );

  const actions = useMemo<Item[]>(() => {
    const list: Item[] = [
      { kind: "action", id: "new", label: "Suggest an idea", hint: "N", icon: "plus", run: () => go("/?new=1") },
      { kind: "action", id: "board", label: "Go to feedback board", hint: "G F", icon: "board", run: () => go("/") },
      { kind: "action", id: "roadmap", label: "Go to roadmap", hint: "G R", icon: "map", run: () => go("/roadmap") },
    ];
    list.push({
      kind: "action",
      id: "me",
      label: "Go to your activity",
      hint: "G Y",
      icon: "user",
      run: () => go("/me"),
    });
    if (isAdmin) {
      list.push({ kind: "action", id: "admin", label: "Go to the review queue", hint: "G A", icon: "shield", run: () => go("/admin") });
      list.push({ kind: "action", id: "admin-analytics", label: "Go to admin analytics", icon: "chart", run: () => go("/admin/analytics") });
    }
    list.push({
      kind: "action",
      id: "theme",
      label: `Switch to ${resolved === "dark" ? "light" : "dark"} theme`,
      icon: resolved === "dark" ? "sun" : "moon",
      run: () => {
        toggle();
        onClose();
      },
    });
    return list;
  }, [go, isAdmin, resolved, toggle, onClose]);

  const q = query.trim().toLowerCase();

  const matchedActions = useMemo(
    () => (q ? actions.filter((a) => a.kind === "action" && a.label.toLowerCase().includes(q)) : actions),
    [actions, q],
  );

  const matchedPosts = useMemo<Item[]>(() => {
    const source = q
      ? posts.filter(
          (p) =>
            p.title.toLowerCase().includes(q) || p.body.toLowerCase().includes(q),
        )
      : // With no query the palette is a jump list, so show what people
        // are actually voting on rather than an arbitrary slice.
        posts.slice(0, 5);
    return source.slice(0, 8).map((p) => ({ kind: "post" as const, id: p.id, post: p }));
  }, [posts, q]);

  const items = useMemo(
    () => [...matchedActions, ...matchedPosts],
    [matchedActions, matchedPosts],
  );

  // Any change to the result set puts the cursor back on the first row.
  useEffect(() => setActive(0), [q, items.length]);

  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 20);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = overflow;
    };
  }, []);

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function runItem(item: Item) {
    if (item.kind === "action") item.run();
    else go(`/p/${item.post.id}`);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) {
      e.preventDefault();
      setActive((i) => (items.length ? (i + 1) % items.length : 0));
      return;
    }
    if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) {
      e.preventDefault();
      setActive((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = items[active];
      if (item) runItem(item);
    }
  }

  return (
    <div
      className="animate-scrim fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]"
      style={{ background: "var(--sheet-overlay)", backdropFilter: "blur(4px)" }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={onKeyDown}
        className="popup animate-pop flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden"
      >
        <div className="flex items-center gap-3 border-b border-stroke px-4">
          <SearchIcon />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search every idea, or jump somewhere…"
            aria-label="Search ideas and commands"
            role="combobox"
            aria-expanded
            aria-controls="palette-list"
            aria-activedescendant={items[active] ? `palette-${items[active].id}` : undefined}
            className="h-14 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
          />
          <button
            type="button"
            onClick={onClose}
            className="kbd hover:text-ink"
            aria-label="Close command palette"
          >
            esc
          </button>
        </div>

        <div
          ref={listRef}
          id="palette-list"
          role="listbox"
          className="thin-scroll flex-1 overflow-y-auto p-2"
        >
          {matchedActions.length > 0 && (
            <Group label="Actions">
              {matchedActions.map((item, i) => (
                <Row
                  key={item.id}
                  item={item}
                  index={i}
                  active={active === i}
                  onHover={setActive}
                  onPick={runItem}
                />
              ))}
            </Group>
          )}

          {matchedPosts.length > 0 && (
            <Group label={q ? "Matching ideas" : "Most wanted"}>
              {matchedPosts.map((item, i) => {
                const index = matchedActions.length + i;
                return (
                  <Row
                    key={item.id}
                    item={item}
                    index={index}
                    active={active === index}
                    onHover={setActive}
                    onPick={runItem}
                  />
                );
              })}
            </Group>
          )}

          {items.length === 0 && (
            <p className="px-3 py-10 text-center text-[13.5px] text-ink-2">
              {loading ? "Loading ideas…" : `Nothing matches “${query}”.`}
            </p>
          )}
        </div>

        <div className="flex items-center gap-4 border-t border-stroke px-4 py-2.5 text-[11.5px] text-ink-2">
          <Hint keys={["↑", "↓"]} label="navigate" />
          <Hint keys={["↵"]} label="open" />
          <Hint keys={["G", "R"]} label="roadmap" />
          <Link
            href="/roadmap"
            onClick={onClose}
            className="ml-auto text-[11.5px] text-ink-2 hover:text-ink"
          >
            View roadmap →
          </Link>
        </div>
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <p className="px-3 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-2">
        {label}
      </p>
      {children}
    </div>
  );
}

function Row({
  item,
  index,
  active,
  onHover,
  onPick,
}: {
  item: Item;
  index: number;
  active: boolean;
  onHover: (i: number) => void;
  onPick: (item: Item) => void;
}) {
  return (
    <div
      id={`palette-${item.id}`}
      data-index={index}
      role="option"
      aria-selected={active}
      tabIndex={-1}
      onMouseMove={() => onHover(index)}
      onClick={() => onPick(item)}
      className="flex cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2.5 transition-colors"
      style={active ? { background: "var(--surface-hover)" } : undefined}
    >
      {item.kind === "action" ? (
        <>
          <ActionIcon name={item.icon} />
          <span className="flex-1 truncate text-[14px] font-medium text-ink">
            {item.label}
          </span>
          {item.hint && <span className="kbd">{item.hint}</span>}
        </>
      ) : (
        <>
          <span
            className="numeric grid h-7 w-9 shrink-0 place-items-center rounded-[8px] text-[12px] font-semibold"
            style={{ background: "var(--surface-2)", color: "var(--ink)" }}
          >
            {item.post.voteCount}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-medium text-ink">
              {item.post.title}
            </span>
          </span>
          <StatusBadge status={item.post.status} dot={false} />
        </>
      )}
    </div>
  );
}

function Hint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="flex items-center gap-1">
      {keys.map((k) => (
        <span key={k} className="kbd">
          {k}
        </span>
      ))}
      {label}
    </span>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0 text-ink-2">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

const ICON_PATHS: Record<Icon, React.ReactNode> = {
  board: <path d="M3 4h10M3 8h10M3 12h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />,
  map: <path d="M2 4.5 6 3l4 1.5L14 3v8.5L10 13l-4-1.5L2 13V4.5ZM6 3v8.5M10 4.5V13" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />,
  shield: <path d="M8 2 3 4v4c0 3 2.2 5.2 5 6 2.8-.8 5-3 5-6V4L8 2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />,
  plus: <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />,
  sun: (
    <>
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 1.5v1.2M8 13.3v1.2M1.5 8h1.2M13.3 8h1.2M3.4 3.4l.85.85M11.75 11.75l.85.85M12.6 3.4l-.85.85M4.25 11.75l-.85.85" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </>
  ),
  moon: <path d="M13 9.5A5.7 5.7 0 0 1 6.5 3a5.7 5.7 0 1 0 6.5 6.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />,
  link: <path d="M6.5 9.5 9.5 6.5M7 4.5 8.5 3a2.8 2.8 0 0 1 4 4L11 8.5M9 11.5 7.5 13a2.8 2.8 0 0 1-4-4L5 7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />,
  user: (
    <>
      <circle cx="8" cy="5.5" r="2.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.8 13.5a5.2 5.2 0 0 1 10.4 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  chart: <path d="M2.5 13.5h11M4.5 11V7M8 11V3.5M11.5 11V8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />,
};

function ActionIcon({ name }: { name: Icon }) {
  return (
    <span
      className="grid h-7 w-9 shrink-0 place-items-center rounded-[8px] text-ink-2"
      style={{ background: "var(--surface-2)" }}
    >
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
        {ICON_PATHS[name]}
      </svg>
    </span>
  );
}
