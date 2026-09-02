// Checkpointing (docs/06_Digital_Dealer_Architecture.md DD-29, DD-30;
// docs/16_Data_Architecture.md §5). `checkpoint` and `restore` are the pure
// serialize/deserialize pair the actor uses for crash recovery and
// correction (docs/05 §8); encryption, storage, and timing are the host's
// job (docs/16 §5), not dealer-core's.
import type { Face, Salt, Seat, TileHandle, WallOrder } from "@mahjong-dealer/shared";
import { SEAT_ORDER } from "@mahjong-dealer/shared";
import type { Tile } from "../tiles/tile.js";
import { invariants } from "../state/conservation.js";
import type { GameLifecycle, GameState, TileLocations } from "../state/state.js";

interface CheckpointTile {
  readonly handle: TileHandle;
  readonly face: Face;
  readonly copy: number;
}

interface CheckpointPayload {
  readonly lifecycle: GameLifecycle;
  readonly seq: number;
  readonly turn: Seat | null;
  readonly tiles: readonly CheckpointTile[];
  readonly locations: TileLocations;
  readonly salt: string | null;
  readonly commitment: string | null;
}

/** Produces a complete checkpoint of `state` as bytes (here, a UTF-8 JSON string). */
export function checkpoint(state: GameState): string {
  const tiles: CheckpointTile[] = [...state.tileByHandle.entries()].map(([handle, tile]) => ({
    handle,
    face: tile.face,
    copy: tile.copy,
  }));

  const payload: CheckpointPayload = {
    lifecycle: state.lifecycle,
    seq: state.seq,
    turn: state.turn,
    tiles,
    locations: state.locations,
    salt: state.salt,
    commitment: state.commitment,
  };

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

  const tileByHandle = new Map<TileHandle, Tile>();
  for (const { handle, face, copy } of payload.tiles) {
    tileByHandle.set(handle, { face, copy });
  }

  const locations: TileLocations = {
    wall: payload.locations.wall as unknown as WallOrder<TileHandle>,
    hands: cloneRecord(payload.locations.hands),
    discards: [...payload.locations.discards],
    exposures: cloneRecord(payload.locations.exposures),
  };

  const state = buildState(payload, tileByHandle, locations);

  const result = invariants(state);
  if (!result.ok) {
    throw new CheckpointRestoreError(
      `checkpoint failed the conservation invariant: ${result.reason} — ${result.detail}`,
    );
  }

  return state;
}

function buildState(
  payload: CheckpointPayload,
  tileByHandle: ReadonlyMap<TileHandle, Tile>,
  locations: TileLocations,
): GameState {
  if (payload.lifecycle === "idle") {
    return {
      lifecycle: "idle",
      seq: payload.seq,
      turn: null,
      tileByHandle,
      locations,
      salt: null,
      commitment: null,
    };
  }

  if (payload.turn === null || payload.salt === null || payload.commitment === null) {
    throw new CheckpointRestoreError("an in-play checkpoint must carry turn, salt, and commitment");
  }

  return {
    lifecycle: "in_play",
    seq: payload.seq,
    turn: payload.turn,
    tileByHandle,
    locations,
    salt: payload.salt as Salt,
    commitment: payload.commitment,
  };
}

function cloneRecord(
  record: Readonly<Record<Seat, readonly TileHandle[]>>,
): Record<Seat, readonly TileHandle[]> {
  const result = {} as Record<Seat, readonly TileHandle[]>;
  for (const seat of SEAT_ORDER) {
    result[seat] = [...record[seat]];
  }
  return result;
}
