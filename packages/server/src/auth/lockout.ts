// Durable per-account login lockout (docs/15_Security_Architecture.md §7.1,
// D-15-03): state lives in `accounts.failed_logins`/`locked_until`
// (docs/17 §5.1) precisely because an in-memory lockout vanishes on
// restart, which is a control an attacker can simply wait out.
//
// The progressive curve itself — how long each successive lockout lasts —
// is an implementation default in the same spirit as several of
// dealer-core's own defaults (the opening turn, the pass-round routing
// shape): docs/15 §7.1 specifies durable storage and "progressive," not
// the exact curve. Five failures locks for one minute; every five
// failures beyond that doubles the duration, capped at an hour.
const LOCKOUT_THRESHOLD = 5;
const BASE_LOCKOUT_MINUTES = 1;
const MAX_LOCKOUT_MINUTES = 60;

/** `null` if this many failures does not yet warrant a lock. */
export function computeLockoutMinutes(failedLogins: number): number | null {
  if (failedLogins < LOCKOUT_THRESHOLD) {
    return null;
  }
  const cycle = Math.floor(failedLogins / LOCKOUT_THRESHOLD) - 1;
  return Math.min(BASE_LOCKOUT_MINUTES * 2 ** cycle, MAX_LOCKOUT_MINUTES);
}

export function isLockedOut(lockedUntil: Date | null, now: Date): boolean {
  return lockedUntil !== null && lockedUntil.getTime() > now.getTime();
}
