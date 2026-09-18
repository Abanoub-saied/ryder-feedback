"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

type Tone = "info" | "success" | "error";

interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

const ToastContext = createContext<((message: string, tone?: Tone) => void) | null>(
  null,
);

/** Each tone is a Label pair from the colour system, used whole. */
const TONE: Record<Tone, { bg: string; fg: string; icon: React.ReactNode }> = {
  info: {
    bg: "var(--label-blue-bg)",
    fg: "var(--label-blue-fg)",
    icon: (
      <>
        <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 7.25v4M8 4.9v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </>
    ),
  },
  success: {
    bg: "var(--label-green-bg)",
    fg: "var(--label-green-fg)",
    icon: (
      <>
        <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
        <path d="m5.4 8.2 1.9 1.9 3.4-3.9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  error: {
    bg: "var(--label-red-bg)",
    fg: "var(--label-red-fg)",
    icon: (
      <>
        <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 4.9v3.6M8 11v.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </>
    ),
  },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message: string, tone: Tone = "info") => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, message, tone }]);
      window.setTimeout(() => dismiss(id), tone === "error" ? 6000 : 3500);
    },
    [dismiss],
  );

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        // Announced politely so a landed vote or a rejected one reaches a
        // screen reader without hijacking focus.
        role="status"
        aria-live="polite"
        // Bottom-centre on phones where the thumb is, top-right on desktop
        // where it does not cover the list you were just reading.
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:bottom-auto sm:right-5 sm:top-20 sm:items-end sm:px-0"
      >
        {toasts.map((t) => {
          const tone = TONE[t.tone];
          return (
            <div
              key={t.id}
              className="animate-pop pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-card py-2.5 pl-3 pr-2.5 text-sm shadow-[var(--shadow-lg)]"
              style={{ background: tone.bg, color: tone.fg }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden
                className="mt-0.5 shrink-0"
              >
                {tone.icon}
              </svg>
              <span className="font-medium">{t.message}</span>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                className="-mr-0.5 ml-1 grid h-5 w-5 shrink-0 place-items-center rounded-full opacity-60 transition-opacity hover:opacity-100"
              >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
