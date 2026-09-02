import type { ConcealedMaterial } from "./concealed.js";

/**
 * Recursive guard: renders any property whose type is concealed material
 * (docs/14_Player_Privacy.md §6.1) unusable, at any depth and through
 * arrays. Every logging, metrics, and tracing entry point takes
 * `NoConcealed<T>` as its payload type, so passing a hand to a logger is a
 * compile error rather than an incident (NFR-014).
 *
 * See `no-concealed.proof.ts` for the assertions this guard must satisfy.
 */
export type NoConcealed<T> = T extends ConcealedMaterial
  ? never
  : T extends readonly (infer U)[]
    ? readonly NoConcealed<U>[]
    : T extends object
      ? { [K in keyof T]: NoConcealed<T[K]> }
      : T;
