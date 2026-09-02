import { describe, expect, it } from "vitest";
import { COMMAND_SCHEMAS, cmdIdSchema, cseqSchema, parseClientFrame } from "./schemas.js";

const VALID_CMD_ID = "018f3a2b-1c3d-7e4f-8a12-1234567890ab";
const HANDLE_A = "a".repeat(32);
const HANDLE_B = "b".repeat(32);

describe("cmdId / cseq (docs/33_API §2, docs/13 §4-5)", () => {
  it("accepts a well-formed UUIDv7", () => {
    expect(cmdIdSchema.safeParse(VALID_CMD_ID).success).toBe(true);
  });

  it("rejects a UUIDv4 (wrong version nibble) and non-UUID strings", () => {
    expect(cmdIdSchema.safeParse("018f3a2b-1c3d-4e4f-8a12-1234567890ab").success).toBe(false);
    expect(cmdIdSchema.safeParse("not-a-uuid").success).toBe(false);
  });

  it("rejects cseq below 1 (CO-2)", () => {
    expect(cseqSchema.safeParse(0).success).toBe(false);
    expect(cseqSchema.safeParse(1).success).toBe(true);
    expect(cseqSchema.safeParse(1.5).success).toBe(false);
  });
});

describe("per-command schemas — structural only (docs/33_API §4.1)", () => {
  it("draw_tile accepts head/tail and rejects anything else", () => {
    expect(COMMAND_SCHEMAS.draw_tile.safeParse({ end: "head" }).success).toBe(true);
    expect(COMMAND_SCHEMAS.draw_tile.safeParse({ end: "middle" }).success).toBe(false);
  });

  it("discard_tile requires a 32-hex-character handle", () => {
    expect(COMMAND_SCHEMAS.discard_tile.safeParse({ handle: HANDLE_A }).success).toBe(true);
    expect(COMMAND_SCHEMAS.discard_tile.safeParse({ handle: "too-short" }).success).toBe(false);
  });

  it("expose_tiles bounds handles at 1 to 20 and requires uniqueness (NR-006: no group-shape check)", () => {
    const oneHandle = { handles: [HANDLE_A] };
    const twenty = { handles: Array.from({ length: 20 }, (_, i) => i.toString(16).padStart(32, "0")) };
    const twentyOne = { handles: [...twenty.handles, HANDLE_B] };
    const duplicate = { handles: [HANDLE_A, HANDLE_A] };

    expect(COMMAND_SCHEMAS.expose_tiles.safeParse(oneHandle).success).toBe(true);
    expect(COMMAND_SCHEMAS.expose_tiles.safeParse(twenty).success).toBe(true);
    expect(COMMAND_SCHEMAS.expose_tiles.safeParse(twentyOne).success).toBe(false);
    expect(COMMAND_SCHEMAS.expose_tiles.safeParse({ handles: [] }).success).toBe(false);
    expect(COMMAND_SCHEMAS.expose_tiles.safeParse(duplicate).success).toBe(false);

    // Structural only: a single-tile "exposure" and an incoherent nine-tile
    // one are equally valid here — whether it's a real group is a rule
    // (docs/10 §5.4, NR-006).
    expect(COMMAND_SCHEMAS.expose_tiles.safeParse(oneHandle).success).toBe(true);
  });

  it("open_pass_round requires 2 to 4 routing entries with distinct 'from' seats", () => {
    const two = { routing: [{ from: "east", to: "south" }, { from: "south", to: "east" }] };
    const oneEntry = { routing: [{ from: "east", to: "south" }] };
    const duplicateFrom = {
      routing: [
        { from: "east", to: "south" },
        { from: "east", to: "west" },
      ],
    };
    const badSeat = { routing: [{ from: "east", to: "center" }] };

    expect(COMMAND_SCHEMAS.open_pass_round.safeParse(two).success).toBe(true);
    expect(COMMAND_SCHEMAS.open_pass_round.safeParse(oneEntry).success).toBe(false);
    expect(COMMAND_SCHEMAS.open_pass_round.safeParse(duplicateFrom).success).toBe(false);
    expect(COMMAND_SCHEMAS.open_pass_round.safeParse(badSeat).success).toBe(false);
  });

  it("send_table_message bounds text at 1 to 512 characters", () => {
    expect(COMMAND_SCHEMAS.send_table_message.safeParse({ text: "hi" }).success).toBe(true);
    expect(COMMAND_SCHEMAS.send_table_message.safeParse({ text: "" }).success).toBe(false);
    expect(COMMAND_SCHEMAS.send_table_message.safeParse({ text: "x".repeat(513) }).success).toBe(false);
    expect(COMMAND_SCHEMAS.send_table_message.safeParse({ text: "x".repeat(512) }).success).toBe(true);
  });

  it("commands with no parameters reject an unexpected `d`", () => {
    expect(COMMAND_SCHEMAS.ping.safeParse(undefined).success).toBe(true);
    expect(COMMAND_SCHEMAS.ping.safeParse({ unexpected: true }).success).toBe(false);
  });

  it("response enums are exact (respond_declaration, respond_end_game, respond_correction)", () => {
    expect(COMMAND_SCHEMAS.respond_declaration.safeParse({ response: "accept" }).success).toBe(true);
    expect(COMMAND_SCHEMAS.respond_declaration.safeParse({ response: "decline" }).success).toBe(false);
    expect(COMMAND_SCHEMAS.respond_end_game.safeParse({ response: "decline" }).success).toBe(true);
    expect(COMMAND_SCHEMAS.respond_correction.safeParse({ response: "reject" }).success).toBe(true);
  });
});

