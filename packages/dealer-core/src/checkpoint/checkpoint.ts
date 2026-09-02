// Checkpointing (docs/06_Digital_Dealer_Architecture.md DD-29, DD-30;
// docs/16_Data_Architecture.md §5). `checkpoint` and `restore` are the pure
// serialize/deserialize pair the actor uses for crash recovery and
// correction (docs/05 §8); encryption, storage, and timing are the host's
// job (docs/16 §5), not dealer-core's.
import type { Face, Salt, Seat, TileHandle, WallOrder } from "@mahjong-dealer/shared";
import { SEAT_ORDER } from "@mahjong-dealer/shared";
import type { Tile } from "../tiles/tile.js";
import { invariants } from "../state/conservation.js";
import type {
  ConcludingProcess,
  CorrectionState,
  Exposure,
  GameLifecycle,
  GameOutcome,
  GameState,
  PassRoundState,
  PauseState,
  TileLocations,
} from "../state/state.js";

interface CheckpointTile {
  readonly handle: TileHandle;
  readonly face: Face;
  readonly copy: number;
}

interface CheckpointLivePart {
  readonly turn: Seat;
  readonly tiles: readonly CheckpointTile[];
  readonly locations: TileLocations;
  readonly salt: string;
  readonly commitment: string;
  readonly revealedHands: readonly Seat[];
  readonly nextExposureId: number;
  readonly paused: PauseState | null;
  readonly correction: CorrectionState | null;
}

interface CheckpointPayload {
  readonly lifecycle: GameLifecycle;
  readonly seq: number;
  readonly live?: CheckpointLivePart;
  readonly passRound?: PassRoundState | null; // in_play only
  readonly process?: ConcludingProcess; // concluding only
  readonly concluded?: {
    readonly outcome: GameOutcome;
    readonly finalHandSizes: Readonly<Record<Seat, number>>;
    readonly discards: readonly TileHandle[];
    readonly exposures: Readonly<Record<Seat, readonly Exposure[]>>;
    readonly revealedHands: Readonly<Partial<Record<Seat, readonly TileHandle[]>>>;
    readonly publicTiles: readonly CheckpointTile[];
  };
}

/** Produces a complete checkpoint of `state` as bytes (here, a UTF-8 JSON string). */
export function checkpoint(state: GameState): string {
  if (state.lifecycle === "idle") {
    return JSON.stringify({ lifecycle: "idle", seq: state.seq } satisfies CheckpointPayload);
  }

  if (state.lifecycle === "concluded") {
    const publicTiles: CheckpointTile[] = [...state.publicTileByHandle.entries()].map(
      ([handle, tile]) => ({ handle, face: tile.face, copy: tile.copy }),
    );
    return JSON.stringify({
      lifecycle: "concluded",
      seq: state.seq,
      concluded: {
        outcome: state.outcome,
        finalHandSizes: state.finalHandSizes,
        discards: state.discards,
        exposures: state.exposures,
        revealedHands: state.revealedHands,
        publicTiles,
      },
    } satisfies CheckpointPayload);
  }

  const tiles: CheckpointTile[] = [...state.tileByHandle.entries()].map(([handle, tile]) => ({
    handle,
    face: tile.face,
    copy: tile.copy,
  }));

  const live: CheckpointLivePart = {
    turn: state.turn,
    tiles,
    locations: state.locations,
    salt: state.salt,
    commitment: state.commitment,
    revealedHands: [...state.revealedHands],
    nextExposureId: state.nextExposureId,
    paused: state.paused,
    correction: state.correction,
  };

  const payload: CheckpointPayload =
    state.lifecycle === "in_play"
      ? { lifecycle: "in_play", seq: state.seq, live, passRound: state.passRound }
      : { lifecycle: "concluding", seq: state.seq, live, process: state.process };

  return JSON.stringify(payload);
}

export class CheckpointRestoreError extends Error {}

/**
 * Reconstructs a `GameState` from checkpoint bytes, verifying the
 * conservation invariant before accepting it (docs/07 §7.1): a checkpoint
 * that fails conservation must never become the table's authoritative
 * state.
 */
export function restore(bytes: string): GameState {
  const payload = JSON.parse(bytes) as CheckpointPayload;
  const state = buildState(payload);

  const result = invariants(state);
  if (!result.ok) {
    throw new CheckpointRestoreError(
      `checkpoint failed the conservation invariant: ${result.reason} — ${result.detail}`,
    );
  }

  return state;
}

function buildState(payload: CheckpointPayload): GameState {
  if (payload.lifecycle === "idle") {
    return { lifecycle: "idle", seq: payload.seq };
  }

  if (payload.lifecycle === "concluded") {
    if (payload.concluded === undefined) {
      throw new CheckpointRestoreError("a concluded checkpoint must carry its concluded payload");
    }
    const publicTileByHandle = new Map<TileHandle, Tile>();
    for (const { handle, face, copy } of payload.concluded.publicTiles) {
      publicTileByHandle.set(handle, { face, copy });
    }
    return {
      lifecycle: "concluded",
      seq: payload.seq,
      outcome: payload.concluded.outcome,
      finalHandSizes: payload.concluded.finalHandSizes,
      discards: [...payload.concluded.discards],
      exposures: cloneExposures(payload.concluded.exposures),
      revealedHands: { ...payload.concluded.revealedHands },
      publicTileByHandle,
    };
  }

  if (payload.live === undefined) {
    throw new CheckpointRestoreError(`a ${payload.lifecycle} checkpoint must carry its live payload`);
  }
  const { live } = payload;

  const tileByHandle = new Map<TileHandle, Tile>();
  for (const { handle, face, copy } of live.tiles) {
    tileByHandle.set(handle, { face, copy });
  }

  const locations: TileLocations = {
    wall: [...live.locations.wall] as unknown as WallOrder<TileHandle>,
    hands: cloneHandleRecord(live.locations.hands),
    discards: [...live.locations.discards],
    exposures: cloneExposures(live.locations.exposures),
    inFlight: cloneHandleRecord(live.locations.inFlight),
  };

  const base = {
    seq: payload.seq,
    turn: live.turn,
    tileByHandle,
    locations,
    salt: live.salt as Salt,
    commitment: live.commitment,
    revealedHands: new Set(live.revealedHands),
    nextExposureId: live.nextExposureId,
    paused: live.paused,
    correction: live.correction,
  };

  if (payload.lifecycle === "in_play") {
    return { ...base, lifecycle: "in_play", passRound: payload.passRound ?? null };
  }

  if (payload.process === undefined) {
    throw new CheckpointRestoreError("a concluding checkpoint must carry its process");
  }
  return { ...base, lifecycle: "concluding", process: payload.process };
}

function cloneHandleRecord(
  record: Readonly<Record<Seat, readonly TileHandle[]>>,
): Record<Seat, readonly TileHandle[]> {
  const result = {} as Record<Seat, readonly TileHandle[]>;
  for (const seat of SEAT_ORDER) {
    result[seat] = [...record[seat]];
  }
  return result;
}

function cloneExposures(
  record: Readonly<Record<Seat, readonly Exposure[]>>,
): Record<Seat, readonly Exposure[]> {
  const result = {} as Record<Seat, readonly Exposure[]>;
  for (const seat of SEAT_ORDER) {
    result[seat] = record[seat].map((exposure) => ({ id: exposure.id, handles: [...exposure.handles] }));
  }
  return result;
}
