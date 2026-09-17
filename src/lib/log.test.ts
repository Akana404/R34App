import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logUpstreamFailure } from "@/lib/log";
import { NotConfiguredError, UpstreamError } from "@/lib/r34";

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logUpstreamFailure", () => {
  it("logs rate limiting as a single warning line", () => {
    logUpstreamFailure("posts", new UpstreamError(429));
    expect(warn).toHaveBeenCalledWith(
      "[posts] rate limited by rule34 API (429), backing off",
    );
    expect(error).not.toHaveBeenCalled();
  });

  it("logs missing credentials as a warning naming the variables", () => {
    logUpstreamFailure("posts", new NotConfiguredError());
    expect(warn).toHaveBeenCalledWith(
      "[posts] not configured: API_KEY and USER_ID must be set (503)",
    );
  });

  it("logs other upstream statuses and timeouts as one error line, no stack", () => {
    logUpstreamFailure("autocomplete", new UpstreamError(503));
    const timeout = new Error("aborted");
    timeout.name = "TimeoutError";
    logUpstreamFailure("posts", timeout);

    expect(error.mock.calls).toEqual([
      ["[autocomplete] rule34 API responded with 503 (502)"],
      ["[posts] rule34 API did not answer within 10s (502)"],
    ]);
  });

  it("keeps the error object for failures nobody anticipated", () => {
    const boom = new SyntaxError("Unexpected token");
    logUpstreamFailure("posts", boom);
    expect(error).toHaveBeenCalledWith(
      "[posts] request to rule34 API failed (502):",
      boom,
    );
  });
});
