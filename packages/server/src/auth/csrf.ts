// Double-submit CSRF verification (docs/15_Security_Architecture.md §4.2):
// the session's secret travels as both a cookie and a header; a
// cross-site request can attach the cookie automatically but cannot read
// it to set the header, so a mismatch means the request did not
// originate from a page that could read this session's secret.
import { timingSafeEqual } from "node:crypto";

export function verifyCsrf(sessionSecret: string, headerValue: string | undefined | string[]): boolean {
  if (typeof headerValue !== "string" || headerValue.length === 0) {
    return false;
  }
  const a = Buffer.from(sessionSecret, "utf8");
  const b = Buffer.from(headerValue, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
