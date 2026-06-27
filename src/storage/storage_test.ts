import { assertEquals } from "jsr:@std/assert@1";
import { parseRangeOffset } from "./gcs.ts";
import { computeExpiresAt, isComplete, isValidId } from "./types.ts";

Deno.test("parseRangeOffset returns next expected offset", () => {
  assertEquals(parseRangeOffset("bytes=0-5242879"), 5242880);
  assertEquals(parseRangeOffset("bytes=0-0"), 1);
});

Deno.test("parseRangeOffset handles missing/garbage headers", () => {
  assertEquals(parseRangeOffset(null), null);
  assertEquals(parseRangeOffset(""), null);
  assertEquals(parseRangeOffset("nonsense"), null);
});

Deno.test("isComplete compares offset to size", () => {
  assertEquals(isComplete({ size: 100, offset: 100, created: "", expiresAt: "" }), true);
  assertEquals(isComplete({ size: 100, offset: 99, created: "", expiresAt: "" }), false);
});

Deno.test("isValidId accepts only uuid v4-shaped ids", () => {
  assertEquals(isValidId("e1d37aa9-44b4-467a-8c88-03e8b59fbcc1"), true);
  assertEquals(isValidId("../etc/passwd"), false);
  assertEquals(isValidId("not-a-uuid"), false);
});

Deno.test("computeExpiresAt clamps to server max and rejects past dates", () => {
  const now = Date.now();
  // A request far beyond the server max is clamped (not honoured verbatim).
  const farFuture = new Date(now + 9999 * 24 * 60 * 60 * 1000).toISOString();
  const clamped = computeExpiresAt(farFuture);
  assertEquals(new Date(clamped).getTime() < new Date(farFuture).getTime(), true);

  // A past date falls back to a future expiry.
  const past = new Date(now - 1000).toISOString();
  assertEquals(new Date(computeExpiresAt(past)).getTime() > now, true);
});
