import { createEmptyLocalData, deserializeLocalData, serializeLocalData } from "../domain";
import type { LocalData } from "../domain/types";

const STORAGE_KEY = "ambient-glass.local-data.v1";
const PREVIEW_STORAGE_KEY = "ambient-glass.local-data.preview.v1";

export type LocalDataStorageScope = "production" | "preview";

export const emptyLocalData = (): LocalData => ({
  ...createEmptyLocalData(),
});

export function loadLocalData(scope: LocalDataStorageScope = "production"): LocalData {
  if (typeof window === "undefined") {
    return emptyLocalData();
  }

  try {
    return deserializeLocalData(window.localStorage.getItem(storageKey(scope)));
  } catch {
    return emptyLocalData();
  }
}

export function saveLocalData(data: LocalData, scope: LocalDataStorageScope = "production"): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(storageKey(scope), serializeLocalData(data));
  } catch {
    // The active view stays useful if browser storage is unavailable or full.
  }
}

export function resetLocalDataForPreview(): void {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(PREVIEW_STORAGE_KEY);
  }
}

function storageKey(scope: LocalDataStorageScope): string {
  return scope === "preview" ? PREVIEW_STORAGE_KEY : STORAGE_KEY;
}
