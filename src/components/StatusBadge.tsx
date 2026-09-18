import { STATUS_META, type PostStatus } from "@/lib/types";

/**
 * A status chip, rendered straight from the colour system's Label pairs.
 *
 * Deliberately no color-mix here any more: the sheet already ships a
 * background *and* a content colour for each hue, in both themes, so
 * mixing our own would be second-guessing a decision that has been made.
 */
export function StatusBadge({
  status,
  size = "sm",
  dot = true,
}: {
  status: PostStatus;
  size?: "sm" | "md";
  dot?: boolean;
}) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill font-semibold whitespace-nowrap ${
        size === "md" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[11px]"
      }`}
      style={{ background: meta.bg, color: meta.fg }}
    >
      {dot && (
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: "currentColor", opacity: 0.7 }}
        />
      )}
      {meta.label}
    </span>
  );
}
