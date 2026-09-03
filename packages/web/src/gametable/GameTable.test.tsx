// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TileHandle, WireSeatView } from "@mahjong-dealer/shared";
import { GameTable } from "./GameTable.js";

function baseView(overrides: Partial<WireSeatView> = {}): WireSeatView {
  return {
    seat: "east",
    seq: 10,
    tableState: "seated",
    gameState: "in_play",
    flags: { paused: false, passRoundOpen: false, correctionPending: false },
    turn: "east",
    wallRemaining: 100,
    commitment: null,
    seats: [
      { seat: "east", displayName: "Alice", connection: "connected", ready: true, handSize: 13, exposures: [] },
      { seat: "south", displayName: "Bob", connection: "connected", ready: true, handSize: 13, exposures: [] },
      { seat: "west", displayName: "Carol", connection: "connected", ready: true, handSize: 13, exposures: [] },
      { seat: "north", displayName: "Dan", connection: "connected", ready: true, handSize: 13, exposures: [] },
    ],
    discards: [],
    ownHand: [
      { handle: "h1" as TileHandle, tile: "D5" },
      { handle: "h2" as TileHandle, tile: "B3" },
      { gap: true },
    ],
    ownSelection: [],
    passRound: null,
    correction: null,
    declaration: null,
    endGame: null,
    ...overrides,
  };
}

describe("GameTable (S-06, docs/32_UX/Screen_Inventory.md §3)", () => {
  afterEach(() => cleanup());

  it("renders the own rack at the bottom with faces, and opponents as backs (D-32-10, D-32-11)", () => {
    render(<GameTable view={baseView()} send={vi.fn()} lastEvent={null} onReturnToLobby={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Five of dots, position 1 of 3" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Gap" })).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: "Concealed tile" }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("13 tiles").length).toBe(3);
  });

  it("arms a discard on selecting one tile and confirming, then sends discard_tile", async () => {
    const send = vi.fn();
    render(<GameTable view={baseView()} send={send} lastEvent={null} onReturnToLobby={vi.fn()} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Five of dots, position 1 of 3" }));
    await user.click(screen.getByRole("button", { name: "Discard" }));

    expect(screen.getByText("Discard five of dots?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(send).toHaveBeenCalledWith("discard_tile", { handle: "h1" });
  });

  it("cancelling an armed act sends nothing", async () => {
    const send = vi.fn();
    render(<GameTable view={baseView()} send={send} lastEvent={null} onReturnToLobby={vi.fn()} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Five of dots, position 1 of 3" }));
    await user.click(screen.getByRole("button", { name: "Discard" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(send).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
  });

  it("only lets the seat whose turn it is draw, and arms draw_tile from the head", async () => {
    const send = vi.fn();
    render(<GameTable view={baseView({ turn: "south" })} send={send} lastEvent={null} onReturnToLobby={vi.fn()} />);
    for (const button of screen.getAllByRole("button", { name: /Draw — not your turn/ })) {
      expect(button).toBeDisabled();
    }
    cleanup();

    render(<GameTable view={baseView({ turn: "east" })} send={send} lastEvent={null} onReturnToLobby={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Draw from the head/ }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(send).toHaveBeenCalledWith("draw_tile", { end: "head" });
  });

  it("arms and confirms claiming the current discard, but not an older one (D-32-12)", async () => {
    const send = vi.fn();
    const view = baseView({
      discards: [
        { handle: "d1" as TileHandle, tile: "C1", index: 0, current: false },
        { handle: "d2" as TileHandle, tile: "D9", index: 1, current: true },
      ],
    });
    render(<GameTable view={view} send={send} lastEvent={null} onReturnToLobby={vi.fn()} />);
    const user = userEvent.setup();

    expect(screen.getByRole("img", { name: "One of craks, discard 1" })).toHaveAttribute("aria-disabled", "true");

    await user.click(screen.getByRole("button", { name: "Nine of dots, discard 2" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(send).toHaveBeenCalledWith("claim_discard", { handle: "d2" });
  });

  it("shows a correction vote band and lets a non-proposer accept or reject", async () => {
    const send = vi.fn();
    const view = baseView({ correction: { proposer: "south", rewindTo: 7, responses: {} } });
    render(<GameTable view={view} send={send} lastEvent={null} onReturnToLobby={vi.fn()} />);
    const user = userEvent.setup();

    expect(screen.getByText("South proposes undoing back to sequence 7.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Accept" }));
    expect(send).toHaveBeenCalledWith("respond_correction", { response: "accept" });
  });

  it("shows the concluded band and returns to the lobby without sending a command", async () => {
    const onReturnToLobby = vi.fn();
    const view = baseView({ gameState: "concluded", turn: null });
    render(<GameTable view={view} send={vi.fn()} lastEvent={{ seq: 1, ev: { type: "GameConcluded", outcome: "declaration_accepted", outcomeSeat: "north" } }} onReturnToLobby={onReturnToLobby} />);
    const user = userEvent.setup();

    expect(await screen.findByText("North declared Mahjong — all players accepted.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Return to the lobby" }));
    expect(onReturnToLobby).toHaveBeenCalledOnce();
  });

  it("accumulates chat messages from events and sends a new one", async () => {
    const send = vi.fn();
    const { rerender } = render(
      <GameTable view={baseView()} send={send} lastEvent={{ seq: 2, ev: { type: "TableMessage", seat: "south", displayName: "Bob", text: "hi" } }} onReturnToLobby={vi.fn()} />,
    );
    expect(await screen.findByText("hi")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Message"), "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(send).toHaveBeenCalledWith("send_table_message", { text: "hello" });

    rerender(<GameTable view={baseView()} send={send} lastEvent={{ seq: 2, ev: { type: "TableMessage", seat: "south", displayName: "Bob", text: "hi" } }} onReturnToLobby={vi.fn()} />);
  });

  it("reorders the rack by dragging a tile onto another, without a server round trip blocking the visual result (FR-100, FR-105)", () => {
    const send = vi.fn();
    render(<GameTable view={baseView()} send={send} lastEvent={null} onReturnToLobby={vi.fn()} />);

    const first = screen.getByRole("button", { name: "Five of dots, position 1 of 3" });
    const second = screen.getByRole("button", { name: "Three of bams, position 2 of 3" });

    fireEvent.dragStart(first);
    fireEvent.dragOver(second);
    fireEvent.drop(second);

    expect(send).toHaveBeenCalledWith("arrange_hand", { handles: ["h2", "h1"] });
    expect(screen.getByRole("button", { name: "Three of bams, position 1 of 3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Five of dots, position 2 of 3" })).toBeInTheDocument();
  });

  it("moves the single selected tile with Alt+ArrowRight (docs/24_Accessibility.md §5.2)", async () => {
    const send = vi.fn();
    render(<GameTable view={baseView()} send={send} lastEvent={null} onReturnToLobby={vi.fn()} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Five of dots, position 1 of 3" }));
    fireEvent.keyDown(document, { key: "ArrowRight", altKey: true });

    expect(send).toHaveBeenCalledWith("arrange_hand", { handles: ["h2", "h1"] });
    expect(screen.getByRole("button", { name: "Five of dots, position 2 of 3" })).toBeInTheDocument();
  });

  it("does not move a tile past the end of the rack, and does nothing with more than one tile selected", () => {
    const send = vi.fn();
    render(<GameTable view={baseView()} send={send} lastEvent={null} onReturnToLobby={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Three of bams, position 2 of 3" }));
    fireEvent.keyDown(document, { key: "ArrowRight", altKey: true });
    expect(send).not.toHaveBeenCalled();
  });
});
