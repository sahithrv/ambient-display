import type { HTMLAttributes } from "react";
import type { DisplayMode, WeatherCondition } from "./types";
import { GlassIsland } from "./glass/GlassIsland";

export interface DebugPanelProps extends Omit<HTMLAttributes<HTMLElement>, "onChange"> {
  open: boolean;
  mode?: DisplayMode;
  weather?: WeatherCondition;
  presence?: boolean;
  onModeChange?: (mode: DisplayMode) => void;
  onWeatherChange?: (weather: WeatherCondition) => void;
  onPresenceChange?: (presence: boolean) => void;
  onTriggerCelebration?: () => void;
}

const MODES: DisplayMode[] = [
  "ambient",
  "glance",
  "interactive",
  "alarm",
  "celebration",
  "settings",
];
const WEATHERS: WeatherCondition[] = ["clear", "partly-cloudy", "rain", "storm", "snow"];

/** Preview-only control primitive. Keeping it out of the normal visual tree avoids dashboard chrome. */
export function DebugPanel({
  open,
  mode = "glance",
  weather = "partly-cloudy",
  presence = true,
  onModeChange,
  onWeatherChange,
  onPresenceChange,
  onTriggerCelebration,
  className = "",
  ...props
}: DebugPanelProps) {
  if (!open) return null;
  return (
    <aside {...props} className={`debug-panel ${className}`} aria-label="Preview controls">
      <GlassIsland glow="blue" radius="22px">
        <p className="debug-panel__eyebrow">Preview controls</p>
        <label>
          Mode
          <select
            value={mode}
            onChange={(event) => onModeChange?.(event.target.value as DisplayMode)}
          >
            {MODES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          Weather
          <select
            value={weather}
            onChange={(event) => onWeatherChange?.(event.target.value as WeatherCondition)}
          >
            {WEATHERS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="debug-panel__check">
          <input
            checked={presence}
            type="checkbox"
            onChange={(event) => onPresenceChange?.(event.target.checked)}
          />
          <span>Presence detected</span>
        </label>
        <button
          type="button"
          className="glass-action glass-action--primary"
          onClick={onTriggerCelebration}
        >
          Celebrate tasks
        </button>
      </GlassIsland>
    </aside>
  );
}
