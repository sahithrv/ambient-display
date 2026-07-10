import type { HTMLAttributes } from "react";
import { Icon } from "./Icon";
import { GlassCapsule } from "./glass/GlassCapsule";

export interface FloatingControlsProps extends HTMLAttributes<HTMLElement> {
  interactive?: boolean;
  statusVisible?: boolean;
  onWake?: () => void;
  onMusic?: () => void;
  onSettings?: () => void;
}

/** Peripheral controls remain low-contrast so they never compete with the scene. */
export function FloatingControls({
  interactive = false,
  statusVisible = true,
  onWake,
  onMusic,
  onSettings,
  className = "",
  ...props
}: FloatingControlsProps) {
  return (
    <nav
      {...props}
      className={`floating-controls ${interactive ? "floating-controls--interactive" : ""} ${className}`}
      aria-label="Display controls"
    >
      <button
        type="button"
        className="floating-controls__orb floating-controls__orb--wake"
        onClick={onWake}
        aria-label="Wake display"
      >
        <Icon name="spark" size={24} />
      </button>
      {statusVisible ? (
        <GlassCapsule className="floating-controls__status" glow="none" aria-label="System status">
          <Icon name="wifi" size={21} />
          <Icon name="volume" size={22} />
          <Icon name="battery" size={25} />
        </GlassCapsule>
      ) : null}
      <button
        type="button"
        className="floating-controls__orb floating-controls__orb--music"
        onClick={onMusic}
        aria-label="Music controls"
      >
        <Icon name="music" size={27} />
      </button>
      <button
        type="button"
        className="floating-controls__orb floating-controls__orb--settings"
        onClick={onSettings}
        aria-label="Open settings"
      >
        <Icon name="sliders" size={24} />
      </button>
    </nav>
  );
}
