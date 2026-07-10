import type { CSSProperties, HTMLAttributes } from "react";
import { Icon } from "./Icon";
import { GlassIsland } from "./glass/GlassIsland";

export interface CelebrationBannerProps extends HTMLAttributes<HTMLElement> {
  visible?: boolean;
  title?: string;
  message?: string;
  onDismiss?: () => void;
}

export function CelebrationBanner({
  visible = true,
  title = "All tasks completed!",
  message = "You did it. Time to celebrate!",
  onDismiss,
  className = "",
  ...props
}: CelebrationBannerProps) {
  if (!visible) return null;
  return (
    <GlassIsland
      {...props}
      className={`celebration-banner ${className}`}
      variant="pill"
      glow="bright"
      aria-live="polite"
    >
      <div className="celebration-banner__particles" aria-hidden="true">
        {Array.from({ length: 16 }, (_, index) => (
          <i
            key={index}
            style={
              {
                "--particle-index": index,
                "--particle-x": `${(index * 17 + 3) % 99}%`,
                "--particle-y": `${(index * 29 + 8) % 84}%`,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div className="celebration-banner__party">
        <Icon name="party" size={38} />
      </div>
      <div className="celebration-banner__copy">
        <strong>{title}</strong>
        <span>{message}</span>
      </div>
      <button
        type="button"
        className="celebration-banner__confirm"
        onClick={onDismiss}
        aria-label="Dismiss celebration"
      >
        <Icon name="check" size={26} strokeWidth={2.3} />
      </button>
    </GlassIsland>
  );
}
