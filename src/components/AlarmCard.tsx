import type { HTMLAttributes } from "react";
import { Icon } from "./Icon";
import type { AlarmDisplayData } from "./types";
import { DEFAULT_ALARM } from "./types";
import { GlassIsland } from "./glass/GlassIsland";

export interface AlarmCardProps extends HTMLAttributes<HTMLElement> {
  alarm?: AlarmDisplayData;
  onEnabledChange?: (enabled: boolean) => void;
}

export function AlarmCard({
  alarm = DEFAULT_ALARM,
  onEnabledChange,
  className = "",
  ...props
}: AlarmCardProps) {
  const enabled = alarm.enabled ?? true;
  return (
    <GlassIsland
      {...props}
      className={`alarm-card ${enabled ? "is-enabled" : ""} ${className}`}
      glow="soft"
      aria-label={`${alarm.dayLabel ?? "Alarm"} at ${alarm.time} ${alarm.meridiem ?? ""}`}
    >
      <div className="alarm-card__icon">
        <Icon name="alarm" size={52} strokeWidth={1.45} />
      </div>
      <div className="alarm-card__copy">
        {alarm.dayLabel ? <span className="alarm-card__day">{alarm.dayLabel}</span> : null}
        <div className="alarm-card__time-row">
          <time>{alarm.time}</time>
          {alarm.meridiem ? <em>{alarm.meridiem}</em> : null}
        </div>
        <span className="alarm-card__label">
          {alarm.label} <span aria-hidden="true">🏃</span>
        </span>
      </div>
      <button
        type="button"
        className="alarm-card__switch"
        aria-pressed={enabled}
        aria-label={`${enabled ? "Disable" : "Enable"} ${alarm.label} alarm`}
        onClick={() => onEnabledChange?.(!enabled)}
      >
        <span />
      </button>
    </GlassIsland>
  );
}

export interface AlarmViewProps extends HTMLAttributes<HTMLElement> {
  alarm?: AlarmDisplayData;
  onSnooze?: () => void;
  onDismiss?: () => void;
}

/** Full-screen alarm state, deliberately calmer than a conventional alert dialog. */
export function AlarmView({
  alarm = DEFAULT_ALARM,
  onSnooze,
  onDismiss,
  className = "",
  ...props
}: AlarmViewProps) {
  return (
    <section
      {...props}
      className={`alarm-view ${className}`}
      aria-modal="true"
      role="dialog"
      aria-label="Alarm"
    >
      <GlassIsland
        className="alarm-view__island"
        variant="organic"
        glow="bright"
        radius="42% 32% 40% 36% / 38% 38% 44% 40%"
      >
        <div className="alarm-view__halo" aria-hidden="true" />
        <Icon name="alarm" size={58} strokeWidth={1.35} />
        <p>{alarm.label}</p>
        <time>
          {alarm.time}
          <span>{alarm.meridiem}</span>
        </time>
        <small>{alarm.dayLabel ?? "Now"}</small>
        <div className="alarm-view__actions">
          <button type="button" className="glass-action glass-action--quiet" onClick={onSnooze}>
            Snooze
          </button>
          <button type="button" className="glass-action glass-action--primary" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </GlassIsland>
    </section>
  );
}
