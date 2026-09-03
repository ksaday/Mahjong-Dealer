// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth/AuthContext.js";
import { ToastProvider } from "../components/Toast.js";
import { Account } from "./Account.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function meResponse(displayName = "Alice") {
  return jsonResponse(200, {
    account_id: "a1",
    email: "alice@example.com",
    display_name: displayName,
    role: "player",
    created_at: new Date().toISOString(),
  });
}

function renderAccount() {
  return render(
    <MemoryRouter initialEntries={["/account"]}>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/account" element={<Account />} />
            <Route path="/home" element={<div>Home screen</div>} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("Account (S-07, docs/32_UX/Screen_Inventory.md §3)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the email, current display name, and session list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: string) => {
        if (input === "/api/v1/accounts/me") return Promise.resolve(meResponse());
        if (input === "/api/v1/accounts/me/sessions") {
          return Promise.resolve(
            jsonResponse(200, {
              sessions: [
                { id: "s1", issued_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), ip: "1.2.3.4", user_agent: "Firefox", current: true },
                { id: "s2", issued_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), ip: "5.6.7.8", user_agent: "Chrome", current: false },
              ],
            }),
          );
        }
        throw new Error(`unexpected fetch: ${input}`);
      }),
    );

    renderAccount();

    expect(await screen.findByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Alice")).toBeInTheDocument();
    expect(await screen.findByText(/this session/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke" })).toBeInTheDocument();
  });

  it("saves a new display name", async () => {
    const fetchMock = vi.fn().mockImplementation((input: string, init?: RequestInit) => {
      if (input === "/api/v1/accounts/me" && (init?.method === undefined || init.method === "GET")) {
        return Promise.resolve(meResponse());
      }
      if (input === "/api/v1/accounts/me" && init?.method === "PATCH") {
        return Promise.resolve(jsonResponse(200, { display_name: "Alicia" }));
      }
      if (input === "/api/v1/accounts/me/sessions") return Promise.resolve(jsonResponse(200, { sessions: [] }));
      throw new Error(`unexpected fetch: ${input} ${init?.method}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderAccount();
    await screen.findByDisplayValue("Alice");
    const input = screen.getByRole("textbox", { name: "Display name" });
    await user.clear(input);
    await user.type(input, "Alicia");
    await user.click(screen.getByRole("button", { name: "Save display name" }));

    await waitFor(() => expect(screen.getByText("Display name updated.")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/accounts/me",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ display_name: "Alicia" }) }),
    );
  });

  it("surfaces an incorrect current password without a generic toast", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: string, init?: RequestInit) => {
        if (input === "/api/v1/accounts/me") return Promise.resolve(meResponse());
        if (input === "/api/v1/accounts/me/sessions") return Promise.resolve(jsonResponse(200, { sessions: [] }));
        if (input === "/api/v1/accounts/me/password") {
          return Promise.resolve(jsonResponse(401, { error: { code: "INVALID_CREDENTIALS", message: "Could not change password." } }));
        }
        throw new Error(`unexpected fetch: ${input} ${init?.method}`);
      }),
    );
    const user = userEvent.setup();

    renderAccount();
    await user.type(await screen.findByLabelText("Current password"), "wrong-password");
    await user.type(screen.getByLabelText("New password"), "a-new-long-enough-password");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByText("Current password is incorrect.")).toBeInTheDocument();
  });

  it("revokes a session", async () => {
    const fetchMock = vi.fn().mockImplementation((input: string, init?: RequestInit) => {
      if (input === "/api/v1/accounts/me") return Promise.resolve(meResponse());
      if (input === "/api/v1/accounts/me/sessions") {
        return Promise.resolve(
          jsonResponse(200, { sessions: [{ id: "s2", issued_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), ip: "5.6.7.8", user_agent: null, current: false }] }),
        );
      }
      if (input === "/api/v1/accounts/me/sessions/s2" && init?.method === "DELETE") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      throw new Error(`unexpected fetch: ${input} ${init?.method}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderAccount();
    await user.click(await screen.findByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument());
  });
});
