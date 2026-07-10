import type { HTMLAttributes } from "react";
import { Icon } from "./Icon";
import type { ContributionCell } from "./types";
import { GlassIsland } from "./glass/GlassIsland";

const PATTERN: ContributionCell["level"][] = [
  0, 0, 0, 1, 0, 0, 0, 1, 2, 4, 4, 3, 0, 0, 0, 2, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 3, 4, 3, 2, 0, 0, 2,
  1, 0, 3, 0, 1, 0, 0, 2, 0, 0, 0, 2, 3, 2, 0, 0, 3, 0, 0, 0, 2, 1, 0, 0, 0, 1, 0, 0, 0, 2, 1, 0, 0,
  0, 2, 0, 0, 1, 0,
];

export interface ContributionsHeatmapProps extends HTMLAttributes<HTMLElement> {
  count?: number;
  label?: string;
  caption?: string;
  cells?: ContributionCell[];
  sourceLabel?: string;
  /** False when the provider exposes only a daily total, not a calendar grid. */
  activityDetailAvailable?: boolean;
  activityDetailMessage?: string;
}

export function ContributionsHeatmap({
  count = 5,
  label,
  caption = "Keep building.",
  cells,
  sourceLabel = "GitHub contributions",
  activityDetailAvailable = true,
  activityDetailMessage = "Activity calendar unavailable",
  className = "",
  ...props
}: ContributionsHeatmapProps) {
  const contributionCells: ContributionCell[] =
    cells ?? PATTERN.map((level): ContributionCell => ({ level }));
  return (
    <GlassIsland
      {...props}
      className={`contributions-card ${className}`}
      glow="soft"
      aria-label={`${count} ${sourceLabel} today`}
    >
      <div className="contributions-card__github-orb">
        <Icon name="github" size={37} />
      </div>
      <div className="contributions-card__copy">
        <strong>{label ?? `${count} contributions today`}</strong>
        <span>{caption}</span>
      </div>
      <div className="contributions-card__map-wrap">
        {activityDetailAvailable ? (
          <>
            <div
              className="contributions-card__map"
              role="img"
              aria-label={`${count} contribution activity cells`}
            >
              {contributionCells.slice(0, 72).map((cell, index) => (
                <span
                  key={`${cell.date ?? "activity"}-${index}`}
                  className="contributions-card__cell"
                  data-level={cell.level}
                  title={cell.date ? `${cell.date}: ${cell.count ?? 0} contributions` : undefined}
                />
              ))}
            </div>
            <div className="contributions-card__map-labels">
              <span>Mon</span>
              <span>Wed</span>
              <span>Fri</span>
            </div>
          </>
        ) : (
          <p className="contributions-card__detail-unavailable">{activityDetailMessage}</p>
        )}
      </div>
    </GlassIsland>
  );
}
