/**
 * Who administers this board.
 *
 * One rule, hardcoded on purpose, and the only one: a Google account on the
 * company domain, with a verified address. There is no second path - no
 * custom claim, no allowlist, no env var. An admin list that can be widened
 * by editing a deployment variable is an admin list that can be widened by
 * anyone who can edit deployment variables; the point of putting the rule
 * here is that widening it is a code change with a diff and a review.
 *
 * What this buys, and it is the real argument for it: access is derived
 * rather than stored. Nobody is ever granted admin, so nobody has to be
 * un-granted. Joining the company grants it and leaving revokes it, because
 * Workspace suspending an account is the same event as that account losing
 * the portal. A custom claim would outlive the person it was given to, and
 * the day you find out is the day you audit it.
 *
 * The provider check is load-bearing and easy to leave out. An email address
 * is only evidence of anything if the identity provider that issued it
 * vouched for it: had this trusted any token whose `email` ends in the
 * domain, then enabling email/password sign-up later — a one-click change in
 * the Firebase console, made by someone who has never read this file —
 * would let anyone self-register as an admin. Requiring `google.com` means
 * only Google Workspace can mint an admin, which is the thing actually being
 * relied on.
 *
 * Deliberately shared between the browser, the route handlers and (restated,
 * because rules are their own language) firestore.rules. The browser copy
 * decides what UI to draw and nothing more; every answer that matters is the
 * server's.
 */

/** The only domain whose Google accounts administer this board. */
export const ADMIN_DOMAIN = "ryder.id";

/** The subset of a decoded ID token that decides admin access. */
export interface AccessClaims {
  email?: string;
  email_verified?: boolean;
  firebase?: { sign_in_provider?: string };
}

export function grantsAdmin(token: AccessClaims | null | undefined): boolean {
  if (!token) return false;
  if (token.firebase?.sign_in_provider !== "google.com") return false;
  if (token.email_verified !== true) return false;
  return isAdminEmail(token.email);
}

/**
 * Note this is an exact match on the final `@domain`, not a substring: an
 * address at `ryder.id.example.com` does not qualify, and neither does one
 * that merely mentions the domain in its local part.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalised = email.trim().toLowerCase();
  return normalised.endsWith(`@${ADMIN_DOMAIN}`);
}
