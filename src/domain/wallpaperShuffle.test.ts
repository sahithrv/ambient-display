import { describe, expect, it } from "vitest";

import {
  advanceWallpaperShuffle,
  createWallpaperShuffleState,
  reconcileWallpaperShuffle,
  resolveWallpaperSelection,
  selectWallpaperNow,
} from "./wallpaperShuffle";

describe("wallpaper shuffle", () => {
  it("visits every enabled wallpaper without an immediate repeat", () => {
    let state = createWallpaperShuffleState(["a", "b", "c"], "a");
    const first = advanceWallpaperShuffle(state, ["a", "b", "c"], () => 0);
    state = first.state;
    const second = advanceWallpaperShuffle(state, ["a", "b", "c"], () => 0);

    expect(first.selectedId).not.toBe("a");
    expect(second.selectedId).not.toBe(first.selectedId);
    expect(new Set(["a", first.selectedId, second.selectedId])).toEqual(new Set(["a", "b", "c"]));

    const refill = advanceWallpaperShuffle(second.state, ["a", "b", "c"], () => 0);
    expect(refill.selectedId).not.toBe(second.selectedId);
  });

  it("reconciles deletion and enable changes without retaining stale ids", () => {
    const reconciled = reconcileWallpaperShuffle(
      { currentId: "gone", remainingIds: ["b", "gone", "c", "b"] },
      ["b", "c", "d"],
      "c",
    );

    expect(reconciled.currentId).toBe("c");
    expect(reconciled.remainingIds).toEqual(["b", "d"]);
  });

  it("keeps a manual choice current and handles zero or one enabled item", () => {
    const manual = selectWallpaperNow({ currentId: "a", remainingIds: ["b", "c"] }, "c", [
      "a",
      "b",
      "c",
    ]);
    expect(manual.currentId).toBe("c");
    expect(manual.remainingIds).not.toContain("c");

    expect(advanceWallpaperShuffle(manual, []).selectedId).toBeUndefined();
    expect(advanceWallpaperShuffle(manual, ["only"]).state).toEqual({
      currentId: "only",
      remainingIds: [],
    });
  });

  it("resolves single and shuffle preferences against available assets", () => {
    expect(
      resolveWallpaperSelection(["a", "b"], {
        playbackMode: "single",
        selectedId: "b",
        enabledIds: [],
        shuffleIntervalMinutes: 15,
      }),
    ).toBe("b");
    expect(
      resolveWallpaperSelection(
        ["a", "b", "c"],
        {
          playbackMode: "shuffle",
          selectedId: "a",
          enabledIds: ["b", "c"],
          shuffleIntervalMinutes: 15,
        },
        "c",
      ),
    ).toBe("c");
  });
});
