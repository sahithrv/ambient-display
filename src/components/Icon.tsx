import type { SVGProps } from "react";

export type IconName =
  | "alarm"
  | "battery"
  | "calendar"
  | "check"
  | "check-circle"
  | "chevron-right"
  | "circle"
  | "cloud-moon"
  | "close"
  | "github"
  | "more"
  | "music"
  | "party"
  | "settings"
  | "sliders"
  | "spark"
  | "sports"
  | "volume"
  | "waveform"
  | "wifi"
  | "wind"
  | "droplet";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  name: IconName;
  size?: number | string;
  strokeWidth?: number;
}

/** Small in-repo icon set so the display has no icon-font or network dependency. */
export function Icon({ name, size = 20, strokeWidth = 1.8, ...props }: IconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false,
    ...props,
  };

  switch (name) {
    case "alarm":
      return (
        <svg {...common}>
          <circle cx="12" cy="13" r="7" />
          <path d="M12 9v4l2.5 1.7M5 4 3 6m16-2 2 2M6 20l-1.4 1.4M18 20l1.4 1.4M7.4 5.4 5.8 3.8m10.8 1.6 1.6-1.6" />
        </svg>
      );
    case "battery":
      return (
        <svg {...common}>
          <rect x="2.5" y="7" width="18" height="10" rx="2" />
          <path d="M22 10v4M5.5 10h8v4h-8z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...common}>
          <rect x="3" y="4.5" width="18" height="17" rx="2" />
          <path d="M7 2.5v4M17 2.5v4M3 9.5h18M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <path d="m5 12.5 4.2 4L19 7" />
        </svg>
      );
    case "check-circle":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="m8 12 2.7 2.8L16.5 9" />
        </svg>
      );
    case "chevron-right":
      return (
        <svg {...common}>
          <path d="m9 5 7 7-7 7" />
        </svg>
      );
    case "circle":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
        </svg>
      );
    case "cloud-moon":
      return (
        <svg {...common}>
          <path
            d="M15.8 3.4a7.1 7.1 0 0 1-6.5 10.1 7 7 0 0 1-2.1-.3A6.2 6.2 0 1 0 15.8 3.4Z"
            fill="currentColor"
            stroke="none"
            opacity=".92"
          />
          <path
            d="M5.5 18.5h12.3a3.2 3.2 0 0 0 .2-6.4 5.2 5.2 0 0 0-9.6 1.7 2.4 2.4 0 0 0-2.9 4.7Z"
            fill="currentColor"
            stroke="none"
            opacity=".72"
          />
        </svg>
      );
    case "close":
      return (
        <svg {...common}>
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      );
    case "github":
      return (
        <svg {...common} fill="currentColor" stroke="none" viewBox="0 0 24 24">
          <path d="M12 2.5a9.5 9.5 0 0 0-3 18.51c.48.09.65-.21.65-.46v-1.67c-2.65.58-3.2-1.13-3.2-1.13-.43-1.1-1.06-1.4-1.06-1.4-.87-.6.07-.59.07-.59.96.07 1.47.99 1.47.99.86 1.46 2.25 1.04 2.8.8.09-.62.34-1.04.61-1.28-2.12-.24-4.35-1.06-4.35-4.71 0-1.04.37-1.9.98-2.57-.1-.24-.42-1.21.1-2.53 0 0 .8-.26 2.62.98A9.1 9.1 0 0 1 12 7.58a9.1 9.1 0 0 1 2.39.32c1.82-1.24 2.62-.98 2.62-.98.52 1.32.2 2.29.1 2.53.61.67.98 1.53.98 2.57 0 3.66-2.23 4.47-4.36 4.7.35.3.65.87.65 1.76v2.61c0 .25.17.55.65.46A9.5 9.5 0 0 0 12 2.5Z" />
        </svg>
      );
    case "more":
      return (
        <svg {...common}>
          <circle cx="5" cy="12" r="1.15" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
          <circle cx="19" cy="12" r="1.15" fill="currentColor" stroke="none" />
        </svg>
      );
    case "music":
      return (
        <svg {...common}>
          <path d="M9 18.5V6l10-2v11.5M9 18.5a2.5 2.5 0 1 1-2.5-2.5A2.5 2.5 0 0 1 9 18.5Zm10-3a2.5 2.5 0 1 1-2.5-2.5A2.5 2.5 0 0 1 19 15.5Z" />
        </svg>
      );
    case "party":
      return (
        <svg {...common}>
          <path d="m4 20 7.5-7.5M11.5 12.5l7.1 7.1M4 20l6.4-1.8 1.7-5.7-6.4 1.8L4 20Zm10.7-13.8.8-2.7m1.7 5.4 2.7-.8m-6.2 1.4-.8 2.7m-3.2-8.4 1.4 1.4m5.2 5.2 1.4 1.4M5.6 8.8 3.8 7m5.9-.2.2-2.5M20.3 14l-2.5.2" />
        </svg>
      );
    case "settings":
    case "sliders":
      return (
        <svg {...common}>
          <path d="M4 7h7m4 0h5M4 17h3m4 0h9M11 4v6m0 4v6M7 14v6m0-16v6M15 4v6m0 4v6" />
          <circle cx="11" cy="7" r="1.7" fill="var(--icon-fill, currentColor)" />
          <circle cx="7" cy="17" r="1.7" fill="var(--icon-fill, currentColor)" />
          <circle cx="15" cy="17" r="1.7" fill="var(--icon-fill, currentColor)" />
        </svg>
      );
    case "spark":
      return (
        <svg {...common}>
          <path
            d="M12 2.8 13.7 10 21 12l-7.3 2-1.7 7.2-1.8-7.2-7.2-2 7.2-2L12 2.8Z"
            fill="currentColor"
            stroke="none"
          />
        </svg>
      );
    case "sports":
      return (
        <svg {...common}>
          <path d="M3 12h4l2.2-6 3.2 12 2.1-6H21" />
        </svg>
      );
    case "volume":
      return (
        <svg {...common}>
          <path d="M4 10h4l5-4v12l-5-4H4zM16.5 9.5a3.6 3.6 0 0 1 0 5M19.2 7a7 7 0 0 1 0 10" />
        </svg>
      );
    case "waveform":
      return (
        <svg {...common}>
          <path d="M3 12h3l1.3-4.5L10 17l2.1-10L14 14l1.8-4H21" />
        </svg>
      );
    case "wifi":
      return (
        <svg {...common}>
          <path d="M3.5 9.3a12.1 12.1 0 0 1 17 0M6.6 12.5a7.6 7.6 0 0 1 10.8 0M9.7 15.7a3.2 3.2 0 0 1 4.6 0" />
          <circle cx="12" cy="19" r=".9" fill="currentColor" stroke="none" />
        </svg>
      );
    case "wind":
      return (
        <svg {...common}>
          <path d="M3 8h10.4a2.1 2.1 0 1 0-2.1-2.1M3 12h15.4a2.1 2.1 0 1 1-2.1 2.1M3 16h7.4a2.1 2.1 0 1 0-2.1 2.1" />
        </svg>
      );
    case "droplet":
      return (
        <svg {...common}>
          <path d="M12 3.5S6.5 10.1 6.5 14.1a5.5 5.5 0 1 0 11 0C17.5 10.1 12 3.5 12 3.5Z" />
        </svg>
      );
    default:
      return null;
  }
}
