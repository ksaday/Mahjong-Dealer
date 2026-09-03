// The `checkpoints.public_state` column (docs/16_Data_Architecture.md
// §5.2's "public region" table): lifecycle, turn, discards, exposures,
// hand sizes, commitment — nothing concealed. Built fresh here rather than
// carved out of dealer-core's own `checkpoint()` output, which mixes both
// regions in one JSON blob (see `writer.ts`'s header comment).
//
// This projection is for `app_readonly`'s operational visibility only
// (docs/17 §7.2) — restore never reads it back; `writer.ts` decrypts
// `private_state` (a full `ActorSnapshot`) for that.
import type { Exposure, GameState } from "@mahjong-dealer/dealer-core";
import { SEAT_ORDER, type Seat, type TileHandle } from "@mahjong-dealer/shared";

export interface PublicCheckpointSummary {
  readonly lifecycle: GameState["lifecycle"];
  readonly seq: number;
  readonly turn: Seat | null;
  readonly discards: readonly string[];
  readonly exposures: Readonly<Record<Seat, readonly { readonly id: string; readonly faces: readonly string[] }[]>>;
  readonly handSizes: Readonly<Record<Seat, number>>;
  readonly commitment: string | null;
}

export function publicCheckpointSummary(state: GameState): PublicCheckpointSummary {
  if (state.lifecycle === "idle") {
    return {
      lifecycle: "idle",
      seq: state.seq,
      turn: null,
      discards: [],
      exposures: emptyExposures(),
      handSizes: emptyHandSizes(),
      commitment: null,
    };
  }

  if (state.lifecycle === "concluded") {
    const resolve = (handle: TileHandle): string => state.publicTileByHandle.get(handle)?.face ?? "?";
    return {
      lifecycle: "concluded",
      seq: state.seq,
      turn: null,
      discards: state.discards.map(resolve),
      exposures: mapExposures(state.exposures, resolve),
      handSizes: state.finalHandSizes,
      commitment: null,
    };
  }

  const resolve = (handle: TileHandle): string => state.tileByHandle.get(handle)?.face ?? "?";
  const handSizes = {} as Record<Seat, number>;
  for (const seat of SEAT_ORDER) {
    handSizes[seat] = state.locations.hands[seat].length;
  }
  return {
    lifecycle: state.lifecycle,
    seq: state.seq,
    turn: state.turn,
    discards: state.locations.discards.map(resolve),
    exposures: mapExposures(state.locations.exposures, resolve),
    handSizes,
    commitment: state.commitment,
  };
}

function mapExposures(
  exposures: Readonly<Record<Seat, readonly Exposure[]>>,
  resolve: (handle: TileHandle) => string,
): Readonly<Record<Seat, readonly { readonly id: string; readonly faces: readonly string[] }[]>> {
  const result = {} as Record<Seat, readonly { readonly id: string; readonly faces: readonly string[] }[]>;
  for (const seat of SEAT_ORDER) {
    result[seat] = exposures[seat].map((exposure) => ({ id: exposure.id, faces: exposure.handles.map(resolve) }));
  }
  return result;
}

function emptyExposures(): Readonly<Record<Seat, readonly { readonly id: string; readonly faces: readonly string[] }[]>> {
  const result = {} as Record<Seat, readonly { readonly id: string; readonly faces: readonly string[] }[]>;
  for (const seat of SEAT_ORDER) result[seat] = [];
  return result;
}

function emptyHandSizes(): Record<Seat, number> {
  const result = {} as Record<Seat, number>;
  for (const seat of SEAT_ORDER) result[seat] = 0;
  return result;
}
