"use client";

import { useEffect, useRef, useState } from "react";

import { RyderIcon } from "./RyderIcon";

/**
 * Confetti burst, fired once when a vote lands.
 *
 * Hand-rolled rather than pulled from a package: the whole effect is ten
 * absolutely-positioned divs and one keyframe, which is far less than any
 * confetti library would add to the bundle for a 5px square.
 *
 * The offsets are a fixed table, not random. Two reasons — a vote always
 * celebrates identically, so it reads as part of the design rather than as
 * noise, and there is no randomness to disagree about if this ever renders
 * anywhere near a server.
 *
 * Angles fan upward and outward, because confetti that falls straight down
 * out of a 56px button just looks like the button is leaking.
 */
const CONFETTI = [
  { cx: -30, cy: -22, cr: -160, size: 5, round: false, color: "var(--brand)" },
  { cx: -19, cy: -32, cr: 120, size: 4, round: true, color: "var(--hc-light-bg)" },
  { cx: -4, cy: -36, cr: -60, size: 6, round: false, color: "var(--brand)" },
  { cx: 12, cy: -33, cr: 200, size: 4, round: true, color: "var(--hc-medium-bg)" },
  { cx: 26, cy: -24, cr: 90, size: 5, round: false, color: "var(--hc-success-bg)" },
  { cx: 33, cy: -8, cr: -130, size: 4, round: true, color: "var(--brand-secondary)" },
  { cx: -34, cy: -6, cr: 150, size: 4, round: false, color: "var(--hc-medium-bg)" },
  { cx: 24, cy: 12, cr: -80, size: 5, round: true, color: "var(--hc-light-bg)" },
  { cx: -24, cy: 14, cr: 60, size: 5, round: false, color: "var(--hc-high-bg)" },
  { cx: 4, cy: 22, cr: -190, size: 4, round: true, color: "var(--brand)" },
];

function Confetti() {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      {CONFETTI.map((p, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={
            {
              "--cx": `${p.cx}px`,
              "--cy": `${p.cy}px`,
              "--cr": `${p.cr}deg`,
              width: p.size,
              height: p.size,
              borderRadius: p.round ? "50%" : "1px",
              background: p.color,
              // Staggered so the burst blooms instead of snapping out as one
              // ring, which is the thing that makes hand-made confetti read
              // as cheap.
              animationDelay: `${(i % 4) * 28}ms`,
            } as React.CSSProperties
          }
        />
      ))}
    </span>
  );
}

export function VoteButton({
  count,
  voted,
  pending,
  onToggle,
  title,
  size = "md",
}: {
  count: number;
  voted: boolean;
  pending: boolean;
  onToggle: () => void;
  title: string;
  size?: "sm" | "md";
}) {
  const [celebrate, setCelebrate] = useState(false);

  // The vote is applied optimistically, so `voted` flips the instant you
  // click — while the request is still in flight and the spinner has taken
  // the button over. Celebrating on `voted` alone therefore played the whole
  // animation behind the spinner, where nobody could see it. Keying off
  // "voted *and* settled" moves it to the moment the button hands back, which
  // is also the moment the new number has actually landed.
  const settled = voted && !pending;
  const prevSettled = useRef(settled);

  useEffect(() => {
    const was = prevSettled.current;
    prevSettled.current = settled;
    if (settled && !was) {
      setCelebrate(true);
      const t = window.setTimeout(() => setCelebrate(false), 900);
      return () => window.clearTimeout(t);
    }
  }, [settled]);

  const dims = size === "sm" ? "h-11 w-11 text-[13px]" : "h-14 w-14 text-sm";
  const glyph = size === "sm" ? "h-[17px] w-[17px]" : "h-[21px] w-[21px]";

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={pending}
      aria-pressed={voted}
      aria-busy={pending}
      aria-label={`${voted ? "Remove your vote from" : "Upvote"} "${title}". ${count} ${count === 1 ? "vote" : "votes"}.`}
      // `relative` anchors the confetti; nothing here clips, so the pieces are
      // free to travel outside the button's own box.
      className={`${dims} relative flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-[var(--radius-control)] border font-semibold leading-none transition-all`}
      style={{
        background: voted ? "var(--label-blue-bg)" : "var(--page)",
        borderColor: voted ? "var(--brand)" : "var(--stroke)",
        color: voted ? "var(--label-blue-fg)" : "var(--ink-2)",
        boxShadow: voted ? "0 0 0 3px var(--brand-tint)" : "none",
        // Deliberately not dimmed while in flight: the spinning mark already
        // says "busy", and fading it would only make it harder to see.
        opacity: pending ? 0.9 : 1,
      }}
    >
      {pending ? (
        // Takes over the arrow *and* the count: for the second or two the
        // request is out, the button is just the mark, turning.
        <RyderIcon className={`${glyph} animate-spin-mark`} />
      ) : (
        <>
          <svg
            width="13"
            height="13"
            viewBox="0 0 16 16"
            aria-hidden
            className={celebrate ? "animate-bump" : undefined}
          >
            <path
              d="M8 3.2 13.4 10H2.6L8 3.2Z"
              fill={voted ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </svg>
          <span
            className={`tabular-nums ${celebrate ? "animate-count-pop" : ""}`}
            style={{ color: voted ? "var(--label-blue-fg)" : "var(--ink)" }}
          >
            {count}
          </span>
        </>
      )}
      {celebrate && <Confetti />}
    </button>
  );
}
