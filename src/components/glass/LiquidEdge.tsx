import type { HTMLAttributes } from "react";

/** Decorative highlight used where two glass forms appear to merge. */
export function LiquidEdge({ className = "", ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span {...props} className={`liquid-edge ${className}`} aria-hidden="true" />;
}
