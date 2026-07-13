import { describe, expect, it } from "vitest";

import {
  createDisplayState,
  dueDisplayEvent,
  modeAllowsPointerEvents,
  modeCanRotateContent,
  modeShowsGlass,
  transitionDisplay,
} from "./displayMachine";

describe("display machine", () => {
  it("moves from boot through the controlled reveal into glance", () => {
    const booting = createDisplayState(0);
    expect(dueDisplayEvent(booting, 1_199)).toBeUndefined();
    expect(dueDisplayEvent(booting, 1_200)).toEqual({ type: "BOOT_READY" });

    const ambient = transitionDisplay(booting, { type: "BOOT_READY" }, 1_200);
    const awakening = transitionDisplay(ambient, { type: "PRESENCE_CONFIRMED" }, 2_000);
    const glance = transitionDisplay(awakening, { type: "AWAKENING_FINISHED" }, 2_900);

    expect(ambient.mode).toBe("ambient");
    expect(awakening.mode).toBe("awakening");
    expect(glance.mode).toBe("glance");
    expect(modeShowsGlass(glance.mode)).toBe(true);
    expect(modeCanRotateContent(glance.mode)).toBe(true);
  });

  it("keeps the regular app window interactive in every display mode", () => {
    const glance = { ...createDisplayState(0), mode: "glance" as const };
    const interactive = transitionDisplay(glance, { type: "ENTER_INTERACTIVE" }, 10);

    expect(modeAllowsPointerEvents(glance.mode)).toBe(true);
    expect(modeAllowsPointerEvents(interactive.mode)).toBe(true);
    expect(dueDisplayEvent(interactive, 60_010)).toEqual({ type: "INTERACTION_TIMEOUT" });
    const refreshed = transitionDisplay(interactive, { type: "ENTER_INTERACTIVE" }, 59_000);
    expect(refreshed.enteredAt).toBe(59_000);
    expect(dueDisplayEvent(refreshed, 60_010)).toBeUndefined();
    expect(dueDisplayEvent(refreshed, 119_000)).toEqual({ type: "INTERACTION_TIMEOUT" });
    expect(transitionDisplay(refreshed, { type: "INTERACTION_TIMEOUT" }, 119_000).mode).toBe(
      "glance",
    );
  });

  it("opens shortcut-driven interactive and settings views from passive or boot states", () => {
    const booting = createDisplayState(0);
    const sleep = { ...createDisplayState(0), mode: "sleep" as const };
    const ambient = { ...createDisplayState(0), mode: "ambient" as const };

    expect(transitionDisplay(booting, { type: "ENTER_INTERACTIVE" }, 10).mode).toBe("interactive");
    expect(transitionDisplay(sleep, { type: "ENTER_INTERACTIVE" }, 10).mode).toBe("interactive");
    expect(transitionDisplay(ambient, { type: "ENTER_INTERACTIVE" }, 10).mode).toBe("interactive");
    expect(transitionDisplay(ambient, { type: "OPEN_SETTINGS" }, 10)).toMatchObject({
      mode: "settings",
      returnMode: "ambient",
    });
    expect(transitionDisplay(sleep, { type: "OPEN_SETTINGS" }, 10)).toMatchObject({
      mode: "settings",
      returnMode: "sleep",
    });
    expect(transitionDisplay(booting, { type: "MANUAL_WAKE" }, 10).mode).toBe("awakening");
  });

  it("lets alarm override every mode and returns dismissal to the morning glance", () => {
    const settings = transitionDisplay(
      { ...createDisplayState(0), mode: "glance" },
      { type: "OPEN_SETTINGS" },
      20,
    );
    const alarm = transitionDisplay(settings, { type: "ALARM_TRIGGERED" }, 30);

    expect(settings.mode).toBe("settings");
    expect(alarm.mode).toBe("alarm");
    expect(modeAllowsPointerEvents(alarm.mode)).toBe(true);
    expect(transitionDisplay(alarm, { type: "ENTER_INTERACTIVE" }, 35).mode).toBe("alarm");
    expect(transitionDisplay(alarm, { type: "OPEN_SETTINGS" }, 35).mode).toBe("alarm");
    expect(transitionDisplay(alarm, { type: "ALARM_DISMISSED" }, 40).mode).toBe("glance");
  });

  it("keeps the emergency hide path available from a settings surface", () => {
    const settings = transitionDisplay(
      { ...createDisplayState(0), mode: "glance" },
      { type: "OPEN_SETTINGS" },
      20,
    );

    expect(transitionDisplay(settings, { type: "HIDE" }, 30).mode).toBe("ambient");
  });

  it("returns a celebration to the preceding stable mode exactly once its timer finishes", () => {
    const ambient = { ...createDisplayState(0), mode: "ambient" as const };
    const celebration = transitionDisplay(ambient, { type: "CELEBRATION_TRIGGERED" }, 100);

    expect(celebration).toMatchObject({ mode: "celebration", returnMode: "ambient" });
    expect(dueDisplayEvent(celebration, 4_099)).toBeUndefined();
    expect(dueDisplayEvent(celebration, 4_100)).toEqual({ type: "CELEBRATION_FINISHED" });
    expect(transitionDisplay(celebration, { type: "CELEBRATION_FINISHED" }, 4_100).mode).toBe(
      "ambient",
    );
  });
});
