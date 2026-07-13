import {
  deleteNativeWallpaperAsset,
  isTauriRuntime,
  listNativeWallpaperLibrary,
  pickAndImportNativeWallpapers,
  revealNativeWallpaperLibrary,
  type TauriInvocation,
} from "./tauri";
import type {
  NativeWallpaperLibrarySnapshot,
  WallpaperImportResult,
  WallpaperLibraryItem,
  WallpaperLibraryState,
} from "./types";

const PREVIEW_WALLPAPER_IDS = {
  dusk: "1111111111111111111111111111111111111111111111111111111111111111",
  blueHour: "2222222222222222222222222222222222222222222222222222222222222222",
} as const;

export interface PickedWallpaperImport {
  cancelled: boolean;
  result?: Pick<WallpaperImportResult, "importedIds" | "duplicateIds" | "rejected">;
  library?: WallpaperLibraryState;
}

/**
 * Loads a renderer-ready library. Browser preview deliberately receives only
 * bundled deterministic fixtures and never touches native APIs or user files.
 */
export async function loadWallpaperLibrary(): Promise<TauriInvocation<WallpaperLibraryState>> {
  if (!isTauriRuntime()) {
    return { ok: true, value: createPreviewWallpaperLibrary() };
  }

  const result = await listNativeWallpaperLibrary();
  if (!result.ok) {
    return result;
  }
  return { ok: true, value: await toRendererLibrary(result.value, true) };
}

export async function importPickedWallpaperFiles(): Promise<
  TauriInvocation<PickedWallpaperImport>
> {
  if (!isTauriRuntime()) {
    return {
      ok: false,
      message: "Import wallpapers from the native desktop app.",
    };
  }

  const imported = await pickAndImportNativeWallpapers();
  if (!imported.ok) {
    return imported;
  }
  if (imported.value === null) {
    return { ok: true, value: { cancelled: true } };
  }
  return {
    ok: true,
    value: {
      cancelled: false,
      result: {
        importedIds: imported.value.importedIds,
        duplicateIds: imported.value.duplicateIds,
        rejected: imported.value.rejected,
      },
      library: await toRendererLibrary(imported.value.library, true),
    },
  };
}

export async function deleteWallpaperFromLibrary(
  id: string,
): Promise<TauriInvocation<WallpaperLibraryState>> {
  if (!isTauriRuntime()) {
    return {
      ok: false,
      message: "Bundled preview wallpapers cannot be removed.",
    };
  }
  const result = await deleteNativeWallpaperAsset(id);
  if (!result.ok) {
    return result;
  }
  return { ok: true, value: await toRendererLibrary(result.value, true) };
}

export async function revealWallpaperLibrary(): Promise<TauriInvocation<void>> {
  if (!isTauriRuntime()) {
    return {
      ok: false,
      message: "The app-owned wallpaper folder is available in the native desktop app.",
    };
  }
  return revealNativeWallpaperLibrary();
}

export function createPreviewWallpaperLibrary(): WallpaperLibraryState {
  const now = "2026-07-12T20:00:00.000Z";
  return {
    native: false,
    totalBytes: 0,
    ignoredCount: 0,
    items: [
      {
        id: PREVIEW_WALLPAPER_IDS.dusk,
        displayName: "Quiet Dusk",
        kind: "image",
        mimeType: "image/svg+xml",
        sizeBytes: 0,
        importedAt: now,
        src: "/preview/wallpaper-dusk.svg",
        preview: true,
      },
      {
        id: PREVIEW_WALLPAPER_IDS.blueHour,
        displayName: "Blue Hour",
        kind: "image",
        mimeType: "image/svg+xml",
        sizeBytes: 0,
        importedAt: now,
        src: "/preview/wallpaper-blue-hour.svg",
        preview: true,
      },
    ],
  };
}

async function toRendererLibrary(
  snapshot: NativeWallpaperLibrarySnapshot,
  native: boolean,
): Promise<WallpaperLibraryState> {
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  const items: WallpaperLibraryItem[] = snapshot.items.map(({ filePath, ...item }) => ({
    ...item,
    src: convertFileSrc(filePath),
    preview: false,
  }));
  return {
    native,
    items,
    totalBytes: snapshot.totalBytes,
    ignoredCount: snapshot.ignoredCount,
  };
}
