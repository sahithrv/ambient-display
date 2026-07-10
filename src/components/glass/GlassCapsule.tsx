import type { ComponentPropsWithoutRef, ReactNode } from "react";

export interface GlassCapsuleProps extends ComponentPropsWithoutRef<"div"> {
  children: ReactNode;
  glow?: "none" | "soft" | "blue";
}

export function GlassCapsule({
  children,
  className = "",
  glow = "soft",
  ...props
}: GlassCapsuleProps) {
  return (
    <div {...props} className={`glass-capsule glass-capsule--glow-${glow} ${className}`}>
      <span className="glass-capsule__body" aria-hidden="true" />
      <span className="glass-capsule__edge" aria-hidden="true" />
      <span className="glass-capsule__reflection" aria-hidden="true" />
      <span className="glass-capsule__noise" aria-hidden="true" />
      <div className="glass-capsule__content">{children}</div>
    </div>
  );
}
