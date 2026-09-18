"use client";

import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const KEY = "ryder.theme";

/**
 * Theme state, shared by the header toggle and the command palette.
 *
 * Deliberately does not read `window` during render: the server has no
 * window and would always resolve "light", so branching on it there would
 * make the first client render disagree with the server HTML. The effect
 * fills in the real value immediately after mount, and the inline script
 * in layout.tsx has already painted the correct palette by then.
 *
 * The two consumers stay in step through a `storage`-style custom event
 * rather than a context, because the value is ultimately owned by the
 * `data-theme` attribute on <html>, not by React.
 */
const EVENT = "ryder:themechange";

export function readTheme(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === "dark" || raw === "light") return raw;
  } catch {
    /* private mode, blocked storage — fall through to the OS preference */
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function applyTheme(next: Theme) {
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* no-op */
  }
  window.dispatchEvent(new CustomEvent<Theme>(EVENT, { detail: next }));
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(readTheme());
    const onChange = (e: Event) => setTheme((e as CustomEvent<Theme>).detail);
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);

  const toggle = useCallback(() => {
    applyTheme(readTheme() === "dark" ? "light" : "dark");
  }, []);

  return {
    /** Null until mounted, so callers can avoid a hydration mismatch. */
    theme,
    resolved: theme ?? "light",
    set: applyTheme,
    toggle,
  };
}
