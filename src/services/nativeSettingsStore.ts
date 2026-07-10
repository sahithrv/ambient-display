import { deserializeLocalData, normalizeLocalData } from "../domain";
import type { LocalData } from "../domain";
import { isTauriRuntime } from "./tauri";

const STORE_FILE = "ambient-glass.json";
const LOCAL_DATA_KEY = "local-data";

/**
 * Tauri Store is used only for non-secret data. Browser/localStorage remains a
 * deterministic fallback for previews and non-Tauri development.
 */
export async function loadNativeLocalData(): Promise<LocalData | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  try {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(STORE_FILE, { defaults: {}, autoSave: 150 });
    const value = await store.get<unknown>(LOCAL_DATA_KEY);
    if (typeof value === "string") {
      return deserializeLocalData(value);
    }
    return value === undefined ? null : normalizeLocalData(value);
  } catch {
    return null;
  }
}

export async function saveNativeLocalData(data: LocalData): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  try {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(STORE_FILE, { defaults: {}, autoSave: 150 });
    await store.set(LOCAL_DATA_KEY, data);
  } catch {
    // Local storage remains available when native settings persistence fails.
  }
}
