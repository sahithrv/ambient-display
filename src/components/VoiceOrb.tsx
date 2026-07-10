import type { ButtonHTMLAttributes } from "react";
import { Icon } from "./Icon";

export interface VoiceOrbProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  listening?: boolean;
  label?: string;
}

/** Push-to-talk affordance, rendered in interactive mode by AmbientDisplay. */
export function VoiceOrb({
  listening = false,
  label = "Hold to speak",
  className = "",
  ...props
}: VoiceOrbProps) {
  return (
    <button
      type="button"
      {...props}
      className={`voice-orb${listening ? " voice-orb--listening" : ""} ${className}`}
      aria-label={label}
    >
      <span className="voice-orb__rings" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <Icon name="waveform" size={28} strokeWidth={1.65} />
      <span className="voice-orb__label">{label}</span>
    </button>
  );
}
