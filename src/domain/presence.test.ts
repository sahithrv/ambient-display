import { describe, expect, it } from "vitest";

import {
  derivePresenceAction,
  EMPTY_PRESENCE_STATE,
  hasConfirmedPresence,
  recordInputActivity,
  recordPresenceSample,
} from "./presence";

describe("presence rolling signal", () => {
  it("requires two recent detections in the rolling window", () => {
    let state = recordPresenceSample(EMPTY_PRESENCE_STATE, true, 0);
    state = recordPresenceSample(state, false, 1_000);
    expect(hasConfirmedPresence(state, 1_000)).toBe(false);

    state = recordPresenceSample(state, true, 2_000);
    expect(hasConfirmedPresence(state, 2_000)).toBe(true);
    expect(derivePresenceAction(state, { mode: "ambient", modeEnteredAt: 0, now: 2_000 })).toBe(
      "wake",
    );
  });

  it("does not wake from stale history and accepts local input as a fallback signal", () => {
    let state = recordPresenceSample(EMPTY_PRESENCE_STATE, true, 0);
    state = recordPresenceSample(state, true, 1_000);
    expect(hasConfirmedPresence(state, 7_000)).toBe(false);

    state = recordInputActivity(state, 7_000);
    state = recordInputActivity(state, 7_100);
    expect(derivePresenceAction(state, { mode: "sleep", modeEnteredAt: 0, now: 7_100 })).toBe(
      "wake",
    );
  });

  it("uses dwell and absence timers before dismissing or sleeping", () => {
    const state = recordPresenceSample(EMPTY_PRESENCE_STATE, true, 0);

    expect(
      derivePresenceAction(state, {
        mode: "glance",
        modeEnteredAt: 23_000,
        now: 25_000,
      }),
    ).toBe("none");
    expect(
      derivePresenceAction(state, {
        mode: "glance",
        modeEnteredAt: 0,
        now: 25_000,
      }),
    ).toBe("dismiss");
    expect(
      derivePresenceAction(state, {
        mode: "ambient",
        modeEnteredAt: 0,
        now: 10 * 60_000,
      }),
    ).toBe("sleep");
  });
});
