// The client command catalog (docs/19_WebSocket_Event_Catalog.md §5;
// docs/33_API/Wire_Protocol_Contract.md §2, §4). `lower_snake_case` per the
// naming law (docs/19 §3) — checked in commands.test.ts, along with the
// count ("thirty commands, including the three protocol commands").
//
// No command shape carries `seat`, `table`, `player`, `timestamp`, or
// `signature` (docs/19 §4.1, NR-601): the seat and table come from the
// connection binding, not the frame.
import type { Seat } from "../table/seat.js";
import type { TileHandle } from "../privacy/handle.js";

export const COMMAND_NAMES = [
  // Protocol (docs/10 §10) — change no game state.
  "bind",
  "resume",
  "ping",
  // Table (docs/05; docs/10 §4).
  "set_ready",
  "clear_ready",
  "start_deal",
  "close_table",
  // Play (docs/10 §5).
  "draw_tile",
  "discard_tile",
  "claim_discard",
  "expose_tiles",
  "retract_exposure",
  "swap_exposed_tile",
  "arrange_hand",
  // Pass rounds (docs/10 §6).
  "open_pass_round",
  "commit_pass",
  "withdraw_pass",
  "cancel_pass_round",
  // Conclusion (docs/10 §7).
  "declare_mahjong",
  "reveal_hand",
  "respond_declaration",
  "withdraw_declaration",
  "propose_end_game",
  "respond_end_game",
  // Correction (docs/10 §8).
  "propose_correction",
  "respond_correction",
  // Presence and communication (docs/10 §9).
  "request_pause",
  "request_resume",
  "send_table_message",
  "send_signal",
] as const;

export type CommandName = (typeof COMMAND_NAMES)[number];

/** Per-command `d` shapes (docs/33_API §4). `undefined` means the command carries no `d` at all. */
export interface CommandParamsMap {
  bind: { readonly ticket: string };
  resume: { readonly lastSeq: number };
  ping: undefined;
  set_ready: undefined;
  clear_ready: undefined;
  start_deal: undefined;
  close_table: undefined;
  draw_tile: { readonly end: "head" | "tail" };
  discard_tile: { readonly handle: TileHandle };
  claim_discard: { readonly handle: TileHandle };
  /** 1 to 20, unique (docs/33_API §4.1 — the bound guards memory, not group size, NR-006). */
  expose_tiles: { readonly handles: readonly TileHandle[] };
  retract_exposure: { readonly exposureId: string };
  swap_exposed_tile: {
    readonly myHandle: TileHandle;
    readonly exposureId: string;
    readonly exposedHandle: TileHandle;
  };
  /** A complete permutation of the current hand (docs/10 §5.7). */
  arrange_hand: { readonly handles: readonly TileHandle[] };
  /** 2 to 4 entries, distinct `from` (docs/33_API §4). */
  open_pass_round: { readonly routing: readonly { readonly from: Seat; readonly to: Seat }[] };
  /** 1 to 20, unique (NR-008: no constraint on count). */
  commit_pass: { readonly handles: readonly TileHandle[] };
  withdraw_pass: undefined;
  cancel_pass_round: undefined;
  declare_mahjong: undefined;
  reveal_hand: undefined;
  respond_declaration: { readonly response: "accept" | "dispute" };
  withdraw_declaration: undefined;
  propose_end_game: undefined;
  respond_end_game: { readonly response: "accept" | "decline" };
  propose_correction: { readonly rewindTo: number };
  respond_correction: { readonly response: "accept" | "reject" };
  request_pause: undefined;
  request_resume: undefined;
  /** 1 to 512 characters (docs/33_API §4). */
  send_table_message: { readonly text: string };
  send_signal: { readonly signal: "knock" | "wait" | "ack" };
}

// Compile-time exhaustiveness: `CommandParamsMap` must have exactly the
// keys of `CommandName` — not a subset, not a superset. A command added to
// one but not the other fails the build (docs/19 §9's "name inventory").
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
/** Exists only for this type-check; its value carries no meaning. */
export const COMMAND_PARAMS_MAP_KEYS_MATCH: Equal<keyof CommandParamsMap, CommandName> = true;

type ClientCommandFrameFor<N extends CommandName> = CommandParamsMap[N] extends undefined
  ? { readonly t: "cmd"; readonly cmd: N; readonly cmdId: string; readonly cseq: number }
  : { readonly t: "cmd"; readonly cmd: N; readonly cmdId: string; readonly cseq: number; readonly d: CommandParamsMap[N] };

/** The one client-to-server shape (docs/33_API §2): a discriminated union over `cmd`. */
export type ClientFrame = { [N in CommandName]: ClientCommandFrameFor<N> }[CommandName];
