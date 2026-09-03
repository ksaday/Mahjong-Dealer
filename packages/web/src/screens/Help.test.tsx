// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth/AuthContext.js";
import { Help } from "./Help.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function renderHelp() {
  return render(
    <MemoryRouter initialEntries={["/help"]}>
      <AuthProvider>
        <Routes>
          <Route path="/help" element={<Help />} />
          <Route path="/" element={<div>Welcome screen</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("Help (S-08, docs/32_UX/Screen_Inventory.md §3)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("states plainly what the system does not do (D-28-06)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, { account_id: "a1", email: "a@example.com", display_name: "Alice", role: "player", created_at: new Date().toISOString() }),
      ),
    );

    renderHelp();

    expect(await screen.findByText("It does not know the rules of Mahjong, of any variant, in any form.")).toBeInTheDocument();
    expect(screen.getByText(/Nobody — including whoever operates this system/)).toBeInTheDocument();
  });

  it("redirects an anonymous visitor to welcome", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: "NOT_AUTHENTICATED", message: "No valid session." } })),
    );

    renderHelp();

    expect(await screen.findByText("Welcome screen")).toBeInTheDocument();
  });
});
