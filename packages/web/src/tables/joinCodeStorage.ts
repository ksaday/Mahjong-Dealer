// The server returns a table's join code exactly once, at creation, and
// can never return it again (D-18-05, docs/18_API_Design.md §7) — it is
// stored server-side only as an irreversible hash. Showing it "for the
// table's whole open life" (D-32-03) is therefore this browser's job: the
// host's own tab remembers it for as long as the tab lives. A reload in a
// fresh tab, or any other seat, legitimately never sees it — that is the
// design, not a bug to work around.
const PREFIX = "mahjong-dealer:join-code:";

export function rememberJoinCode(tableId: string, joinCode: string): void {
  try {
    sessionStorage.setItem(PREFIX + tableId, joinCode);
  } catch {
    // Storage can be unavailable (private browsing, quota) — the code
    // simply won't display on this reload, which is within the design's
    // own "known only to holders" tolerance.
  }
}

export function recallJoinCode(tableId: string): string | null {
  try {
    return sessionStorage.getItem(PREFIX + tableId);
  } catch {
    return null;
  }
}
