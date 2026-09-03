// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth/AuthContext.js";
import { ToastProvider } from "../components/Toast.js";
import { Login } from "./Login.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <AuthProvider>
        <ToastProvider>
          <Login />
        </ToastProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("Login (S-03, docs/32_UX/Screen_Inventory.md §3)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the same failure message for a wrong password as for an unknown account", async () => {
    const fetchMock = vi.fn().mockImplementation((input: string) => {
      if (input === "/api/v1/accounts/me") return Promise.resolve(jsonResponse(401, { error: { code: "NOT_AUTHENTICATED", message: "No valid session." } }));
      return Promise.resolve(jsonResponse(401, { error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password." } }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderLogin();
    await waitFor(() => expect(screen.getByLabelText("Email")).toBeEnabled());

    await user.type(screen.getByLabelText("Email"), "alice@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password.");
  });

  it("states the lock expiry rather than only 'locked'", async () => {
    const fetchMock = vi.fn().mockImplementation((input: string) => {
      if (input === "/api/v1/accounts/me") return Promise.resolve(jsonResponse(401, { error: { code: "NOT_AUTHENTICATED", message: "No valid session." } }));
      return Promise.resolve(
        jsonResponse(423, {
          error: { code: "ACCOUNT_LOCKED", message: "This account is temporarily locked." },
          locked_until: "2026-09-02T12:00:00.000Z",
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderLogin();
    await waitFor(() => expect(screen.getByLabelText("Email")).toBeEnabled());

    await user.type(screen.getByLabelText("Email"), "alice@example.com");
    await user.type(screen.getByLabelText("Password"), "whatever");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/temporarily locked/);
    expect(screen.getByRole("button", { name: "Log in" })).toBeDisabled();
  });
});
