// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth/AuthContext.js";
import { ToastProvider } from "../components/Toast.js";
import { rememberJoinCode } from "../tables/joinCodeStorage.js";
import { Table } from "./Table.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function meResponse() {
  return jsonResponse(200, {
    account_id: "a1",
    email: "alice@example.com",
    display_name: "Alice",
    role: "player",
    created_at: new Date().toISOString(),
  });
}

// A test double for the *global* `WebSocket` constructor — `TableSocket`'s
// default factory calls `new WebSocket(url)` directly, so faking the
// global (rather than threading a factory seam through `useTableLive`) is
// what lets this file drive the same connection lifecycle a browser would.
class TestSocket {
  static readonly instances: TestSocket[] = [];
  readonly sent: Record<string, unknown>[] = [];
  private openListener: (() => void) | null = null;
  private messageListener: ((event: { readonly data: unknown }) => void) | null = null;

  constructor(readonly url: string) {
    TestSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (...args: never[]) => void): void {
    if (type === "open") this.openListener = listener as () => void;
    if (type === "message") this.messageListener = listener as (event: { readonly data: unknown }) => void;
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(): void {
    // no-op for this double
  }

  open(): void {
    this.openListener?.();
  }

  receive(frame: unknown): void {
    this.messageListener?.({ data: JSON.stringify(frame) });
  }
}

function renderTable(tableId = "t1") {
  return render(
    <MemoryRouter initialEntries={[`/tables/${tableId}`]}>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/tables/:tableId" element={<Table />} />
            <Route path="/home" element={<div>Home screen</div>} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const oneSeatTable = {
  table_id: "t1",
  status: "OPEN",
  seat: "east",
  seats: [{ seat: "east", display_name: "Alice", connected: true }],
  game_state: null,
};

function fullView(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    seat: "east",
    seq: 1,
    tableState: "seated",
    gameState: "idle",
    flags: { paused: false, passRoundOpen: false, correctionPending: false },
    turn: null,
    wallRemaining: 152,
    commitment: null,
    seats: [
      { seat: "east", displayName: "Alice", connection: "connected", ready: true, handSize: 0, exposures: [] },
      { seat: "south", displayName: "Bob", connection: "connected", ready: true, handSize: 0, exposures: [] },
      { seat: "west", displayName: "Carol", connection: "connected", ready: true, handSize: 0, exposures: [] },
      { seat: "north", displayName: "Dan", connection: "connected", ready: true, handSize: 0, exposures: [] },
    ],
    discards: [],
    ownHand: [],
    ownSelection: [],
    passRound: null,
    correction: null,
    declaration: null,
    endGame: null,
    ...overrides,
  };
}

describe("Table (S-05, docs/32_UX/Screen_Inventory.md §3)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestSocket.instances.length = 0;
  });

