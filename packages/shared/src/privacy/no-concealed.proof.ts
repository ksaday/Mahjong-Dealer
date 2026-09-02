// The proof file (docs/14_Player_Privacy.md §6.3). Asserts, via deliberate
// type errors, that NoConcealed<T> rejects every forbidden shape: a hand, a
// wall order, a salt, a nested object containing any of them, and an array
// of them. The number of `@ts-expect-error` assertions is counted by
// `no-concealed.proof.test.ts` (TC-P06) — a change that makes NoConcealed<T>
// permissive would otherwise leave a silently-satisfied proof, which looks
// exactly like a passing test.
//
// `sink` stands in for every logging, metrics, and tracing entry point in
// the real system (docs/14 §6.2): `log.info(msg, payload: NoConcealed<T>)`.
import type { ConcealedFace, ConcealedHand, Salt, WallOrder } from "./concealed.js";
import type { NoConcealed } from "./no-concealed.js";

function sink<T>(_payload: NoConcealed<T>): void {
  // No-op. This function exists only so the type checker has a call site to
  // reject; it is never meant to run.
}

const hand = [] as unknown as ConcealedHand;
const wall = [] as unknown as WallOrder<ConcealedFace>;
const salt = "" as unknown as Salt;
const nested = { note: "arranging tiles", secret: hand };
const arrayOfHands = [hand];
const arrayOfSalts = [salt];
const deepNested = { outer: { inner: { wall } } };

// @ts-expect-error — a concealed hand must never reach a telemetry sink (docs/14 §6.1).
sink(hand);

// @ts-expect-error — the wall order must never reach a telemetry sink (docs/14 §6.1, NR-502).
sink(wall);

// @ts-expect-error — the commitment salt must never reach a telemetry sink (docs/14 §6.1).
sink(salt);

// @ts-expect-error — an object nesting a concealed hand must never reach a sink.
sink(nested);

// @ts-expect-error — an array of concealed hands must never reach a sink.
sink(arrayOfHands);

// @ts-expect-error — an array of salts must never reach a sink.
sink(arrayOfSalts);

// @ts-expect-error — concealed material nested two levels deep must never reach a sink.
sink(deepNested);

// Honest control: a payload carrying no concealed material compiles cleanly.
sink({ seat: "east", seq: 12, wallRemaining: 42 });
