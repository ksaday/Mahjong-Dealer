// Password hashing and policy (docs/15_Security_Architecture.md §4.1).
import * as argon2 from "argon2";
import { getPasswordPepper } from "./pepper.js";
import type { BreachChecker } from "./breach-checker.js";

const MIN_LENGTH = 12; // docs/15 §4.1: length plus a breach check, no composition rules

// Argon2id parameters: reviewed against current guidance at implementation
// time, per docs/15 §4.1's mandate that they be reviewed annually. As of
// this writing these follow OWASP's current baseline (64 MiB, 3 passes,
// 4-way parallelism) — a value to revisit on schedule, not a constant to
// treat as permanent.
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
} as const;

export async function hashPassword(password: string, env?: NodeJS.ProcessEnv): Promise<string> {
  const peppered = password + getPasswordPepper(env);
  return argon2.hash(peppered, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, password: string, env?: NodeJS.ProcessEnv): Promise<boolean> {
  const peppered = password + getPasswordPepper(env);
  try {
    return await argon2.verify(hash, peppered);
  } catch {
    // A malformed or foreign-format hash is a verification failure, not a crash.
    return false;
  }
}

export type PasswordPolicyViolation = "TOO_SHORT" | "BREACHED";

export async function checkPasswordPolicy(
  password: string,
  breachChecker: BreachChecker,
): Promise<PasswordPolicyViolation | null> {
  if (password.length < MIN_LENGTH) {
    return "TOO_SHORT";
  }
  if (await breachChecker.isBreached(password)) {
    return "BREACHED";
  }
  return null;
}