  it("shows the remembered join code and the REST status snapshot while the live socket connects", async () => {
    rememberJoinCode("t1", "ABCDEF");
    vi.stubGlobal("WebSocket", TestSocket);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: string) => {
        if (input === "/api/v1/accounts/me") return Promise.resolve(meResponse());
        if (input === "/api/v1/tables/mine") return Promise.resolve(jsonResponse(200, { tables: [oneSeatTable] }));
        if (input === "/api/v1/tables/t1/connect-ticket") {
          return Promise.resolve(jsonResponse(201, { ticket: "tk1", expires_at: new Date().toISOString() }));
        }
        throw new Error(`unexpected fetch: ${input}`);
      }),
    );

    renderTable();

    expect(await screen.findByText("ABCDEF")).toBeInTheDocument();
    expect(screen.getByText(/Status: OPEN/)).toBeInTheDocument();
    expect(screen.getByText(/Your seat: east/)).toBeInTheDocument();
    expect(screen.getByText("Connecting…")).toBeInTheDocument();
  });

  it("shows not-found for a table the requester holds no seat at", async () => {
    vi.stubGlobal("WebSocket", TestSocket);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: string) => {
        if (input === "/api/v1/accounts/me") return Promise.resolve(meResponse());
        if (input === "/api/v1/tables/mine") return Promise.resolve(jsonResponse(200, { tables: [] }));
        throw new Error(`unexpected fetch: ${input}`);
      }),
    );

    renderTable("unknown-table");

    expect(await screen.findByText("Table not found")).toBeInTheDocument();
  });

  it("closes the table and returns home", async () => {
    vi.stubGlobal("WebSocket", TestSocket);
    const fetchMock = vi.fn().mockImplementation((input: string, init?: RequestInit) => {
      if (input === "/api/v1/accounts/me") return Promise.resolve(meResponse());
      if (input === "/api/v1/tables/mine") return Promise.resolve(jsonResponse(200, { tables: [oneSeatTable] }));
      if (input === "/api/v1/tables/t1/connect-ticket") {
        return Promise.resolve(jsonResponse(201, { ticket: "tk1", expires_at: new Date().toISOString() }));
      }
      if (input === "/api/v1/tables/t1" && init?.method === "DELETE") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      throw new Error(`unexpected fetch: ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderTable();
    await user.click(await screen.findByRole("button", { name: "Close table" }));

    expect(await screen.findByText("Home screen")).toBeInTheDocument();
  });

  it("binds over the live socket and lets the seat toggle readiness", async () => {
    vi.stubGlobal("WebSocket", TestSocket);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: string) => {
        if (input === "/api/v1/accounts/me") return Promise.resolve(meResponse());
        if (input === "/api/v1/tables/mine") return Promise.resolve(jsonResponse(200, { tables: [oneSeatTable] }));
        if (input === "/api/v1/tables/t1/connect-ticket") {
          return Promise.resolve(jsonResponse(201, { ticket: "tk1", expires_at: new Date().toISOString() }));
        }
        throw new Error(`unexpected fetch: ${input}`);
      }),
    );
    const user = userEvent.setup();

    renderTable();
    await waitFor(() => expect(TestSocket.instances).toHaveLength(1));
    const socket = TestSocket.instances[0]!;
    expect(socket.url).toBe("ws://localhost:3000/ws");

    socket.open();
    expect(socket.sent[0]).toMatchObject({ cmd: "bind", d: { ticket: "tk1" } });

    socket.receive({ t: "bound", seat: "east", protocolVersion: 1, seq: 0 });
    socket.receive({ t: "resumed", seq: 0, view: fullView({ seats: fullView().seats.map((s) => ({ ...s, ready: false })) }) });

    const readyButton = await screen.findByRole("button", { name: "Ready" });
    await user.click(readyButton);

    expect(socket.sent.find((f) => f["cmd"] === "set_ready")).toBeDefined();
  });

  it("shows Start dealing once every seat is ready, and sends start_deal", async () => {
    vi.stubGlobal("WebSocket", TestSocket);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: string) => {
        if (input === "/api/v1/accounts/me") return Promise.resolve(meResponse());
        if (input === "/api/v1/tables/mine") return Promise.resolve(jsonResponse(200, { tables: [oneSeatTable] }));
        if (input === "/api/v1/tables/t1/connect-ticket") {
          return Promise.resolve(jsonResponse(201, { ticket: "tk1", expires_at: new Date().toISOString() }));
        }
        throw new Error(`unexpected fetch: ${input}`);
      }),
    );
    const user = userEvent.setup();

    renderTable();
    await waitFor(() => expect(TestSocket.instances).toHaveLength(1));
    const socket = TestSocket.instances[0]!;

    socket.open();
    socket.receive({ t: "bound", seat: "east", protocolVersion: 1, seq: 0 });
    socket.receive({ t: "resumed", seq: 0, view: fullView() });

    const dealButton = await screen.findByRole("button", { name: "Start dealing" });
    await user.click(dealButton);

    expect(socket.sent.find((f) => f["cmd"] === "start_deal")).toBeDefined();
  });

  it("surfaces a reject frame as a toast", async () => {
    vi.stubGlobal("WebSocket", TestSocket);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: string) => {
        if (input === "/api/v1/accounts/me") return Promise.resolve(meResponse());
        if (input === "/api/v1/tables/mine") return Promise.resolve(jsonResponse(200, { tables: [oneSeatTable] }));
        if (input === "/api/v1/tables/t1/connect-ticket") {
          return Promise.resolve(jsonResponse(201, { ticket: "tk1", expires_at: new Date().toISOString() }));
        }
        throw new Error(`unexpected fetch: ${input}`);
      }),
    );

    renderTable();
    await waitFor(() => expect(TestSocket.instances).toHaveLength(1));
    const socket = TestSocket.instances[0]!;

    socket.open();
    socket.receive({ t: "bound", seat: "east", protocolVersion: 1, seq: 0 });
    socket.receive({ t: "resumed", seq: 0, view: fullView() });
    socket.receive({ t: "reject", cmdId: "x", code: "FORBIDDEN", message: "Only the host can deal." });

    expect(await screen.findByText("Only the host can deal.")).toBeInTheDocument();
  });
});
