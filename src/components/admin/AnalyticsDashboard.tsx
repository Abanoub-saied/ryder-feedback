"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { StatusBadge } from "@/components/StatusBadge";
import { useIdentity } from "@/lib/auth-context";
import type { AdminAnalytics, DayBucket } from "@/lib/types";

const WINDOWS = [7, 30, 90] as const;

/**
 * Does this board actually produce validated demand?
 *
 * The metrics are grouped to answer three questions in order, because that
 * is the order they matter in:
 *
 *  1. **Are we answering people?** Queue depth, the age of the oldest thing
 *     waiting, and median time to a decision. A board that takes two weeks
 *     to approve anything stops receiving submissions, and no amount of
 *     engagement analysis fixes that.
 *  2. **Is anyone else voting?** Every idea starts with its author's own
 *     vote, so the number that matters is the share of published ideas that
 *     got a *second* one. That single figure separates a board collecting
 *     signal from a suggestion box.
 *  3. **Does any of it ship?** The funnel from submitted to shipped, which
 *     is the only end-to-end evidence that voting changes what gets built.
 *
 * On the charts: the three timelines are small multiples rather than one
 * plot with three lines, because votes outnumber submissions by an order of
 * magnitude and putting them on one axis would flatten submissions into the
 * baseline — while putting them on two axes would invent a correlation out
 * of where the scales happened to be anchored. Same x, own y, read down the
 * column.
 */
