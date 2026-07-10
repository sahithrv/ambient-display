import type { CSSProperties, ComponentPropsWithoutRef, ReactNode } from "react";

export type GlassVariant = "panel" | "organic" | "pill" | "orb" | "inset";
export type GlassGlow = "none" | "soft" | "blue" | "bright";

export interface GlassIslandProps extends ComponentPropsWithoutRef<"section"> {
  children: ReactNode;
  variant?: GlassVariant;
  glow?: GlassGlow;
  /** Uses a custom CSS border-radius while preserving the material layers. */
  radius?: string;
  muted?: boolean;
}

/**
 * The shared Liquid Glass material. The actual color comes from CSS layers instead
 * of backdrop blur alone, so it remains attractive in transparent desktop windows.
 */
export function GlassIsland({
  children,
  className = "",
  variant = "panel",
  glow = "soft",
  radius,
  muted = false,
  style,
  ...props
}: GlassIslandProps) {
  const glassStyle = {
    ...style,
    ...(radius ? { "--glass-radius": radius } : {}),
  } as CSSProperties;

  return (
    <section
      {...props}
      style={glassStyle}
      className={`glass-island glass-island--${variant} glass-island--glow-${glow}${
        muted ? " glass-island--muted" : ""
      } ${className}`}
    >
      <span className="glass-island__body" aria-hidden="true" />
      <span className="glass-island__edge" aria-hidden="true" />
      <span className="glass-island__reflection" aria-hidden="true" />
      <span className="glass-island__noise" aria-hidden="true" />
      <div className="glass-island__content">{children}</div>
    </section>
  );
}
