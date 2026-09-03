// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth/AuthContext.js";
import { ToastProvider } from "../components/Toast.js";
import { Administration } from "./Administration.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function meResponse(role: "player" | "administrator" = "administrator") {
  return jsonResponse(200, {
    account_id: "admin-1",
    email: "root@example.com",
    display_name: "Root",
    role,
    created_at: new Date().toISOString(),
  });
}

function renderAdministration() {
  return render(
    <MemoryRouter initialEntries={["/admin"]}>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/admin" element={<Administration />} />
            <Route path="/home" element={<div>Home screen</div>} />
            <Route path="/" element={<div>Welcome screen</div>} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("Administration (S-09, docs/32_UX/Screen_Inventory.md §3)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("redirects a player account to home (FR-165)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(meResponse("player")));
    renderAdministration();
    expect(await screen.findByText("Home screen")).toBeInTheDocument();
  });

  it("redirects to /mfa when an admin call returns 401 MFA_REQUIRED (docs/15 §8.1, ADR-0017)", async () => {
    // A reload restores an unverified administrator session as
    // "authenticated" (GET /accounts/me carries no mfa_required field) —
    // the first real /admin/* call is what actually discovers it.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: string) => {
        if (input === "/api/v1/accounts/me") return Promise.resolve(meResponse());
        return Promise.resolve(
          jsonResponse(401, { error: { code: "MFA_REQUIRED", message: "Complete second-factor verification first." } }),
        );
      }),
    );
    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <AuthProvider>
          <ToastProvider>
            <Routes>
              <Route path="/admin" element={<Administration />} />
              <Route path="/mfa" element={<div>MFA screen</div>} />
            </Routes>
          </ToastProvider>
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText("MFA screen")).toBeInTheDocument();
  });

  it("lists accounts and tables without occupant identity in the tables row (D-18-07)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: string) => {
        if (input === "/api/v1/accounts/me") return Promise.resolve(meResponse());
        if (input.startsWith("/api/v1/admin/accounts")) {
          return Promise.resolve(
            jsonResponse(200, {
              total: 1,
              accounts: [{ account_id: "a1", email: "alice@example.com", display_name: "Alice", role: "player", status: "active", created_at: new Date().toISOString() }],
            }),
          );
        }
        if (input === "/api/v1/admin/tables") {
          return Promise.resolve(
            jsonResponse(200, {
              total: 1,
              tables: [{ table_id: "t1", status: "open", occupied_seats: 2, created_at: new Date().toISOString(), closed_at: null }],
            }),
          );
        }
        if (input === "/api/v1/admin/health") {
          return Promise.resolve(jsonResponse(200, { uptime_seconds: 42, tables: { total: 1, live_in_this_process: 1 }, connections: 2 }));
        }
        if (input === "/api/v1/admin/audit") return Promise.resolve(jsonResponse(200, { total: 0, entries: [] }));
        throw new Error(`unexpected fetch: ${input}`);
      }),
    );

    renderAdministration();

    expect(await screen.findByText("alice@example.com")).toBeInTheDocument();
    const tablesSection = screen.getByRole("heading", { name: "Tables" }).closest("section")!;
    expect(within(tablesSection).getByText("t1")).toBeInTheDocument();
    expect(within(tablesSection).getByText("2 / 4")).toBeInTheDocument();
    expect(tablesSection.textContent).not.toContain("Alice");
    expect(await screen.findByText(/Uptime: 42 s/)).toBeInTheDocument();
  });

  it("disables an account only once a reason is entered, then re-loads the list", async () => {
    const fetchMock = vi.fn().mockImplementation((input: string, init?: RequestInit) => {
      if (input === "/api/v1/accounts/me") return Promise.resolve(meResponse());
      if (input.startsWith("/api/v1/admin/accounts") && init?.method === "GET") {
        return Promise.resolve(
          jsonResponse(200, {
            total: 1,
            accounts: [{ account_id: "a1", email: "alice@example.com", display_name: "Alice", role: "player", status: "active", created_at: new Date().toISOString() }],
          }),
        );
      }
      if (input === "/api/v1/admin/accounts/a1" && init?.method === "PATCH") {
        return Promise.resolve(jsonResponse(200, { status: "disabled" }));
      }
      if (input === "/api/v1/admin/tables") return Promise.resolve(jsonResponse(200, { total: 0, tables: [] }));
      if (input === "/api/v1/admin/health") return Promise.resolve(jsonResponse(200, { uptime_seconds: 0, tables: { total: 0, live_in_this_process: 0 }, connections: 0 }));
      if (input === "/api/v1/admin/audit") return Promise.resolve(jsonResponse(200, { total: 0, entries: [] }));
      throw new Error(`unexpected fetch: ${input} ${init?.method}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderAdministration();
    await screen.findByText("alice@example.com");

    const disableButton = screen.getByRole("button", { name: "Disable" });
    expect(disableButton).toBeDisabled();

    await user.type(screen.getByLabelText("Reason for alice@example.com"), "fraud report");
    expect(disableButton).toBeEnabled();
    await user.click(disableButton);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/admin/accounts/a1",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "disabled", reason: "fraud report" }) }),
      ),
    );
  });

  it("force-closes a table only once a reason is entered", async () => {
    const fetchMock = vi.fn().mockImplementation((input: string, init?: RequestInit) => {
      if (input === "/api/v1/accounts/me") return Promise.resolve(meResponse());
      if (input === "/api/v1/admin/accounts") return Promise.resolve(jsonResponse(200, { total: 0, accounts: [] }));
      if (input === "/api/v1/admin/tables" && init?.method === "GET") {
        return Promise.resolve(
          jsonResponse(200, { total: 1, tables: [{ table_id: "t1", status: "open", occupied_seats: 0, created_at: new Date().toISOString(), closed_at: null }] }),
        );
      }
      if (input === "/api/v1/admin/tables/t1/force-close" && init?.method === "POST") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (input === "/api/v1/admin/health") return Promise.resolve(jsonResponse(200, { uptime_seconds: 0, tables: { total: 1, live_in_this_process: 1 }, connections: 0 }));
      if (input === "/api/v1/admin/audit") return Promise.resolve(jsonResponse(200, { total: 0, entries: [] }));
      throw new Error(`unexpected fetch: ${input} ${init?.method}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderAdministration();
    await screen.findByText("t1");

    const closeButton = screen.getByRole("button", { name: "Force-close" });
    expect(closeButton).toBeDisabled();
    await user.type(screen.getByLabelText("Reason for closing table t1"), "stuck");
    await user.click(closeButton);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/admin/tables/t1/force-close",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ reason: "stuck" }) }),
      ),
    );
  });
});
