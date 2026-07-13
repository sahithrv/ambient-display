import type { DisplayMode } from "./types";

export interface DisplayState {
  mode: DisplayMode;
  /** Epoch milliseconds; supplied by the caller so transitions stay testable. */
  enteredAt: number;
  /** Where settings and celebrations should return when they finish. */
  returnMode?: DisplayMode;
  /** The mode selected after configuration/cache boot work completes. */
  bootTarget: "ambient" | "sleep";
}

export type DisplayEvent =
  | { type: "BOOT_READY" }
  | { type: "PRESENCE_CONFIRMED" }
  | { type: "MANUAL_WAKE" }
  | { type: "AWAKENING_FINISHED" }
  | { type: "ABSENCE_TIMEOUT" }
  | { type: "SLEEP_TIMEOUT" }
  | { type: "ENTER_INTERACTIVE" }
  | { type: "INTERACTION_TIMEOUT" }
  | { type: "OPEN_SETTINGS" }
  | { type: "CLOSE_SETTINGS" }
  | { type: "ALARM_TRIGGERED" }
  | { type: "ALARM_DISMISSED" }
  | { type: "ALARM_SNOOZED" }
  | { type: "CELEBRATION_TRIGGERED" }
  | { type: "CELEBRATION_FINISHED" }
  | { type: "HIDE" }
  | { type: "FORCE_MODE"; mode: DisplayMode };

export interface DisplayTiming {
  bootDurationMs: number;
  awakeningDurationMs: number;
  interactiveInactivityMs: number;
  celebrationDurationMs: number;
}

export const DEFAULT_DISPLAY_TIMING: DisplayTiming = {
  bootDurationMs: 1_200,
  awakeningDurationMs: 900,
  interactiveInactivityMs: 60_000,
  celebrationDurationMs: 4_000,
};

export interface ScheduledDisplayEvent {
  dueAt: number;
  event: Extract<
    DisplayEvent,
    | { type: "BOOT_READY" }
    | { type: "AWAKENING_FINISHED" }
    | { type: "INTERACTION_TIMEOUT" }
    | { type: "CELEBRATION_FINISHED" }
  >;
}

export function createDisplayState(
  now: number,
  bootTarget: "ambient" | "sleep" = "ambient",
): DisplayState {
  return { mode: "booting", enteredAt: now, bootTarget };
}

/**
 * The only transition table for the overlay. UI components should dispatch
 * events to this function rather than each owning a separate visibility timer.
 */
export function transitionDisplay(
  state: DisplayState,
  event: DisplayEvent,
  now: number,
): DisplayState {
  if (event.type === "FORCE_MODE") {
    return {
      ...state,
      mode: event.mode,
      enteredAt: now,
      returnMode: undefined,
    };
  }

  if (event.type === "ALARM_TRIGGERED") {
    return state.mode === "alarm" ? state : enter(state, "alarm", now);
  }

  // The emergency-hide shortcut must work even while a settings or alarm view
  // is on top of the composition.
  if (event.type === "HIDE") {
    return state.mode === "ambient" || state.mode === "sleep" || state.mode === "booting"
      ? state
      : enter(state, "ambient", now);
  }

  // Shortcut-driven entry points must work even when the display is passive
  // (or before the normal boot timer has elapsed). Native has already made the
  // underlying window interactive before it emits these matching events, so
  // the web state needs to make the same transition without waiting for a
  // presence sample.
  if (event.type === "ENTER_INTERACTIVE") {
    return state.mode === "alarm" ? state : enter(state, "interactive", now);
  }

  if (event.type === "OPEN_SETTINGS") {
    if (state.mode === "alarm" || state.mode === "settings") {
      return state;
    }
    return enter(state, "settings", now, settingsReturnMode(state));
  }

  switch (state.mode) {
    case "booting":
      if (event.type === "BOOT_READY") {
        return enter(state, state.bootTarget, now);
      }
      // A deliberate keyboard/global-shortcut wake is allowed to bypass the
      // passive boot frame, while ordinary boot still follows its timer.
      return event.type === "PRESENCE_CONFIRMED" || event.type === "MANUAL_WAKE"
        ? enter(state, "awakening", now)
        : state;

    case "sleep":
      if (event.type === "PRESENCE_CONFIRMED" || event.type === "MANUAL_WAKE") {
        return enter(state, "awakening", now);
      }
      return state;

    case "ambient":
      if (event.type === "PRESENCE_CONFIRMED" || event.type === "MANUAL_WAKE") {
        return enter(state, "awakening", now);
      }
      if (event.type === "CELEBRATION_TRIGGERED") {
        return enter(state, "celebration", now, "ambient");
      }
      if (event.type === "SLEEP_TIMEOUT") {
        return enter(state, "sleep", now);
      }
      return state;

    case "awakening":
      if (event.type === "AWAKENING_FINISHED") {
        return enter(state, "glance", now);
      }
      if (event.type === "ABSENCE_TIMEOUT") {
        return enter(state, "ambient", now);
      }
      return state;

    case "glance":
      if (event.type === "CELEBRATION_TRIGGERED") {
        return enter(state, "celebration", now, "glance");
      }
      if (event.type === "ABSENCE_TIMEOUT") {
        return enter(state, "ambient", now);
      }
      if (event.type === "SLEEP_TIMEOUT") {
        return enter(state, "sleep", now);
      }
      return state;

    case "interactive":
      if (event.type === "INTERACTION_TIMEOUT") {
        return enter(state, "glance", now);
      }
      if (event.type === "CELEBRATION_TRIGGERED") {
        return enter(state, "celebration", now, "interactive");
      }
      if (event.type === "ABSENCE_TIMEOUT") {
        return enter(state, "ambient", now);
      }
      if (event.type === "SLEEP_TIMEOUT") {
        return enter(state, "sleep", now);
      }
      return state;

    case "alarm":
      if (event.type === "ALARM_DISMISSED" || event.type === "ALARM_SNOOZED") {
        // Dismissal intentionally enters the morning briefing/glance state.
        return enter(state, "glance", now);
      }
      return state;

    case "celebration":
      if (event.type === "CELEBRATION_FINISHED") {
        return enter(state, state.returnMode ?? "glance", now);
      }
      return state;

    case "settings":
      if (event.type === "CLOSE_SETTINGS") {
        return enter(state, state.returnMode ?? "glance", now);
      }
      if (event.type === "MANUAL_WAKE") {
        return enter(state, "awakening", now);
      }
      return state;
  }
}

