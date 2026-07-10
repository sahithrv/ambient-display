import type { HTMLAttributes } from "react";
import { Icon } from "./Icon";
import type { TaskDisplay } from "./types";
import { DEFAULT_FOCUS_TASKS } from "./types";
import { GlassIsland } from "./glass/GlassIsland";

export interface FocusTasksProps extends HTMLAttributes<HTMLElement> {
  title?: string;
  tasks?: TaskDisplay[];
  progressLabel?: string;
  encouragement?: string;
  interactive?: boolean;
  onToggleTask?: (taskId: string, nextCompleted: boolean) => void;
}

export function FocusTasks({
  title = "Today's Focus",
  tasks = DEFAULT_FOCUS_TASKS,
  progressLabel,
  encouragement = "Small steps, big progress.",
  interactive = false,
  onToggleTask,
  className = "",
  ...props
}: FocusTasksProps) {
  const complete = tasks.filter((task) => task.completed).length;
  const progress = progressLabel ?? `${complete}/${tasks.length}`;

  return (
    <GlassIsland
      {...props}
      className={`focus-card ${interactive ? "focus-card--interactive" : ""} ${className}`}
      glow="blue"
      aria-label={`${title}: ${progress} complete`}
    >
      <header className="focus-card__header">
        <div className="focus-card__title">
          <Icon name="calendar" size={19} />
          <span>{title}</span>
        </div>
        <span
          className="focus-card__progress"
          aria-label={`${complete} of ${tasks.length} complete`}
        >
          <svg viewBox="0 0 40 40" aria-hidden="true">
            <circle className="focus-card__progress-track" cx="20" cy="20" r="17" />
            <circle
              className="focus-card__progress-value"
              cx="20"
              cy="20"
              r="17"
              pathLength="100"
              strokeDasharray={`${tasks.length ? (complete / tasks.length) * 100 : 0} 100`}
            />
          </svg>
          <b>{progress}</b>
        </span>
      </header>
      <div className="focus-card__tasks">
        {tasks.length > 0 ? (
          tasks.slice(0, 4).map((task) => {
            const canToggle = interactive && Boolean(onToggleTask);
            return (
              <div
                key={task.id}
                className={`focus-card__task${task.completed ? " is-complete" : ""}`}
              >
                <button
                  type="button"
                  className="focus-card__check"
                  aria-label={`${task.completed ? "Mark incomplete" : "Complete"} ${task.title}`}
                  disabled={!canToggle}
                  onClick={() => onToggleTask?.(task.id, !task.completed)}
                >
                  {task.completed ? (
                    <Icon name="check" size={13} strokeWidth={2.4} />
                  ) : (
                    <Icon name="circle" size={18} />
                  )}
                </button>
                <span className="focus-card__task-title">{task.title}</span>
                {task.time ? <time className="focus-card__task-time">{task.time}</time> : null}
              </div>
            );
          })
        ) : (
          <div className="focus-card__empty">
            <strong>No focus tasks yet</strong>
            <span>Add one from settings or type “add … to my tasks”.</span>
          </div>
        )}
      </div>
      {encouragement ? (
        <p className="focus-card__encouragement">
          <Icon name="spark" size={16} />
          {encouragement}
        </p>
      ) : null}
    </GlassIsland>
  );
}
