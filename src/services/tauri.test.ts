import { afterEach, describe, expect, it, vi } from "vitest";

import { invokeTauriResult } from "./tauri";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("native invocation errors", () => {
  it("surfaces a bounded structured native message", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    invokeMock.mockRejectedValue({
      kind: "unavailable",
      provider: "TheSportsDB",
      message: "  Sports refresh is cooling down.\nTry again in about a minute.  ",
      retryable: true,
    });

    await expect(invokeTauriResult("refresh_sports")).resolves.toEqual({
      ok: false,
      message: "Sports refresh is cooling down. Try again in about a minute.",
    });
  });

  it("uses a generic message for an unbounded native rejection", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    invokeMock.mockRejectedValue({ message: "x".repeat(513) });

    await expect(invokeTauriResult("refresh_sports")).resolves.toEqual({
      ok: false,
      message: "The native action could not be completed.",
    });
  });
});