export function nextScheduledDisplayEvent(
  state: DisplayState,
  timing: Partial<DisplayTiming> = {},
): ScheduledDisplayEvent | undefined {
  const resolvedTiming = { ...DEFAULT_DISPLAY_TIMING, ...timing };
  switch (state.mode) {
    case "booting":
      return {
        dueAt: state.enteredAt + resolvedTiming.bootDurationMs,
        event: { type: "BOOT_READY" },
      };
    case "awakening":
      return {
        dueAt: state.enteredAt + resolvedTiming.awakeningDurationMs,
        event: { type: "AWAKENING_FINISHED" },
      };
    case "interactive":
      return {
        dueAt: state.enteredAt + resolvedTiming.interactiveInactivityMs,
        event: { type: "INTERACTION_TIMEOUT" },
      };
    case "celebration":
      return {
        dueAt: state.enteredAt + resolvedTiming.celebrationDurationMs,
        event: { type: "CELEBRATION_FINISHED" },
      };
    default:
      return undefined;
  }
}

/** Returns the event only after it is due; suitable for one central interval. */
export function dueDisplayEvent(
  state: DisplayState,
  now: number,
  timing: Partial<DisplayTiming> = {},
): DisplayEvent | undefined {
  const scheduled = nextScheduledDisplayEvent(state, timing);
  return scheduled && now >= scheduled.dueAt ? scheduled.event : undefined;
}

export function modeAllowsPointerEvents(mode: DisplayMode): boolean {
  // Ambient Glass is a normal app window, not a click-through desktop overlay.
  // Every mode keeps the current window usable; the title bar remains an
  // operating-system escape hatch even while the optional sleep cover is up.
  void mode;
  return true;
}

export function modeShowsGlass(mode: DisplayMode): boolean {
  return (
    mode === "awakening" ||
    mode === "glance" ||
    mode === "interactive" ||
    mode === "alarm" ||
    mode === "celebration" ||
    mode === "settings"
  );
}

export function modeCanRotateContent(mode: DisplayMode): boolean {
  return mode === "glance";
}

function enter(
  state: DisplayState,
  mode: DisplayMode,
  now: number,
  returnMode?: DisplayMode,
): DisplayState {
  return {
    ...state,
    mode,
    enteredAt: now,
    returnMode,
  };
}

function settingsReturnMode(state: DisplayState): DisplayMode {
  switch (state.mode) {
    // Closing settings opened during boot should return to a passive state
    // rather than revive a stale boot timer.
    case "booting":
      return state.bootTarget;
    case "celebration":
      return state.returnMode ?? "glance";
    default:
      return state.mode;
  }
}
