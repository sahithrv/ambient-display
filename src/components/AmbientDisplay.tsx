import type { HTMLAttributes } from "react";
import { AlarmCard, AlarmView } from "./AlarmCard";
import { CalendarCard } from "./CalendarCard";
import { CelebrationBanner } from "./CelebrationBanner";
import { ContributionsHeatmap } from "./ContributionsHeatmap";
import { DebugPanel, type DebugPanelProps } from "./DebugPanel";
import { FloatingControls } from "./FloatingControls";
import { FocusTasks } from "./FocusTasks";
import { Hero } from "./Hero";
import { LiveScores } from "./LiveScores";
import { SettingsPanel, type SettingsPanelProps } from "./SettingsPanel";
import { VoiceOrb, type VoiceOrbProps } from "./VoiceOrb";
import type {
  AlarmDisplayData,
  CalendarDayDisplay,
  CalendarEventDisplay,
  ContrastProfile,
  ContributionCell,
  DisplayMode,
  ScoreDisplay,
  TaskDisplay,
  WeatherDisplayData,
} from "./types";

export interface AmbientDisplayProps extends HTMLAttributes<HTMLElement> {
  mode?: DisplayMode;
  contrast?: ContrastProfile;
  previewBackground?: boolean;
  hero?: {
    time?: string;
    meridiem?: string;
    dateLabel?: string;
    greeting?: string;
    name?: string;
    message?: string;
  };
  weather?: WeatherDisplayData;
  calendar?: {
    title?: string;
    dateRange?: string;
    days?: CalendarDayDisplay[];
    event?: CalendarEventDisplay | null;
  };
  contributions?: {
    count?: number;
    label?: string;
    caption?: string;
    cells?: ContributionCell[];
    sourceLabel?: string;
    activityDetailAvailable?: boolean;
    activityDetailMessage?: string;
  };
  tasks?: TaskDisplay[];
  scores?: ScoreDisplay[];
  alarm?: AlarmDisplayData;
  celebration?: { visible?: boolean; title?: string; message?: string };
  voice?: VoiceOrbProps;
  controls?: { onWake?: () => void; onMusic?: () => void; onSettings?: () => void };
  onToggleTask?: (taskId: string, nextCompleted: boolean) => void;
  onAlarmEnabledChange?: (enabled: boolean) => void;
  onSnoozeAlarm?: () => void;
  onDismissAlarm?: () => void;
  onDismissCelebration?: () => void;
  settings?: Omit<SettingsPanelProps, "open">;
  debug?: DebugPanelProps;
}

/**
 * A visual composition only: state, provider data, and native commands are kept
 * outside this component so it remains portable between the preview and Tauri.
 */
export function AmbientDisplay({
  mode = "glance",
  contrast = "dark-scene",
  previewBackground = false,
  hero,
  weather,
  calendar,
  contributions,
  tasks,
  scores,
  alarm,
  celebration,
  voice,
  controls,
  onToggleTask,
  onAlarmEnabledChange,
  onSnoozeAlarm,
  onDismissAlarm,
  onDismissCelebration,
  settings,
  debug,
  className = "",
  ...props
}: AmbientDisplayProps) {
  const visible = ["awakening", "glance", "interactive", "celebration", "settings"].includes(mode);
  const isInteractive = mode === "interactive";
  const celebrationVisible = mode === "celebration" || Boolean(celebration?.visible);

  return (
    <main
      {...props}
      className={`ambient-display ambient-display--${contrast} ambient-display--mode-${mode}${
        previewBackground ? " ambient-display--preview" : ""
      } ${className}`}
      aria-label="Ambient Glass display"
    >
      {previewBackground ? (
        <div className="ambient-display__preview-scene" aria-hidden="true" />
      ) : null}
      <div className="ambient-display__vignette" aria-hidden="true" />
      {visible ? (
        <div className="ambient-display__islands">
          <Hero {...hero} weather={weather} />
          <CalendarCard {...calendar} />
          {contributions ? <ContributionsHeatmap {...contributions} /> : null}
          <FocusTasks tasks={tasks} interactive={isInteractive} onToggleTask={onToggleTask} />
          <LiveScores scores={scores} />
          {alarm ? <AlarmCard alarm={alarm} onEnabledChange={onAlarmEnabledChange} /> : null}
          <CelebrationBanner
            visible={celebrationVisible}
            title={celebration?.title}
            message={celebration?.message}
            onDismiss={onDismissCelebration}
          />
        </div>
      ) : null}
      {mode !== "sleep" ? (
        <FloatingControls
          interactive={isInteractive}
          onWake={controls?.onWake}
          onMusic={controls?.onMusic}
          onSettings={controls?.onSettings}
        />
      ) : null}
      {isInteractive ? <VoiceOrb {...voice} /> : null}
      {mode === "sleep" ? (
        <div className="ambient-display__sleep-cover" aria-label="Display sleeping" />
      ) : null}
      {mode === "alarm" && alarm ? (
        <AlarmView alarm={alarm} onSnooze={onSnoozeAlarm} onDismiss={onDismissAlarm} />
      ) : null}
      <SettingsPanel open={mode === "settings"} {...settings} />
      {debug ? <DebugPanel {...debug} /> : null}
    </main>
  );
}