describe("parseClientFrame — the full envelope (docs/33_API §2)", () => {
  it("parses a well-formed frame with parameters", () => {
    const result = parseClientFrame({
      t: "cmd",
      cmd: "discard_tile",
      cmdId: VALID_CMD_ID,
      cseq: 1,
      d: { handle: HANDLE_A },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.frame).toEqual({
        t: "cmd",
        cmd: "discard_tile",
        cmdId: VALID_CMD_ID,
        cseq: 1,
        d: { handle: HANDLE_A },
      });
    }
  });

  it("parses a well-formed frame with no parameters and no `d`", () => {
    const result = parseClientFrame({ t: "cmd", cmd: "ping", cmdId: VALID_CMD_ID, cseq: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.frame).toEqual({ t: "cmd", cmd: "ping", cmdId: VALID_CMD_ID, cseq: 1 });
    }
  });

  it("rejects an unknown command name", () => {
    const result = parseClientFrame({ t: "cmd", cmd: "sort_hand", cmdId: VALID_CMD_ID, cseq: 1 });
    expect(result.ok).toBe(false);
  });

  it("rejects a frame missing cmdId or cseq", () => {
    expect(parseClientFrame({ t: "cmd", cmd: "ping", cseq: 1 }).ok).toBe(false);
    expect(parseClientFrame({ t: "cmd", cmd: "ping", cmdId: VALID_CMD_ID }).ok).toBe(false);
  });

  it("rejects a frame whose `d` fails that command's schema", () => {
    const result = parseClientFrame({
      t: "cmd",
      cmd: "discard_tile",
      cmdId: VALID_CMD_ID,
      cseq: 1,
      d: { handle: "not-a-handle" },
    });
    expect(result.ok).toBe(false);
  });

  it("never carries a seat field on any client frame (NR-601)", () => {
    const result = parseClientFrame({
      t: "cmd",
      cmd: "discard_tile",
      cmdId: VALID_CMD_ID,
      cseq: 1,
      d: { handle: HANDLE_A, seat: "east" },
    });
    // The extra `seat` inside `d` is simply not part of any schema's shape,
    // so it is stripped rather than accepted — there is no field for it.
    expect(result.ok).toBe(true);
    if (result.ok && "d" in result.frame) {
      expect(result.frame.d).not.toHaveProperty("seat");
    }
  });
});
