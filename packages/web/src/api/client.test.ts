// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://mahjong-dealer.test", "cookieJar": true}
// Vitest's jsdom environment has no cookie jar by default (`document.cookie`
// writes are silently dropped), and a real browser rejects a `__Host-`
// prefix cookie set from a non-HTTPS origin (docs/15_Security_Architecture.md
// §4.2) — both need overriding for these tests to exercise real cookie reads.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, isLockedError, lockedUntil } from "./client.js";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("api client (docs/33_API/REST_Endpoint_Catalog.md §3)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("attaches the CSRF header from the cookie on a non-safe method", async () => {
    document.cookie = "__Host-csrf=the-secret; Secure; Path=/";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { account_id: "a", display_name: "Alice", role: "player" }));
    vi.stubGlobal("fetch", fetchMock);

    await api.login("alice@example.com", "correct horse battery");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-CSRF-Token"]).toBe("the-secret");
    expect(init.credentials).toBe("include");
  });

  it("does not attach a CSRF header on a safe method", async () => {
    document.cookie = "__Host-csrf=the-secret; Secure; Path=/";
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        account_id: "a",
        email: "alice@example.com",
        display_name: "Alice",
        role: "player",
        created_at: new Date().toISOString(),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.me();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string> | undefined)?.["X-CSRF-Token"]).toBeUndefined();
  });

  it("throws ApiError with the server's code and message on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password." } })),
    );

    await expect(api.login("alice@example.com", "wrong")).rejects.toMatchObject({
      status: 401,
      code: "INVALID_CREDENTIALS",
      message: "Invalid email or password.",
    });
  });

  it("surfaces ACCOUNT_LOCKED with its locked_until", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(423, {
          error: { code: "ACCOUNT_LOCKED", message: "This account is temporarily locked." },
          locked_until: "2026-09-02T12:00:00.000Z",
        }),
      ),
    );

    try {
      await api.login("alice@example.com", "wrong");
      expect.unreachable();
    } catch (error) {
      expect(isLockedError(error)).toBe(true);
      expect(error).toBeInstanceOf(ApiError);
      expect(lockedUntil(error as ApiError)).toBe("2026-09-02T12:00:00.000Z");
    }
  });

  it("resolves to undefined on a 204 response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(api.logout()).resolves.toBeUndefined();
  });
});
