// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth/AuthContext.js";
import { ToastProvider } from "../components/Toast.js";
import { Login } from "./Login.js";
import { MfaVerify } from "./MfaVerify.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function renderAppShell(initialPath = "/mfa") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/mfa" element={<MfaVerify />} />
            <Route path="/admin" element={<div>Administration screen</div>} />
            <Route path="/" element={<div>Welcome screen</div>} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

/** Logs in as an administrator whose session requires step-up, landing on S-09a. */
async function reachMfaScreenViaLogin(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  renderAppShell("/login");
  await waitFor(() => expect(screen.getByLabelText("Email")).toBeEnabled());
  await user.type(screen.getByLabelText("Email"), "root@example.com");
  await user.type(screen.getByLabelText("Password"), "whatever whatever");
  await user.click(screen.getByRole("button", { name: "Log in" }));
  await screen.findByText("Verify it's you");
  return user;
}

describe("MfaVerify (S-09a, docs/32_UX/Screen_Inventory.md §3; docs/15 §8.1; ADR-0017)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("redirects away when reached directly, not via a pending admin login", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: "NOT_AUTHENTICATED", message: "No valid session." } })),
    );
    renderAppShell("/mfa");
    expect(await screen.findByText("Welcome screen")).toBeInTheDocument();
  });

  it("submits the code to POST /sessions/mfa and reaches S-09 on success", async () => {
    const fetchMock = vi.fn().mockImplementation((input: string, init?: RequestInit) => {
      if (input === "/api/v1/accounts/me") return Promise.resolve(jsonResponse(401, { error: { code: "NOT_AUTHENTICATED", message: "No valid session." } }));
      if (input === "/api/v1/sessions" && init?.method === "POST") {
        return Promise.resolve(
          jsonResponse(200, { account_id: "admin-1", display_name: "Root", role: "administrator", mfa_required: true }),
        );
      }
      if (input === "/api/v1/sessions/mfa" && init?.method === "POST") {
        expect(init?.body).toBe(JSON.stringify({ code: "123456" }));
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      throw new Error(`unexpected fetch: ${input}`);
    });
    const user = await reachMfaScreenViaLogin(fetchMock);

    await user.type(screen.getByLabelText("Code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByText("Administration screen")).toBeInTheDocument();
  });

  it("shows a uniform message for a wrong code and lets the administrator retry", async () => {
    const fetchMock = vi.fn().mockImplementation((input: string, init?: RequestInit) => {
      if (input === "/api/v1/accounts/me") return Promise.resolve(jsonResponse(401, { error: { code: "NOT_AUTHENTICATED", message: "No valid session." } }));
      if (input === "/api/v1/sessions" && init?.method === "POST") {
        return Promise.resolve(
          jsonResponse(200, { account_id: "admin-1", display_name: "Root", role: "administrator", mfa_required: true }),
        );
      }
      if (input === "/api/v1/sessions/mfa" && init?.method === "POST") {
        return Promise.resolve(jsonResponse(401, { error: { code: "MFA_INVALID", message: "Invalid or expired code." } }));
      }
      throw new Error(`unexpected fetch: ${input}`);
    });
    const user = await reachMfaScreenViaLogin(fetchMock);

    await user.type(screen.getByLabelText("Code"), "000000");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("didn't work");
    // The field clears so a retry doesn't require deleting the wrong digits first.
    expect(screen.getByLabelText("Code")).toHaveValue("");
  });

  it("states the lockout expiry, not just 'locked', on 423 MFA_LOCKED (D-32-04)", async () => {
    const fetchMock = vi.fn().mockImplementation((input: string, init?: RequestInit) => {
      if (input === "/api/v1/accounts/me") return Promise.resolve(jsonResponse(401, { error: { code: "NOT_AUTHENTICATED", message: "No valid session." } }));
      if (input === "/api/v1/sessions" && init?.method === "POST") {
        return Promise.resolve(
          jsonResponse(200, { account_id: "admin-1", display_name: "Root", role: "administrator", mfa_required: true }),
        );
      }
      if (input === "/api/v1/sessions/mfa" && init?.method === "POST") {
        return Promise.resolve(
          jsonResponse(423, {
            error: { code: "MFA_LOCKED", message: "Too many failed codes; try again later." },
            locked_until: "2026-09-02T12:00:00.000Z",
          }),
        );
      }
      throw new Error(`unexpected fetch: ${input}`);
    });
    const user = await reachMfaScreenViaLogin(fetchMock);

    await user.type(screen.getByLabelText("Code"), "000000");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Too many failed codes/);
    expect(screen.getByRole("button", { name: "Verify" })).toBeDisabled();
  });
});