export function AnalyticsDashboard() {
  const { authedFetch, ready } = useIdentity();
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<AdminAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (windowDays: number) => {
      setLoading(true);
      try {
        const res = await authedFetch(`/api/admin/analytics?days=${windowDays}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(
            (json as { error?: string }).error ?? "Could not load the numbers.",
          );
          return;
        }
        setData(json as AdminAnalytics);
        setError(null);
      } catch {
        setError("Network error.");
      } finally {
        setLoading(false);
      }
    },
    [authedFetch],
  );

  useEffect(() => {
    if (ready) void load(days);
  }, [ready, days, load]);

  // First load gets a skeleton; a window change holds the previous render at
  // reduced opacity instead, so switching 30 → 90 days does not collapse the
  // page and bounce the scroll position.
  if (loading && !data) {
    return (
      <div className="space-y-3" aria-busy="true">
        <div className="skeleton h-[88px]" />
        <div className="skeleton h-[220px]" />
        <div className="skeleton h-[220px]" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <p
        role="alert"
        className="rounded-card p-4 text-[13px]"
        style={{ background: "var(--label-red-bg)", color: "var(--label-red-fg)" }}
      >
        {error}
      </p>
    );
  }

  if (!data) return null;

  const { queue, engagement, funnel, timeline, boards, topValidated } = data;

  return (
    <div
      style={{ opacity: loading ? 0.55 : 1, transition: "opacity 160ms" }}
      aria-busy={loading}
    >
      {/* One filter row, above everything it scopes. Per-card ranges would
          mean two charts on this page silently covering different periods. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold">Idea validation</h2>
          <p className="mt-1 text-[13.5px] text-ink-2">
            Lifetime totals, with rates and timelines over the selected window.
          </p>
        </div>
        <div
          role="group"
          aria-label="Reporting window"
          className="flex h-9 rounded-pill border border-stroke p-0.5"
        >
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setDays(w)}
              aria-pressed={days === w}
              className="rounded-pill px-3 text-[13px] font-semibold transition-colors"
              style={
                days === w
                  ? { background: "var(--surface-2)", color: "var(--ink)" }
                  : { color: "var(--ink-2)" }
              }
            >
              {w}d
            </button>
          ))}
        </div>
      </div>

      {/* --- 1. Are we answering people? ------------------------------ */}
      <SectionTitle>Review health</SectionTitle>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Waiting on review"
          value={queue.pending}
          tone={queue.pending === 0 ? "good" : queue.pending > 10 ? "bad" : "warn"}
          note={
            queue.oldestPendingHours === null
              ? "Queue is empty"
              : `Oldest has waited ${formatHours(queue.oldestPendingHours)}`
          }
        />
        <Tile
          label="Median time to a decision"
          value={
            queue.medianReviewHours === null
              ? "—"
              : formatHours(queue.medianReviewHours)
          }
          note="Across every idea ever reviewed"
        />
        <Tile
          label="Approval rate"
          value={percent(queue.approvalRate)}
          note={`${queue.reviewedInWindow} reviewed in ${days} days`}
        />
        <Tile
          label="Published ideas"
          value={engagement.publishedIdeas}
          note={`of ${engagement.totalIdeas} ever submitted`}
        />
      </div>

      {/* --- 2. Is anyone else voting? -------------------------------- */}
      <SectionTitle>Demand signal</SectionTitle>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Ideas with outside support"
          value={percent(engagement.validatedShare)}
          tone={engagement.validatedShare >= 0.5 ? "good" : "warn"}
          note="Got a vote from someone other than the author"
        />
        <Tile
          label="Votes per published idea"
          value={engagement.votesPerIdea.toFixed(1)}
          note={`${engagement.totalVotes} votes in total`}
        />
        <Tile
          label="People voting"
          value={engagement.uniqueVoters}
          note={`${engagement.repeatVoters} backed more than one idea`}
        />
        <Tile
          label="Comments per idea"
          value={engagement.commentsPerIdea.toFixed(1)}
          note={`${engagement.totalComments} comments in total`}
        />
      </div>

      {engagement.zeroTractionShare > 0 && (
        <p className="mt-3 text-[12.5px] leading-relaxed text-ink-2">
          {percent(engagement.zeroTractionShare)} of published ideas have only
          their author&rsquo;s vote. That is the pile to read before the next
          planning round — either they are genuinely niche, or they are not
          being seen.
        </p>
      )}

      {/* --- Timelines ------------------------------------------------ */}
      <SectionTitle>Activity over the last {days} days</SectionTitle>
      <div className="grid gap-2.5 lg:grid-cols-3">
        <TimelineCard
          title="Ideas submitted"
          series={timeline}
          field="ideas"
          color="var(--brand)"
        />
        <TimelineCard
          title="Votes cast"
          series={timeline}
          field="votes"
          color="var(--earn-high)"
        />
        <TimelineCard
          title="Discussion"
          series={timeline}
          field="comments"
          color="var(--label-yellow-fg)"
          footnote="Comments counted against the day their idea was submitted, so the shape is right and a single day is approximate."
        />
      </div>

      {/* --- 3. Does any of it ship? ---------------------------------- */}
      <SectionTitle>Submission to shipped</SectionTitle>
      <div className="card p-4">
        <Funnel funnel={funnel} />
      </div>

      {/* --- Boards --------------------------------------------------- */}
      <SectionTitle>Where the demand is</SectionTitle>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-[13.5px]">
          <caption className="sr-only">
            Published ideas, votes, comments and shipped count per board
          </caption>
          <thead>
            <tr className="border-b border-stroke text-[12px] uppercase tracking-wide text-ink-2">
              <th className="px-4 py-2.5 font-medium">Board</th>
              <th className="px-3 py-2.5 font-medium">Votes</th>
              <th className="px-3 py-2.5 text-right font-medium">Ideas</th>
              <th className="px-3 py-2.5 text-right font-medium">Comments</th>
              <th className="px-4 py-2.5 text-right font-medium">Shipped</th>
            </tr>
          </thead>
          <tbody>
            {boards.map((b) => {
              const max = Math.max(1, ...boards.map((x) => x.votes));
              return (
                <tr key={b.boardId} className="border-b border-stroke last:border-0">
                  <td className="px-4 py-2.5 font-medium">{b.name}</td>
                  <td className="px-3 py-2.5">
                    {/* Bar and number together: the bar is for comparing at a
                        glance, the number is the accessible value. Every bar
                        is one hue — board names are nominal, so shading them
                        by size would encode length twice. */}
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="h-1.5 min-w-[2px] rounded-pill"
                        style={{
                          width: `${(b.votes / max) * 100}%`,
                          maxWidth: 160,
                          background: "var(--brand)",
                        }}
                      />
                      <span className="numeric text-[12.5px] text-ink-2">
                        {b.votes}
                      </span>
                    </span>
                  </td>
                  <td className="numeric px-3 py-2.5 text-right">{b.ideas}</td>
                  <td className="numeric px-3 py-2.5 text-right text-ink-2">
                    {b.comments}
                  </td>
                  <td className="numeric px-4 py-2.5 text-right">{b.shipped}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* --- Top validated -------------------------------------------- */}
      <SectionTitle>Most validated right now</SectionTitle>
      <p className="-mt-2 mb-3 max-w-prose text-[12.5px] leading-relaxed text-ink-2">
        Ranked by total votes, with comments and votes from the last {days} days
        weighted on top — so an old request with steady demand outranks a brief
        spike, and momentum breaks ties rather than deciding them.
      </p>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[620px] text-left text-[13.5px]">
          <thead>
            <tr className="border-b border-stroke text-[12px] uppercase tracking-wide text-ink-2">
              <th className="px-4 py-2.5 font-medium">Idea</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-3 py-2.5 text-right font-medium">Votes</th>
              <th className="px-3 py-2.5 text-right font-medium">Last {days}d</th>
              <th className="px-4 py-2.5 text-right font-medium">Comments</th>
            </tr>
          </thead>
          <tbody>
            {topValidated.map((row, i) => (
              <tr key={row.id} className="border-b border-stroke last:border-0">
                <td className="max-w-[320px] px-4 py-2.5">
                  <span className="numeric mr-2 text-[12px] text-ink-3">
                    {i + 1}
                  </span>
                  <Link href={`/p/${row.id}`} className="font-medium hover:underline">
                    {row.title}
                  </Link>
                  <div className="mt-0.5 text-[12px] text-ink-2">
                    {row.boardName}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <StatusBadge status={row.status} />
                </td>
                <td className="numeric px-3 py-2.5 text-right font-semibold">
                  {row.voteCount}
                </td>
                <td
                  className="numeric px-3 py-2.5 text-right"
                  style={{
                    color: row.recentVotes > 0 ? "var(--earn-high)" : "var(--ink-3)",
                  }}
                >
                  {row.recentVotes > 0 ? `+${row.recentVotes}` : "0"}
                </td>
                <td className="numeric px-4 py-2.5 text-right text-ink-2">
                  {row.commentCount}
                </td>
              </tr>
            ))}
            {topValidated.length === 0 && (
              <tr>
                <td colSpan={5} className="p-10 text-center text-ink-2">
                  Nothing published yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-5 text-[12px] text-ink-3">
        Generated {new Date(data.generatedAt).toLocaleString()}.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------
   Charts
   ------------------------------------------------------------------ */

/**
 * One measure over time, with a crosshair and a tooltip.
 *
 * A single series, so there is no legend — the card title names it — and no
 * value printed on every point, which at 90 days would be ninety numbers
 * nobody reads. The endpoint is labelled, the axis carries the range, and
 * the tooltip carries the rest. The peak is stated in words underneath so
 * the headline is reachable without hovering anything.
 */
function TimelineCard({
  title,
  series,
  field,
  color,
  footnote,
}: {
  title: string;
  series: DayBucket[];
  field: "ideas" | "votes" | "comments";
  color: string;
  footnote?: string;
}) {
  const values = series.map((d) => d[field]);
  const total = values.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...values);
  const peakIndex = values.indexOf(Math.max(...values));

  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const W = 320;
  const H = 88;
  const PAD = 4;

  const points = useMemo(
    () =>
      values.map((v, i) => {
        const x =
          values.length === 1
            ? W / 2
            : PAD + (i / (values.length - 1)) * (W - PAD * 2);
        const y = H - PAD - (v / max) * (H - PAD * 2);
        return [x, y] as const;
      }),
    [values, max],
  );

  const line = points.map(([x, y]) => `${x},${y}`).join(" ");
  const area = `${PAD},${H} ${line} ${W - PAD},${H}`;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || values.length === 0) return;
    const ratio = (e.clientX - rect.left) / rect.width;
    const i = Math.round(ratio * (values.length - 1));
    setHover(Math.min(values.length - 1, Math.max(0, i)));
  }

  const active = hover === null ? null : series[hover];

  return (
    <figure className="card m-0 p-4">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold">{title}</span>
        {/* Proportional figures on the headline number: tabular digits make
            a large standalone value look gappy. */}
        <span className="text-[18px] font-semibold leading-none">{total}</span>
      </figcaption>

      <div className="relative mt-3">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={H}
          role="img"
          aria-label={`${title}: ${total} over ${series.length} days, peaking at ${values[peakIndex] ?? 0}`}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          style={{ display: "block", overflow: "visible" }}
        >
          {/* A single hairline baseline rather than a grid: at this size a
              grid is noise, and the axis range is stated in text below. */}
          <line
            x1={PAD}
            y1={H - PAD}
            x2={W - PAD}
            y2={H - PAD}
            stroke="var(--stroke)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          <polygon points={area} fill={color} opacity="0.08" />
          <polyline
            points={line}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {hover !== null && points[hover] && (
            <>
              <line
                x1={points[hover][0]}
                y1={PAD}
                x2={points[hover][0]}
                y2={H - PAD}
                stroke="var(--stroke-2)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
              {/* A 2px surface ring separates the marker from the line it
                  sits on without drawing a border around it. */}
              <circle
                cx={points[hover][0]}
                cy={points[hover][1]}
                r="4"
                fill={color}
                stroke="var(--surface)"
                strokeWidth="2"
              />
            </>
          )}
        </svg>

        {active && (
          <div
            className="popup pointer-events-none absolute -top-1 z-10 -translate-y-full whitespace-nowrap px-2.5 py-1.5 text-[12px]"
            style={{
              left: `${(hover! / Math.max(1, values.length - 1)) * 100}%`,
              transform: "translate(-50%, -100%)",
            }}
          >
            <span className="font-semibold">{active[field]}</span>{" "}
            <span className="text-ink-2">on {formatDay(active.day)}</span>
          </div>
        )}
      </div>

      <div className="numeric mt-1.5 flex justify-between text-[11px] text-ink-3">
        <span>{formatDay(series[0]?.day ?? "")}</span>
        <span>{formatDay(series[series.length - 1]?.day ?? "")}</span>
      </div>

      <p className="mt-2 text-[11.5px] leading-relaxed text-ink-2">
        {total === 0
          ? "Nothing in this window."
          : `Busiest day ${formatDay(series[peakIndex]?.day ?? "")} with ${values[peakIndex]}.`}
        {footnote ? ` ${footnote}` : ""}
      </p>
    </figure>
  );
}

/**
 * Submitted → approved → planned → building → shipped.
 *
 * Ordered stages, so the bars take one hue stepped light to dark rather than
 * a colour per stage: the order is the meaning, and the status palette is
 * reserved for actual status chips elsewhere on the site. Every bar is
 * labelled with its stage and its number, so nothing depends on colour.
 */
function Funnel({ funnel }: { funnel: AdminAnalytics["funnel"] }) {
  const stages = [
    { label: "Submitted", value: funnel.submitted, step: 14 },
    { label: "Approved for the board", value: funnel.approved, step: 30 },
    { label: "Planned", value: funnel.planned, step: 50 },
    { label: "In progress", value: funnel.inProgress, step: 72 },
    { label: "Shipped", value: funnel.shipped, step: 100 },
  ];
  const max = Math.max(1, funnel.submitted);

  return (
    <div className="space-y-2.5">
      {stages.map((s, i) => {
        const pct = (s.value / max) * 100;
        const prev = i === 0 ? null : stages[i - 1].value;
        return (
          <div key={s.label}>
            <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
              <span className="font-medium">{s.label}</span>
              <span className="text-ink-2">
                <span className="numeric font-semibold text-ink">{s.value}</span>
                {prev !== null && prev > 0 && (
                  <span className="ml-1.5 text-[11.5px]">
                    {Math.round((s.value / prev) * 100)}% of previous
                  </span>
                )}
              </span>
            </div>
            <div
              className="mt-1 h-2.5 rounded-pill"
              style={{ background: "var(--surface-2)" }}
            >
              <div
                className="h-full rounded-pill transition-[width] duration-500"
                style={{
                  width: `${Math.max(pct, s.value > 0 ? 1.5 : 0)}%`,
                  // One hue, stepped light to dark with position in the
                  // funnel. Ordered categories get an ordinal ramp.
                  background: `color-mix(in srgb, var(--brand) ${s.step}%, var(--surface-2))`,
                  transitionTimingFunction: "var(--ease-out-quint)",
                }}
              />
            </div>
          </div>
        );
      })}
      {funnel.declined > 0 && (
        <p className="pt-1 text-[12px] text-ink-2">
          {funnel.declined} published{" "}
          {funnel.declined === 1 ? "idea was" : "ideas were"} marked Declined —
          those leave the funnel deliberately, not by attrition.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------
   Bits
   ------------------------------------------------------------------ */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-3 mt-8 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-2">
      {children}
    </h3>
  );
}

function Tile({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string | number;
  note?: string;
  tone?: "good" | "warn" | "bad";
}) {
  const accent =
    tone === "good"
      ? "var(--earn-high)"
      : tone === "warn"
        ? "var(--label-yellow-fg)"
        : tone === "bad"
          ? "var(--label-red-fg)"
          : undefined;
  return (
    <div className="card px-4 py-3.5">
      <p className="flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
        {accent && (
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: accent }}
          />
        )}
        {label}
      </p>
      <p className="mt-1.5 text-[26px] font-semibold leading-none tracking-tight">
        {value}
      </p>
      {note && <p className="mt-1.5 text-[11.5px] text-ink-3">{note}</p>}
    </div>
  );
}

function percent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function formatDay(day: string): string {
  if (!day) return "";
  const [, m, d] = day.split("-");
  return `${d} ${
    [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ][Number(m) - 1] ?? ""
  }`;
}
