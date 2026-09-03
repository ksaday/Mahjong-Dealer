// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./client.js";
import { tablesApi } from "./tables.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("tables api (docs/33_API/REST_Endpoint_Catalog.md §4)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a table", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(201, { table_id: "t1", join_code: "ABCDEF", seat: "east" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await tablesApi.create();

    expect(result).toEqual({ table_id: "t1", join_code: "ABCDEF", seat: "east" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/tables");
    expect(init.method).toBe("POST");
  });

  it("sends the caller-supplied Idempotency-Key header, and omits it entirely when none is given (D-18-10)", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(201, { table_id: "t1", join_code: "ABCDEF", seat: "east" })));
    vi.stubGlobal("fetch", fetchMock);

    await tablesApi.create("a-fixed-key");
    const [, initWithKey] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((initWithKey.headers as Record<string, string>)["Idempotency-Key"]).toBe("a-fixed-key");

    await tablesApi.create();
    const [, initWithoutKey] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(Object.keys(initWithoutKey.headers as Record<string, string>)).not.toContain("Idempotency-Key");
  });

  it("surfaces a wrong or unknown join code as NOT_FOUND, indistinguishably (FR-022)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(404, { error: { code: "NOT_FOUND", message: "No such table." } })),
    );

    await expect(tablesApi.join("ZZZZZZ")).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("lists only the requester's own tables", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
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
      ),
    );

    const result = await tablesApi.mine();
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0]?.table_id).toBe("t1");
  });

  it("propagates GAME_IN_PROGRESS on close", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(409, { error: { code: "GAME_IN_PROGRESS", message: "A game is in progress." } })),
    );

    const error = await tablesApi.close("t1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("GAME_IN_PROGRESS");
  });
});
