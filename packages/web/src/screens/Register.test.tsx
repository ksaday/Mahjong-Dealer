// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth/AuthContext.js";
import { ToastProvider } from "../components/Toast.js";
import { Register } from "./Register.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function renderRegister() {
  return render(
    <MemoryRouter initialEntries={["/register"]}>
      <AuthProvider>
        <ToastProvider>
          <Register />
        </ToastProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("Register (S-02, docs/32_UX/Screen_Inventory.md §3)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("states the password requirement before entry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: "NOT_AUTHENTICATED", message: "No valid session." } })),
    );
    renderRegister();
    await waitFor(() => expect(screen.getByLabelText("Email")).toBeEnabled());

    expect(screen.getByText(/at least 12 characters/i)).toBeInTheDocument();
  });

  it("leads to log in on success rather than home (registration sets no session)", async () => {
    const fetchMock = vi.fn().mockImplementation((input: string) => {
      if (input === "/api/v1/accounts/me") return Promise.resolve(jsonResponse(401, { error: { code: "NOT_AUTHENTICATED", message: "No valid session." } }));
      return Promise.resolve(jsonResponse(201, { account_id: "11111111-1111-1111-1111-111111111111" }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderRegister();
    await waitFor(() => expect(screen.getByLabelText("Email")).toBeEnabled());

    await user.type(screen.getByLabelText("Email"), "alice@example.com");
    await user.type(screen.getByLabelText("Display name"), "Alice");
    await user.type(screen.getByLabelText("Password"), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("button", { name: "Continue to log in" })).toBeInTheDocument();
  });

  it("shows a breached-password rejection inline, not as a generic toast", async () => {
    const fetchMock = vi.fn().mockImplementation((input: string) => {
      if (input === "/api/v1/accounts/me") return Promise.resolve(jsonResponse(401, { error: { code: "NOT_AUTHENTICATED", message: "No valid session." } }));
      return Promise.resolve(jsonResponse(422, { error: { code: "PASSWORD_BREACHED", message: "Password appears in a known breach." } }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderRegister();
    await waitFor(() => expect(screen.getByLabelText("Email")).toBeEnabled());

    await user.type(screen.getByLabelText("Email"), "alice@example.com");
    await user.type(screen.getByLabelText("Display name"), "Alice");
    await user.type(screen.getByLabelText("Password"), "password123456");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Password appears in a known breach.");
  });
});
