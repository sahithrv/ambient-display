import { describe, expect, it } from "vitest";

import {
  createPreviewWallpaperLibrary,
  importPickedWallpaperFiles,
  loadWallpaperLibrary,
} from "./wallpaperLibrary";

describe("wallpaper library browser adapter", () => {
  it("provides deterministic bundled fixtures without a native runtime", async () => {
    const result = await loadWallpaperLibrary();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.native).toBe(false);
    expect(result.value.items).toHaveLength(2);
    expect(result.value.items.every((item) => item.preview)).toBe(true);
    expect(result.value.items.every((item) => item.src.startsWith("/preview/"))).toBe(true);
  });

  it("uses content-hash-shaped ids so preview preferences share production validation", () => {
    const library = createPreviewWallpaperLibrary();
    expect(library.items.every((item) => /^[a-f0-9]{64}$/.test(item.id))).toBe(true);
  });

  it("keeps native file selection unavailable to browser preview", async () => {
    const result = await importPickedWallpaperFiles();

    expect(result).toEqual({
      ok: false,
      message: "Import wallpapers from the native desktop app.",
    });
  });
});
