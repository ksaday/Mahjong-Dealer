// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
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

describe("Table placeholder (landing spot for create/join/resume)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it("shows the remembered join code and the seat list", async () => {
    rememberJoinCode("t1", "ABCDEF");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: string) => {
        if (input === "/api/v1/accounts/me") return Promise.resolve(meResponse());
        if (input === "/api/v1/tables/mine") {
          return Promise.resolve(
            jsonResponse(200, {
              tables: [
                {
                  table_id: "t1",
                  status: "OPEN",
                  seat: "east",
                  seats: [
                    { seat: "east", display_name: "Alice", connected: true },
                    { seat: "south", display_name: null, connected: false },
                  ],
                  game_state: null,
                },
              ],
            }),
          );
        }
        throw new Error(`unexpected fetch: ${input}`);
      }),
    );

    renderTable();

    expect(await screen.findByText("ABCDEF")).toBeInTheDocument();
    expect(screen.getByText(/east: Alice/)).toBeInTheDocument();
    expect(screen.getByText(/south: empty/)).toBeInTheDocument();
  });

  it("shows not-found for a table the requester holds no seat at", async () => {
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
    const fetchMock = vi.fn().mockImplementation((input: string, init?: RequestInit) => {
      if (input === "/api/v1/accounts/me") return Promise.resolve(meResponse());
      if (input === "/api/v1/tables/mine") {
        return Promise.resolve(
          jsonResponse(200, {
            tables: [
              {
                table_id: "t1",
                status: "OPEN",
                seat: "east",
                seats: [{ seat: "east", display_name: "Alice", connected: true }],
                game_state: null,
              },
            ],
          }),
        );
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
});
