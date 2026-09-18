import "server-only";

import { NextResponse } from "next/server";
import { AuthError } from "./firebase/admin";
import { RateLimitError } from "./rate-limit";
import { ValidationError } from "./validate";

/**
 * One place that turns a thrown domain error into the right status code, so
 * route handlers can just throw and stay readable. Anything unrecognised
 * becomes a 500 with a generic message — internal errors are logged, never
 * echoed to the browser.
 */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ValidationError)
    return NextResponse.json({ error: err.message }, { status: 400 });

  if (err instanceof AuthError)
    return NextResponse.json({ error: err.message }, { status: err.status });

  if (err instanceof RateLimitError)
    return NextResponse.json(
      { error: err.message },
      { status: 429, headers: { "Retry-After": String(err.retryAfterSec) } },
    );

  console.error("[api] unhandled error", err);
  return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}
