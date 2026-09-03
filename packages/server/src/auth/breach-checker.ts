// Breach-password checking (docs/15_Security_Architecture.md §4.1: "Rejected
// if present in a known-compromised password list"). The list's source is
// an explicitly open item — IMPLEMENTATION_READINESS_CHECKLIST.md §4.2's
// "Select the breach-password list source" is unresolved — so this defines
// the interface and two implementations that don't presuppose an answer:
// a null checker (the honest default until a source is chosen) and a
// denylist checker (a real mechanism, usable once a list — a downloaded
// Have I Been Pwned range, a local corpus — is actually wired in).
export interface BreachChecker {
  isBreached(password: string): Promise<boolean>;
}

/** The default: performs no check. Registration proceeds on length alone until a real source is selected. */
export class NullBreachChecker implements BreachChecker {
  isBreached(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

/** A real mechanism for a caller that already has a list of known-compromised passwords in hand. */
export class DenylistBreachChecker implements BreachChecker {
  private readonly denylist: ReadonlySet<string>;

  constructor(knownCompromisedPasswords: Iterable<string>) {
    this.denylist = new Set(knownCompromisedPasswords);
  }

  isBreached(password: string): Promise<boolean> {
    return Promise.resolve(this.denylist.has(password));
  }
}
