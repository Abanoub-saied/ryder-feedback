import { MODERATION_META, type Moderation } from "@/lib/types";

/**
 * Publication state as a chip, the counterpart to StatusBadge.
 *
 * Two badges rather than one because they answer different questions —
 * "can the public see this" and "where is it in our pipeline" — and a post
 * can be any combination of the two. They share a shape so they read as one
 * family when they appear side by side.
 */
export function ModerationBadge({ moderation }: { moderation: Moderation }) {
  const meta = MODERATION_META[moderation];
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: meta.bg, color: meta.fg }}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: "currentColor", opacity: 0.7 }}
      />
      {meta.label}
    </span>
  );
}
