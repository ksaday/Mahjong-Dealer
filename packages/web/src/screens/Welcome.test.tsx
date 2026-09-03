// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth/AuthContext.js";
import { Welcome } from "./Welcome.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function renderWelcome() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Welcome />} />
          <Route path="/home" element={<div>Home screen</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("Welcome (S-01, docs/32_UX/Screen_Inventory.md §3)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("offers register and log in for an anonymous visitor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: "NOT_AUTHENTICATED", message: "No valid session." } })),
    );
    renderWelcome();

    expect(await screen.findByRole("link", { name: "Create an account" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Log in" })).toBeInTheDocument();
  });

  it("redirects an already-authenticated visitor to home", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          account_id: "a",
          email: "alice@example.com",
          display_name: "Alice",
          role: "player",
          created_at: new Date().toISOString(),
        }),
      ),
    );
    renderWelcome();

    await waitFor(() => expect(screen.getByText("Home screen")).toBeInTheDocument());
  });
});
