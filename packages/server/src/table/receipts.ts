// Durable command-idempotency retention (docs/13_Input_Integrity.md §4,
// ADR-0009): "Retention | For the life of the game, in the actor and in
// the checkpoint." This is the actor's own record of which client `cmdId`s
// have already been applied and what `seq` each one produced — `dealer-core`
// has no concept of `cmdId` at all (a pure, wire-envelope-agnostic layer;
// idempotency is an application-layer concern per ADR-0009).
//
// No capacity bound, unlike `CheckpointHistory`'s deliberate 10-entry
// window: "for the life of the game" means retaining everything within
// that scope, not a sliding window, and each entry is tiny (a UUID string
// plus a number).
export class CommandReceipts {
  private readonly bySeq = new Map<string, number>();

  record(cmdId: string, seq: number): void {
    this.bySeq.set(cmdId, seq);
  }

  get(cmdId: string): number | undefined {
    return this.bySeq.get(cmdId);
  }

  /** A new game starts a fresh window — the scope is the current game only (docs/13 §4's "for the life of the game"), same as `CheckpointHistory.clear()`. */
  clear(): void {
    this.bySeq.clear();
  }

  /** For the encrypted checkpoint envelope (`ActorSnapshot.receipts`) — a `Map` isn't JSON-serializable, same pattern `PauseState.requestedBy`'s `Set` conversion already uses. */
  entries(): readonly (readonly [string, number])[] {
    return [...this.bySeq.entries()];
  }

  /** For the plaintext `checkpoints.receipts` operational column (docs/17 §5.7: "Applied `cmdId` values") — just the cmdIds, no `seq`. */
  keys(): readonly string[] {
    return [...this.bySeq.keys()];
  }
}
