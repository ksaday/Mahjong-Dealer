// Confirms, at the type level, that the actual `SeatView` produced by the
// real projector — not just the abstract branded types in `shared` — is
// rejected by a `NoConcealed<T>`-guarded sink (docs/14_Player_Privacy.md
// §6.2). `SeatView.ownHand[].face` is `ConcealedFace`, so passing a whole
// `SeatView` to a logger is a compile error even though the rest of the
// view is plain, public data.
//
// Counted by `project.proof.test.ts`, the same way as
// `shared/src/privacy/no-concealed.proof.ts` (docs/14 §6.3, TC-P06).
import type { NoConcealed } from "@mahjong-dealer/shared";
import type { SeatView } from "./project.js";

function sink<T>(_payload: NoConcealed<T>): void {
  // No-op — a stand-in for every logging/metrics/tracing entry point.
}

const view = {} as unknown as SeatView;

// @ts-expect-error — a SeatView carries this seat's own concealed faces and must never reach a telemetry sink.
sink(view);

// Honest control: stripping the concealed field compiles cleanly.
sink({ seat: view.seat, seq: view.seq, wallRemaining: view.wallRemaining });
