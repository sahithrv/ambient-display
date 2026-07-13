export type DisplayMode =
  | "booting"
  | "sleep"
  | "ambient"
  | "awakening"
  | "glance"
  | "interactive"
  | "alarm"
  | "celebration"
  | "settings";

export type ContrastProfile = "light-scene" | "dark-scene" | "mixed-scene";

export type WeatherCondition =
  "clear" | "partly-cloudy" | "cloudy" | "rain" | "storm" | "fog" | "snow";

export interface WeatherDisplayData {
  available?: boolean;
  temperature: number | string;
  condition: string;
  kind?: WeatherCondition;
  wind?: string;
  humidity?: string;
  high?: number | string;
  low?: number | string;
}

export interface CalendarEventDisplay {
  id: string;
  title: string;
  time: string;
  accent?: string;
}

export interface CalendarDayDisplay {
  weekday: string;
  day: number | string;
  selected?: boolean;
}

export interface TaskDisplay {
  id: string;
  title: string;
  time?: string;
  completed?: boolean;
  required?: boolean;
}

export interface ContributionCell {
  date?: string;
  level: 0 | 1 | 2 | 3 | 4;
  count?: number;
}

export interface ScoreTeamDisplay {
  name: string;
  shortName?: string;
  score?: number | string;
  color?: string;
  mark?: string;
}

export interface ScoreDisplay {
  id: string;
  league: string;
  sport?: string;
  status: string;
  state?: "live" | "scheduled" | "final";
  home: ScoreTeamDisplay;
  away: ScoreTeamDisplay;
}

export interface AlarmDisplayData {
  time: string;
  meridiem?: string;
  dayLabel?: string;
  label: string;
  enabled?: boolean;
}

export const DEFAULT_WEATHER: WeatherDisplayData = {
  temperature: 21,
  condition: "Partly cloudy",
  kind: "partly-cloudy",
};

export const DEFAULT_CALENDAR_DAYS: CalendarDayDisplay[] = [
  { weekday: "S", day: 5 },
  { weekday: "M", day: 6 },
  { weekday: "T", day: 7 },
  { weekday: "W", day: 8 },
  { weekday: "T", day: 9 },
  { weekday: "F", day: 10 },
  { weekday: "S", day: 11, selected: true },
];

export const DEFAULT_FOCUS_TASKS: TaskDisplay[] = [
  { id: "explorations", title: "Finish UI explorations", time: "09:30 AM", completed: true },
  { id: "emails", title: "Reply to client emails", time: "12:15 PM", completed: true },
  { id: "presentation", title: "Refine presentation", time: "04:00 PM" },
  { id: "workout", title: "Workout", time: "06:30 PM" },
];

export const DEFAULT_SCORES: ScoreDisplay[] = [
  {
    id: "lal-gsw",
    league: "NBA",
    sport: "Basketball",
    status: "Q4 · 02:34",
    state: "live",
    away: { name: "Lakers", shortName: "LAL", score: 112, color: "#f4bb42", mark: "L" },
    home: { name: "Warriors", shortName: "GSW", score: 108, color: "#4c91e8", mark: "G" },
  },
  {
    id: "rma-fcb",
    league: "Soccer",
    sport: "Football",
    status: "FT",
    state: "final",
    away: { name: "Real Madrid", shortName: "RMA", score: 2, color: "#e7be58", mark: "R" },
    home: { name: "Barcelona", shortName: "BAR", score: 1, color: "#a45bc2", mark: "B" },
  },
];

export const DEFAULT_ALARM: AlarmDisplayData = {
  dayLabel: "Tomorrow",
  time: "06:30",
  meridiem: "AM",
  label: "Morning run",
  enabled: true,
};
