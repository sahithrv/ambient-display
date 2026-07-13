import type { WallpaperLibraryPreferences } from "../services/types";

export interface WallpaperShuffleState {
  currentId?: string;
  remainingIds: string[];
}

export interface WallpaperShuffleDecision {
  selectedId?: string;
  state: WallpaperShuffleState;
}

export type WallpaperRandomSource = () => number;

export function createWallpaperShuffleState(
  enabledIds: readonly string[],
  preferredId?: string,
): WallpaperShuffleState {
  const enabled = uniqueIds(enabledIds);
  const currentId = preferredId && enabled.includes(preferredId) ? preferredId : enabled[0];
  return {
    currentId,
    remainingIds: enabled.filter((id) => id !== currentId),
  };
}

/**
 * Reconciles a shuffle bag after import, enable/disable, or deletion without
 * changing the current wallpaper when it is still valid.
 */
export function reconcileWallpaperShuffle(
  state: WallpaperShuffleState,
  enabledIds: readonly string[],
  preferredId?: string,
): WallpaperShuffleState {
  const enabled = uniqueIds(enabledIds);
  if (enabled.length === 0) {
    return { remainingIds: [] };
  }
  const currentId =
    state.currentId && enabled.includes(state.currentId)
      ? state.currentId
      : preferredId && enabled.includes(preferredId)
        ? preferredId
        : enabled[0];
  const remaining = state.remainingIds.filter(
    (id, index) =>
      id !== currentId && enabled.includes(id) && state.remainingIds.indexOf(id) === index,
  );
  for (const id of enabled) {
    if (id !== currentId && !remaining.includes(id)) {
      remaining.push(id);
    }
  }
  return { currentId, remainingIds: remaining };
}

/** Advances through every enabled wallpaper before refilling the random bag. */
export function advanceWallpaperShuffle(
  state: WallpaperShuffleState,
  enabledIds: readonly string[],
  random: WallpaperRandomSource = Math.random,
): WallpaperShuffleDecision {
  const enabled = uniqueIds(enabledIds);
  if (enabled.length === 0) {
    return { selectedId: undefined, state: { remainingIds: [] } };
  }
  if (enabled.length === 1) {
    return {
      selectedId: enabled[0],
      state: { currentId: enabled[0], remainingIds: [] },
    };
  }

  const reconciled = reconcileWallpaperShuffle(state, enabled);
  let bag = reconciled.remainingIds.filter((id) => id !== reconciled.currentId);
  if (bag.length === 0) {
    bag = shuffleIds(
      enabled.filter((id) => id !== reconciled.currentId),
      random,
    );
  }
  const [selectedId, ...remainingIds] = bag;
  return {
    selectedId,
    state: { currentId: selectedId, remainingIds },
  };
}

/** Makes a manual gallery choice current while preserving a no-repeat bag. */
export function selectWallpaperNow(
  state: WallpaperShuffleState,
  id: string,
  enabledIds: readonly string[],
): WallpaperShuffleState {
  const enabled = uniqueIds(enabledIds);
  if (!enabled.includes(id)) {
    return reconcileWallpaperShuffle(state, enabled);
  }
  return {
    currentId: id,
    remainingIds: uniqueIds([
      ...state.remainingIds.filter((candidate) => candidate !== id && enabled.includes(candidate)),
      ...enabled.filter((candidate) => candidate !== id && !state.remainingIds.includes(candidate)),
    ]),
  };
}

/** Resolves single/shuffle startup selection against the current library. */
export function resolveWallpaperSelection(
  availableIds: readonly string[],
  preferences: WallpaperLibraryPreferences,
  currentId?: string,
): string | undefined {
  const available = uniqueIds(availableIds);
  if (available.length === 0) {
    return undefined;
  }
  if (preferences.playbackMode === "single") {
    return preferences.selectedId && available.includes(preferences.selectedId)
      ? preferences.selectedId
      : available[0];
  }
  const enabled = preferences.enabledIds.filter((id) => available.includes(id));
  if (enabled.length === 0) {
    return preferences.selectedId && available.includes(preferences.selectedId)
      ? preferences.selectedId
      : available[0];
  }
  if (currentId && enabled.includes(currentId)) {
    return currentId;
  }
  return preferences.selectedId && enabled.includes(preferences.selectedId)
    ? preferences.selectedId
    : enabled[0];
}

function shuffleIds(ids: readonly string[], random: WallpaperRandomSource): string[] {
  const shuffled = [...ids];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const sample = Math.min(Math.max(random(), 0), 0.999999999999);
    const swapIndex = Math.floor(sample * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function uniqueIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids));
}
