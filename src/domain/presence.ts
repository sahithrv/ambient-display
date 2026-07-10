import type { DisplayMode } from "./types";

export type PresenceSource = "face" | "input";

export interface PresenceSample {
  at: number;
  detected: boolean;
  source: PresenceSource;
}

export interface PresenceState {
  samples: PresenceSample[];
  /** Last positive face or local input signal. */
  lastDetectedAt?: number;
}

export interface PresenceConfig {
  sampleWindowSize: number;
  sampleMaxAgeMs: number;
  detectionsRequired: number;
  minimumVisibleMs: number;
  absenceToAmbientMs: number;
  absenceToSleepMs: number;
}

export const DEFAULT_PRESENCE_CONFIG: PresenceConfig = {
  sampleWindowSize: 3,
  sampleMaxAgeMs: 5_000,
  detectionsRequired: 2,
  minimumVisibleMs: 5_000,
  absenceToAmbientMs: 25_000,
  absenceToSleepMs: 10 * 60_000,
};

export type PresenceAction = "none" | "wake" | "dismiss" | "sleep";

export const EMPTY_PRESENCE_STATE: PresenceState = { samples: [] };

export function recordPresenceSample(
  state: PresenceState,
  detected: boolean,
  at: number,
  source: PresenceSource = "face",
  config: Partial<PresenceConfig> = {},
): PresenceState {
  const resolved = { ...DEFAULT_PRESENCE_CONFIG, ...config };
  const samples = [...state.samples, { at, detected, source }].slice(-resolved.sampleWindowSize);

  return {
    samples,
    lastDetectedAt: detected ? at : state.lastDetectedAt,
  };
}

export function recordInputActivity(
  state: PresenceState,
  at: number,
  config: Partial<PresenceConfig> = {},
): PresenceState {
  return recordPresenceSample(state, true, at, "input", config);
}

/** Implements the plan's "2 of the last 3" rolling signal without stale wakeups. */
export function hasConfirmedPresence(
  state: PresenceState,
  now: number,
  config: Partial<PresenceConfig> = {},
): boolean {
  const resolved = { ...DEFAULT_PRESENCE_CONFIG, ...config };
  const freshSamples = state.samples.filter((sample) => now - sample.at <= resolved.sampleMaxAgeMs);
  return freshSamples.filter((sample) => sample.detected).length >= resolved.detectionsRequired;
}

/**
 * Converts rolling observations into one display-machine event category. The
 * caller maps this to PRESENCE_CONFIRMED, ABSENCE_TIMEOUT, or SLEEP_TIMEOUT.
 */
export function derivePresenceAction(
  state: PresenceState,
  input: { mode: DisplayMode; modeEnteredAt: number; now: number },
  config: Partial<PresenceConfig> = {},
): PresenceAction {
  const resolved = { ...DEFAULT_PRESENCE_CONFIG, ...config };
  const { mode, modeEnteredAt, now } = input;

  if ((mode === "ambient" || mode === "sleep") && hasConfirmedPresence(state, now, resolved)) {
    return "wake";
  }

  if (state.lastDetectedAt === undefined) {
    return "none";
  }

  const absenceMs = now - state.lastDetectedAt;
  if (
    absenceMs >= resolved.absenceToSleepMs &&
    (mode === "ambient" || mode === "awakening" || mode === "glance" || mode === "interactive")
  ) {
    return "sleep";
  }

  const canDismiss = mode === "awakening" || mode === "glance" || mode === "interactive";
  if (
    canDismiss &&
    now - modeEnteredAt >= resolved.minimumVisibleMs &&
    absenceMs >= resolved.absenceToAmbientMs
  ) {
    return "dismiss";
  }

  return "none";
}
