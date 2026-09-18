import {
  MODERATION_STATES,
  POST_STATUSES,
  type Moderation,
  type PostStatus,
} from "./types";

export const LIMITS = {
  titleMin: 4,
  titleMax: 120,
  bodyMax: 4000,
  commentMin: 1,
  commentMax: 2000,
  nameMax: 60,
  /** New posts allowed per user per rolling window. */
  postsPerWindow: 3,
  postWindowMs: 10 * 60_000,
  commentsPerWindow: 10,
  commentWindowMs: 5 * 60_000,
} as const;

export class ValidationError extends Error {
  readonly status = 400;
}

function fail(message: string): never {
  throw new ValidationError(message);
}

/**
 * Collapses runs of whitespace, strips zero-width and bidi control
 * characters (a favourite of spam submissions and of anyone trying to make
 * a title render differently than it reads), and trims.
 */
export function clean(input: unknown, max: number): string {
  if (typeof input !== "string") return "";
  return input
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

export function parseTitle(input: unknown): string {
  const title = clean(input, LIMITS.titleMax);
  if (title.length < LIMITS.titleMin)
    fail(`Title must be at least ${LIMITS.titleMin} characters.`);
  return title;
}

export function parseBody(input: unknown): string {
  return clean(input, LIMITS.bodyMax);
}

export function parseComment(input: unknown): string {
  const body = clean(input, LIMITS.commentMax);
  if (body.length < LIMITS.commentMin) fail("Comment cannot be empty.");
  return body;
}

export function parseName(input: unknown): string {
  const name = clean(input, LIMITS.nameMax);
  return name || "Anonymous";
}

export function parseEmail(input: unknown): string | null {
  if (typeof input !== "string" || !input.trim()) return null;
  const email = input.trim().toLowerCase().slice(0, 200);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
    fail("That email address does not look right.");
  return email;
}

export function parseStatus(input: unknown): PostStatus {
  if (typeof input !== "string" || !POST_STATUSES.includes(input as PostStatus))
    fail("Unknown status.");
  return input as PostStatus;
}

export function parseModeration(input: unknown): Moderation {
  if (
    typeof input !== "string" ||
    !MODERATION_STATES.includes(input as Moderation)
  )
    fail("Unknown moderation state.");
  return input as Moderation;
}

/**
 * A rejection reason is required, an approval note is not.
 *
 * Rejecting silently is the one moderation action that guarantees a bad
 * experience: the submitter watches their idea never appear and has no way
 * to tell whether it was declined or lost. Making the reason mandatory at
 * the validation layer means no admin UI can skip it by accident.
 */
export function parseReviewNote(input: unknown, required: boolean): string | null {
  const note = clean(input, 300);
  if (required && note.length < 3)
    fail("Give the submitter a reason — at least a few words.");
  return note || null;
}

export function parseId(input: unknown, label = "id"): string {
  if (typeof input !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(input))
    fail(`Invalid ${label}.`);
  return input;
}

/** Cheap, dependency-free spam heuristics for public submissions. */
export function looksLikeSpam(text: string): boolean {
  const links = (text.match(/https?:\/\//g) ?? []).length;
  if (links > 2) return true;
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length > 20) {
    const upper = (text.match(/[A-Z]/g) ?? []).length;
    if (upper / letters.length > 0.7) return true;
  }
  if (/(.)\1{9,}/.test(text)) return true;
  return false;
}
