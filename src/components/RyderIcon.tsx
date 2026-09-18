/**
 * The Ryder mark on its own — the R glyph, without the wordmark.
 *
 * Same source asset as [[RyderLogo]]: the first four paths of the lockup
 * ryder.id serves. Their combined bounding box is exactly 70.285 square,
 * which is why the viewBox below is square and why the glyph rotates about
 * its true centre with no wobble — that matters, because this is what spins
 * while a vote is in flight.
 *
 * Fill is inherited, so callers set the colour with `text-*`.
 */
export function RyderIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 70.285 70.285"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M0 5.85919e-06L46.8566 4.87868e-06C59.7957 4.60792e-06 70.285 10.4892 70.285 23.4283C70.285 36.3674 59.7957 46.8566 46.8566 46.8566L46.8566 23.4283L23.4283 23.4283L4.90254e-07 23.4283L0 5.85919e-06Z" />
      <path d="M23.4283 46.8566C16.9588 46.8566 11.7142 41.612 11.7142 35.1425C11.7142 28.6729 16.9588 23.4283 23.4283 23.4283C29.8979 23.4283 35.1425 28.6729 35.1425 35.1425C35.1425 41.612 29.8979 46.8566 23.4283 46.8566Z" />
      <path d="M23.4283 46.8566C23.4283 59.7957 33.9175 70.285 46.8566 70.285L70.285 70.285L70.285 46.8566L46.8566 46.8566L23.4283 46.8566Z" />
      <path d="M23.4283 46.8566L23.4283 70.285L1.47076e-06 70.285L9.80507e-07 46.8566L23.4283 46.8566Z" />
    </svg>
  );
}
