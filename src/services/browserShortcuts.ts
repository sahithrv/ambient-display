import { isTauriRuntime, type NativeShortcutAction } from "./tauri";

export const BROWSER_SHORTCUT_EVENT = "ambient-glass://browser-shortcut";

declare global {
  interface Window {
    __ambientGlassBrowserShortcutBridgeInstalled?: boolean;
    __ambientGlassPendingBrowserShortcut?: NativeShortcutAction;
  }
}

/**
 * Registers the browser-preview shortcut before React commits. This closes the
 * small startup gap where a keypress could otherwise arrive after page load
 * but before an effect listener has attached.
 */
export function installBrowserShortcutBridge(): void {
  if (typeof window === "undefined" || isTauriRuntime()) {
    return;
  }
  if (window.__ambientGlassBrowserShortcutBridgeInstalled) {
    return;
  }
  window.__ambientGlassBrowserShortcutBridgeInstalled = true;
  window.addEventListener(
    "keydown",
    (event) => {
      const action = browserShortcutActionForEvent(event);
      if (!action) {
        return;
      }
      event.preventDefault();
      window.__ambientGlassPendingBrowserShortcut = action;
      window.dispatchEvent(
        new CustomEvent<NativeShortcutAction>(BROWSER_SHORTCUT_EVENT, { detail: action }),
      );
    },
    { capture: true },
  );
}

/** Returns and clears the one action that may have arrived before React mounted. */
export function consumePendingBrowserShortcut(): NativeShortcutAction | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  const pending = window.__ambientGlassPendingBrowserShortcut;
  window.__ambientGlassPendingBrowserShortcut = undefined;
  return pending;
}

/** Reads a startup shortcut without clearing it until React has applied it. */
export function pendingBrowserShortcut(): NativeShortcutAction | undefined {
  return typeof window === "undefined" ? undefined : window.__ambientGlassPendingBrowserShortcut;
}

function browserShortcutActionForEvent(event: KeyboardEvent): NativeShortcutAction | undefined {
  if (!event.ctrlKey || !event.shiftKey) {
    return undefined;
  }
  // `key` is normally a single space, but browser automation, older engines,
  // and some keyboard layouts may report `Spacebar`. `code` is the stable
  // physical-key signal for this recovery shortcut.
  if (event.code === "Space" || event.key === " " || event.key === "Spacebar") {
    return "toggle";
  }
  switch (event.key.toLowerCase()) {
    case "i":
      return "interactive";
    case "d":
      return "debug";
    case ",":
      return "settings";
    default:
      return undefined;
  }
}
