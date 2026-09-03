// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth/AuthContext.js";
import { ToastProvider } from "../components/Toast.js";
import { Home } from "./Home.js";

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

function renderHome() {
  return render(
    <MemoryRouter initialEntries={["/home"]}>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/home" element={<Home />} />
            <Route path="/tables/:tableId" element={<div>Table screen</div>} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("Home (S-04, docs/32_UX/Screen_Inventory.md §3)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it("shows the no-seats state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string) => {
      if (input === "/api/v1/accounts/me") return Promise.resolve(meResponse());
      if (input === "/api/v1/tables/mine") return Promise.resolve(jsonResponse(200, { tables: [] }));
      throw new Error(`unexpected fetch: ${input}`);
    }));

    renderHome();

    expect(await screen.findByText("You don’t hold a seat at any table yet.")).toBeInTheDocument();
  });

  it("creates a table and navigates to it, remembering the one-time join code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: string, init?: RequestInit) => {
        if (input === "/api/v1/accounts/me") return Promise.resolve(meResponse());
        if (input === "/api/v1/tables/mine") return Promise.resolve(jsonResponse(200, { tables: [] }));
        if (input === "/api/v1/tables" && init?.method === "POST") {
          return Promise.resolve(jsonResponse(201, { table_id: "t1", join_code: "ABCDEF", seat: "east" }));
        }
        throw new Error(`unexpected fetch: ${input}`);
      }),
    );
    const user = userEvent.setup();

    renderHome();
    await user.click(await screen.findByRole("button", { name: "Create a table" }));

    expect(await screen.findByText("Table screen")).toBeInTheDocument();
    expect(sessionStorage.getItem("mahjong-dealer:join-code:t1")).toBe("ABCDEF");
  });

  it("reuses the same Idempotency-Key across a retry after a failed create (D-18-10, D-18-11)", async () => {
    const postInits: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: string, init?: RequestInit) => {
        if (input === "/api/v1/accounts/me") return Promise.resolve(meResponse());
        if (input === "/api/v1/tables/mine") return Promise.resolve(jsonResponse(200, { tables: [] }));
        if (input === "/api/v1/tables" && init?.method === "POST") {
          postInits.push(init);
          if (postInits.length === 1) {
            return Promise.resolve(jsonResponse(503, { error: { code: "UNKNOWN", message: "Try again." } }));
          }
          return Promise.resolve(jsonResponse(201, { table_id: "t1", join_code: "ABCDEF", seat: "east" }));
        }
        throw new Error(`unexpected fetch: ${input}`);
      }),
    );
    const user = userEvent.setup();

    renderHome();
    await user.click(await screen.findByRole("button", { name: "Create a table" }));
    expect(await screen.findByText("Try again.")).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "Create a table" }));
    expect(await screen.findByText("Table screen")).toBeInTheDocument();

    expect(postInits).toHaveLength(2);
    const firstKey = (postInits[0]?.headers as Record<string, string>)["Idempotency-Key"];
    const secondKey = (postInits[1]?.headers as Record<string, string>)["Idempotency-Key"];
    expect(firstKey).toBeTruthy();
    expect(secondKey).toBe(firstKey);
  });

  it("shows a generic join-failed message without distinguishing wrong code from full or nonexistent (FR-022)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: string, init?: RequestInit) => {
        if (input === "/api/v1/accounts/me") return Promise.resolve(meResponse());
        if (input === "/api/v1/tables/mine") return Promise.resolve(jsonResponse(200, { tables: [] }));
        if (input === "/api/v1/tables/join" && init?.method === "POST") {
          return Promise.resolve(jsonResponse(404, { error: { code: "NOT_FOUND", message: "No such table." } }));
        }
        throw new Error(`unexpected fetch: ${input}`);
      }),
    );
    const user = userEvent.setup();

    renderHome();
    await waitFor(() => expect(screen.getByLabelText("Join code")).toBeEnabled());
    await user.type(screen.getByLabelText("Join code"), "ZZZZZZ");
    await user.click(screen.getByRole("button", { name: "Join" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That code didn’t work.");
  });
});
