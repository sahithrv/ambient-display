/**
 * Small, non-secret client cache for normalized provider output. It is useful
 * both in browser preview and in Tauri's WebView: credentials never enter this
 * store, only already-renderable counts/events and their refresh timestamp.
 */
export interface CachedValue<T> {
  savedAt: string;
  value: T;
}

const PREFIX = "ambient-glass.provider-cache.v1";

export function readProviderCache<T>(
  key: string,
  isValue: (value: unknown) => value is T,
): CachedValue<T> | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(`${PREFIX}:${key}`);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (!isTimestamp(record.savedAt) || !isValue(record.value)) {
      return null;
    }
    return { savedAt: record.savedAt, value: record.value };
  } catch {
    return null;
  }
}

export function writeProviderCache<T>(
  key: string,
  value: T,
  savedAt = new Date().toISOString(),
): void {
  if (typeof window === "undefined" || !isTimestamp(savedAt)) {
    return;
  }
  try {
    window.localStorage.setItem(`${PREFIX}:${key}`, JSON.stringify({ savedAt, value }));
  } catch {
    // Live UI remains functional when storage is unavailable or full.
  }
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}
