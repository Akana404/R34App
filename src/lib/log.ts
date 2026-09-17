import { NotConfiguredError, UpstreamError } from "@/lib/r34";

/**
 * One-line server log events.
 *
 * `next start` logs no requests in production, so these lines are all a
 * container log shows. Expected conditions (rate limiting, missing
 * credentials, a timeout) get a single readable line; only failures nobody
 * anticipated keep their stack trace.
 */

type Scope = "posts" | "autocomplete" | "state" | "backup" | "layout";

export function logInfo(scope: Scope, message: string) {
  console.info(`[${scope}] ${message}`);
}

export function logWarn(scope: Scope, message: string) {
  console.warn(`[${scope}] ${message}`);
}

export function logError(scope: Scope, message: string, err?: unknown) {
  if (err === undefined) console.error(`[${scope}] ${message}`);
  else console.error(`[${scope}] ${message}:`, err);
}

/** Logs a failed call to the rule34 API as the one line it deserves. */
export function logUpstreamFailure(scope: Scope, err: unknown) {
  if (err instanceof UpstreamError && err.status === 429) {
    logWarn(scope, "rate limited by rule34 API (429), backing off");
  } else if (err instanceof NotConfiguredError) {
    logWarn(scope, "not configured: API_KEY and USER_ID must be set (503)");
  } else if (err instanceof UpstreamError) {
    logError(scope, `rule34 API responded with ${err.status} (502)`);
  } else if (err instanceof Error && err.name === "TimeoutError") {
    logError(scope, "rule34 API did not answer within 10s (502)");
  } else {
    logError(scope, "request to rule34 API failed (502)", err);
  }
}
