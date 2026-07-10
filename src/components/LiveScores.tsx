import type { CSSProperties, HTMLAttributes } from "react";
import { Icon } from "./Icon";
import type { ScoreDisplay, ScoreTeamDisplay } from "./types";
import { DEFAULT_SCORES } from "./types";
import { GlassIsland } from "./glass/GlassIsland";

function TeamBadge({ team }: { team: ScoreTeamDisplay }) {
  return (
    <span
      className="score-team-badge"
      style={{ "--team-color": team.color ?? "#84adff" } as CSSProperties}
      aria-label={team.name}
    >
      <span className="score-team-badge__ring" />
      <b>{team.mark ?? team.shortName?.slice(0, 1) ?? team.name.slice(0, 1)}</b>
    </span>
  );
}

function ScoreMatch({ event }: { event: ScoreDisplay }) {
  const displayScore = event.away.score !== undefined || event.home.score !== undefined;
  return (
    <article
      className="score-match"
      aria-label={`${event.away.name} versus ${event.home.name}, ${event.status}`}
    >
      <div className="score-match__league">
        <span>{event.sport === "Football" ? "◉" : ""}</span>
        {event.league}
      </div>
      <div className="score-match__body">
        <div className="score-match__team">
          <TeamBadge team={event.away} />
          <span>{event.away.shortName ?? event.away.name}</span>
        </div>
        <div className="score-match__score">
          <strong>
            {displayScore ? `${event.away.score ?? "–"} – ${event.home.score ?? "–"}` : "vs"}
          </strong>
          <span
            className={`score-match__status score-match__status--${event.state ?? "scheduled"}`}
          >
            {event.status}
          </span>
        </div>
        <div className="score-match__team">
          <TeamBadge team={event.home} />
          <span>{event.home.shortName ?? event.home.name}</span>
        </div>
      </div>
    </article>
  );
}

export interface LiveScoresProps extends HTMLAttributes<HTMLElement> {
  scores?: ScoreDisplay[];
  title?: string;
}

export function LiveScores({
  scores = DEFAULT_SCORES,
  title = "Live Scores",
  className = "",
  ...props
}: LiveScoresProps) {
  if (scores.length === 0) return null;
  return (
    <GlassIsland {...props} className={`scores-card ${className}`} glow="soft" aria-label={title}>
      <header className="scores-card__header">
        <Icon name="sports" size={20} />
        <span>{title}</span>
      </header>
      <div className={`scores-card__matches scores-card__matches--${Math.min(scores.length, 3)}`}>
        {scores.slice(0, 3).map((event) => (
          <ScoreMatch key={event.id} event={event} />
        ))}
      </div>
    </GlassIsland>
  );
}
