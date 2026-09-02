// Runtime schema validators for every inbound command (docs/03_System_Architecture.md
// §4.2; ADR-0015's `M-5`/schema-validation-at-the-boundary rationale).
//
// Validation here is **structural only** — presence, type, length,
// enumerated values, array bounds (docs/33_API §4.1). It never checks
// meaning: an `expose_tiles` command with twenty handles that don't form
// any recognizable group passes, because recognizing a group is a rule.
// Array bounds exist only to reject a frame designed to exhaust memory
// (NR-006, NR-008), not to encode how many tiles belong in anything.
import { z } from "zod";
import { COMMAND_NAMES, type ClientFrame, type CommandName, type CommandParamsMap } from "./commands.js";
import type { TileHandle } from "../privacy/handle.js";
import { SEAT_ORDER } from "../table/seat.js";

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TILE_HANDLE_PATTERN = /^[0-9a-f]{32}$/iu;

export const cmdIdSchema = z.string().regex(UUID_V7_PATTERN, "cmdId must be a UUIDv7 (docs/33_API §2)");
export const cseqSchema = z.number().int().min(1, "cseq must be >= 1 (CO-2)");

// The regex is the real validation; the transform only attaches the brand
// (docs/07 §5.1) to a value already confirmed to have a handle's shape.
const tileHandleSchema = z
  .string()
  .regex(TILE_HANDLE_PATTERN, "must be a 128-bit hex tile handle")
  .transform((value) => value as TileHandle);
const seatSchema = z.enum([...SEAT_ORDER]);

function isUnique<T>(values: readonly T[]): boolean {
  return new Set(values).size === values.length;
}

/** One schema per command name, each validating exactly that command's `d` (docs/33_API §4). */
export const COMMAND_SCHEMAS = {
  bind: z.object({ ticket: z.string().min(1) }),
  resume: z.object({ lastSeq: z.number().int().min(0) }),
  ping: z.undefined(),
  set_ready: z.undefined(),
  clear_ready: z.undefined(),
  start_deal: z.undefined(),
  close_table: z.undefined(),
  draw_tile: z.object({ end: z.enum(["head", "tail"]) }),
  discard_tile: z.object({ handle: tileHandleSchema }),
  claim_discard: z.object({ handle: tileHandleSchema }),
  expose_tiles: z.object({
    handles: z
      .array(tileHandleSchema)
      .min(1)
      .max(20)
      .refine(isUnique, "handles must be unique"),
  }),
  retract_exposure: z.object({ exposureId: z.string().min(1) }),
  swap_exposed_tile: z.object({
    myHandle: tileHandleSchema,
    exposureId: z.string().min(1),
    exposedHandle: tileHandleSchema,
  }),
  // No numeric bound is stated in docs/33_API §4 for a full hand permutation
  // (unlike expose_tiles/commit_pass's explicit "1 to 20"); the 16 KB
  // maximum frame size (docs/33_API §2) is the memory-exhaustion guard here.
  arrange_hand: z.object({ handles: z.array(tileHandleSchema).min(1) }),
  open_pass_round: z.object({
    routing: z
      .array(z.object({ from: seatSchema, to: seatSchema }))
      .min(2)
      .max(4)
      .refine((routing) => new Set(routing.map((r) => r.from)).size === routing.length, {
        message: "routing 'from' seats must be distinct",
      }),
  }),
  commit_pass: z.object({
    handles: z
      .array(tileHandleSchema)
      .min(1)
      .max(20)
      .refine(isUnique, "handles must be unique"),
  }),
  withdraw_pass: z.undefined(),
  cancel_pass_round: z.undefined(),
  declare_mahjong: z.undefined(),
  reveal_hand: z.undefined(),
  respond_declaration: z.object({ response: z.enum(["accept", "dispute"]) }),
  withdraw_declaration: z.undefined(),
  propose_end_game: z.undefined(),
  respond_end_game: z.object({ response: z.enum(["accept", "decline"]) }),
  propose_correction: z.object({ rewindTo: z.number().int().min(0) }),
  respond_correction: z.object({ response: z.enum(["accept", "reject"]) }),
  request_pause: z.undefined(),
  request_resume: z.undefined(),
  send_table_message: z.object({ text: z.string().min(1).max(512) }),
  send_signal: z.object({ signal: z.enum(["knock", "wait", "ack"]) }),
} satisfies { [N in CommandName]: z.ZodType<CommandParamsMap[N]> };

export interface ParseOk {
  readonly ok: true;
  readonly frame: ClientFrame;
}
export interface ParseError {
  readonly ok: false;
  readonly issues: readonly string[];
}
export type ParseResult = ParseOk | ParseError;

const ENVELOPE_SCHEMA = z.object({
  t: z.literal("cmd"),
  cmd: z.enum([...COMMAND_NAMES]),
  cmdId: cmdIdSchema,
  cseq: cseqSchema,
  d: z.unknown().optional(),
});

/**
 * Validates a raw inbound frame end to end: the envelope, then that
 * command's `d` shape. This is `SHAPE` in the validation pipeline (docs/02
 * §5.2) — the stage before `M-1`/`M-2`/`M-3`, which need authoritative
 * state and so belong to the table actor (Phase 4), not here.
 */
export function parseClientFrame(raw: unknown): ParseResult {
  const envelope = ENVELOPE_SCHEMA.safeParse(raw);
  if (!envelope.success) {
    return { ok: false, issues: envelope.error.issues.map((issue) => issue.message) };
  }

  const { cmd, d } = envelope.data;
  const schema = COMMAND_SCHEMAS[cmd];
  const parsedD = schema.safeParse(d);
  if (!parsedD.success) {
    return { ok: false, issues: parsedD.error.issues.map((issue) => issue.message) };
  }

  const base = { t: "cmd" as const, cmd, cmdId: envelope.data.cmdId, cseq: envelope.data.cseq };
  const frame = (parsedD.data === undefined ? base : { ...base, d: parsedD.data }) as ClientFrame;
  return { ok: true, frame };
}
